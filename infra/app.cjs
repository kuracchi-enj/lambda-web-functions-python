const { existsSync, readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");
const cdk = require("aws-cdk-lib");
const {
  aws_ec2: ec2,
  aws_lambda: lambda,
  aws_rds: rds,
  aws_secretsmanager: sm,
  custom_resources: cr,
} = cdk;

function requirePackage(name, sourceFile) {
  const directory = join(__dirname, ".lambda-build", name);
  const rebuild = "Run bash build-lambda.sh from infra before deploying.";

  for (const file of [sourceFile, "requirements.txt"]) {
    const bundled = join(directory, file);
    const current = resolve(__dirname, "..", file);
    if (!existsSync(bundled) || !readFileSync(bundled).equals(readFileSync(current))) {
      throw new Error(`The ${name} package has an outdated or missing ${file}. ${rebuild}`);
    }
  }

  for (const requiredFile of ["boto3/__init__.py", "rds-ca.pem"]) {
    if (!existsSync(join(directory, requiredFile))) {
      throw new Error(`The ${name} package is missing ${requiredFile}. ${rebuild}`);
    }
  }

  return directory;
}

const webPackage = requirePackage("web", "config/lambda_settings.py");
const migrationPackage = requirePackage("migration", "migrate_handler.py");

const app = new cdk.App();
const stack = new cdk.Stack(app, "DjangoWeb", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "ap-northeast-1" },
});

const vpc = new ec2.Vpc(stack, "Vpc", {
  maxAzs: 2,
  natGateways: 0,
  subnetConfiguration: [{ name: "private", subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
});

const subnets = { subnetType: ec2.SubnetType.PRIVATE_ISOLATED };
const appSg = new ec2.SecurityGroup(stack, "AppSg", { vpc });
const dbSg = new ec2.SecurityGroup(stack, "DbSg", { vpc });
const secretsSg = new ec2.SecurityGroup(stack, "SecretsSg", { vpc });
dbSg.addIngressRule(appSg, ec2.Port.tcp(5432));
secretsSg.addIngressRule(appSg, ec2.Port.tcp(443));

const secretsEndpoint = vpc.addInterfaceEndpoint("SecretsEndpoint", {
  service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
  subnets, securityGroups: [secretsSg], open: false, privateDnsEnabled: true,
});

const db = new rds.DatabaseCluster(stack, "Aurora", {
  engine: rds.DatabaseClusterEngine.auroraPostgres({
    version: rds.AuroraPostgresEngineVersion.VER_17_7,
  }),
  writer: rds.ClusterInstance.serverlessV2("Writer"),
  vpc, vpcSubnets: subnets, securityGroups: [dbSg],
  defaultDatabaseName: "django",
  manageMasterUserPassword: true,
  serverlessV2MinCapacity: 0,
  serverlessV2MaxCapacity: 2,
  serverlessV2AutoPauseDuration: cdk.Duration.minutes(5),
  storageEncrypted: true,
  removalPolicy: cdk.RemovalPolicy.SNAPSHOT,
});

const connector = new lambda.NetworkConnector(stack, "WebEgress", {
  configuration: lambda.NetworkConnectorConfiguration.vpcEgress({
    computeType: lambda.NetworkConnectorComputeType.WEB_FUNCTION,
    vpc, vpcSubnets: subnets, securityGroups: [appSg],
  }),
});

const djangoKey = new sm.Secret(stack, "DjangoSecretKey", {
  generateSecretString: { passwordLength: 64 },
});

const masterSecretArnPath = "DBClusters.0.MasterUserSecret.SecretArn";
// cdkd 0.366 does not expose MasterUserSecret.SecretArn on AWS::RDS::DBCluster.
const masterSecretLookup = new cr.AwsCustomResource(stack, "AuroraMasterSecret", {
  resourceType: "Custom::AuroraMasterSecret",
  onUpdate: {
    service: "RDS",
    action: "describeDBClusters",
    parameters: { DBClusterIdentifier: db.clusterIdentifier },
    physicalResourceId: cr.PhysicalResourceId.of(db.clusterResourceIdentifier),
    outputPaths: [masterSecretArnPath],
    logging: cr.Logging.withDataHidden(),
  },
  policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
    resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
  }),
  installLatestAwsSdk: false,
});
const dbSecret = sm.Secret.fromSecretCompleteArn(
  stack,
  "MigrationDbSecret",
  masterSecretLookup.getResponseField(masterSecretArnPath),
);

const apiDbSecret = new sm.Secret(stack, "DjangoApiDbSecret", {
  generateSecretString: {
    secretStringTemplate: JSON.stringify({ username: "django_web_api" }),
    generateStringKey: "password",
    passwordLength: 48,
  },
});

const migrationAsset = new cdk.aws_s3_assets.Asset(stack, "MigrationAsset", {
  path: migrationPackage,
});
const migrator = new lambda.Function(stack, "Migrate", {
  runtime: lambda.Runtime.PYTHON_3_15,
  architecture: lambda.Architecture.ARM_64,
  handler: "migrate_handler.handler",
  code: lambda.Code.fromBucket(migrationAsset.bucket, migrationAsset.s3ObjectKey),
  timeout: cdk.Duration.seconds(120),
  vpc,
  vpcSubnets: subnets,
  securityGroups: [appSg],
  environment: {
    DJANGO_SETTINGS_MODULE: "config.settings",
    POSTGRES_HOST: db.clusterEndpoint.hostname,
    POSTGRES_DB: "django",
    DB_SECRET_ARN: dbSecret.secretArn,
    APP_DB_SECRET_ARN: apiDbSecret.secretArn,
  },
});
const migration = new cdk.CustomResource(stack, "RunMigrations", {
  resourceType: "Custom::DjangoMigrate",
  serviceToken: migrator.functionArn,
  properties: {
    BundleHash: migrationAsset.assetHash,
    DatabaseId: db.clusterResourceIdentifier,
    ApiDbSecretArn: apiDbSecret.secretArn,
  },
});
dbSecret.grantRead(migrator).applyBefore(migration);
apiDbSecret.grantRead(migrator).applyBefore(migration);
migration.node.addDependency(db, secretsEndpoint);

new cdk.CfnOutput(stack, "MigrateFunctionName", { value: migrator.functionName });

const fn = new lambda.WebFunction(stack, "Web", {
  code: lambda.WebFunctionCode.fromAssetToManagedBucket(webPackage),
  runtime: lambda.WebFunctionRuntime.of("python3.15"),
  defaultEndpointAuth: lambda.WebFunctionAuthType.IAM_AUTH,
  egressNetworkConnector: connector,
  timeout: cdk.Duration.seconds(60),
  environment: {
    DJANGO_SETTINGS_MODULE: "config.lambda_settings",
    POSTGRES_HOST: db.clusterEndpoint.hostname,
    POSTGRES_DB: "django",
    APP_DB_SECRET_ARN: apiDbSecret.secretArn,
    DJANGO_SECRET_ARN: djangoKey.secretArn,
  },
});

new cdk.CfnOutput(stack, "EndpointUrl", {
  value: `https://${fn.endpoint.domainName}`,
});

fn.resourceRevision.node.addDependency(migration);
apiDbSecret.grantRead(fn).applyBefore(fn.resourceRevision);
djangoKey.grantRead(fn).applyBefore(fn.resourceRevision);

app.synth();
