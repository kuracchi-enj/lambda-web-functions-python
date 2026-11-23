どうもどうも。

さっき（2026/11/22）に、Twitter見てたらLambda Web FunctionsにPythonがキタっていうツイートを見たので、早速触ってみました。

:::note
久々にちゃんとコーディングするかぁと思って、あまりAIを使わずに触ってみました。楽しかった！！「コードを書く」ってやっぱりいいね！
仕事だとAI使った方が速いし正確だからAIコーディングしちゃうけど、たまには人力コーディングするのもいい。
ちなみに、最近投稿してる記事も、95%人力です。（図や表はAIに頼っちゃう）
:::

:::note warn
あ、ちなみに、一般的に呼ばれているであろう、Lambda関数は「Lambda Event Functions」っていう名称に変わっていますが、まだ定着していないような気もするし、Lambda関数の方が伝わるかなぁと思うので、Lambda関数って呼びます。（Lambda警察来いやー！）
:::

じゃあ早速やっていきますかぁ

# Lambda Web Functionsについて

この記事で解説しています！

https://qiita.com/kuracchi_enj/items/510620a2938af38f319d

時間ない人向けに簡単にお伝えすると、「**Rails/Next.js/DjangoなどのWebアプリケーションをLambdaで動かせるよ！**」っていうサービスです。

以前（2年前くらい？）から、Lambda Web Adapterっていうものが存在していたんですけど（しているんですけど）、制約があったりするんですよね。（セキュリティ要件的に厳しい企業だと使えないよねぇ。とか、1処理1Lambdaだから同時実行数が爆上がりするよねぇ。とか）

https://qiita.com/kuracchi_enj/items/b56cd95751c9f70327cb

で、GAされたばかりの時は、Node.js 24.xしかサポートされていなかったんですけど、さっき（2026/11/22）、Node.js 26.xとPython 3.15が出ていました。（執筆時点ではPythonはプレビューです。）

![image.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/2711491/741c92f1-9b9e-42fa-bc54-f806212bc1b7.png)

僕自身、動的型付け言語が好きなので、Node.jsよりもPythonの方が好きだったりするんです。なので、Pythonランタイムの方で早速試してみようかな。

# Djangoで作っていこう！

Djangoは、「**WebアプリケーションやWeb APIを効率よく開発するためのPython製オープンソース・フルスタックWebフレームワーク**」です。

:::note
PythonのWEbアプリフレームワークは、FastAPIとDjangoの二大巨塔な気がしますね。RubyはRailsの一強みたいなところあるけど。（ほんとはSinatraっていうフレームワークもあるんだよ。）
:::

んで、早速やっていきましょう。

## まず初めに方針

今回は、ありきたりですが、Django REST Frameworkで、まずは投稿（Post）のCRUD APIを作って検証します。

:::note
チュートリアル系のアプリケーションってTaskかPostが多めっすね。（Todoアプリ, 掲示板アプリが選ばれがちかな）
:::

## 1. Python仮想環境を作る

以下を実行することで、Pythonの仮想環境（venv）を作成します。

```bash
python3 -m venv .venv
source .venv/bin/activate
```

## 2. Djangoプロジェクトを作成する

以下のコマンドを実行して、プロジェクトを作成します。

```bash
python -m pip install Django djangorestframework
python -m django startproject config .
python manage.py startapp posts
```

こんな感じでファイルとディレクトリが作成されます。

![スクリーンショット 2026-11-22 23.05.20.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/2711491/5c660b4e-2a94-4441-8b71-d6bfc95da12d.png)

:::note
VS Code久々に開いた。
:::

ここまでできたら、`config/settings.py`に記載されている`INSTALLED_APPS`に`"rest_framework"`と`"posts"`を追加してください。（↓こんな感じ↓）

```python
INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # 以下を追加
    'rest_framework',   
    'posts',
]
```

## 3. DBをPostgreSQLに変更する

現時点では、SQLiteでDBが用意されるので、PosgreSQLにします。

:::note
ぶっちゃけ、SQLiteのままでもいいんですけど、Lambda Web Functionsを使うにしてもAuroraは使いたいので、PostgreSQLにしておきました。（ローカルはSQLite、AWS環境はPostgreSQLっていうのでもできるんですが、あまりやらないですよね。）
:::

### config/settings.py

`DATABASES`の内容を以下のように書き換えます。

```python
# この行を追加
import os

# こいつらを追加
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.postgresql',
        'NAME': os.environ.get('POSTGRES_DB', 'django'),
        'USER': os.environ.get('POSTGRES_USER', 'django'),
        'PASSWORD': os.environ.get('POSTGRES_PASSWORD', 'django-local-only'),
        'HOST': os.environ.get('POSTGRES_HOST', '127.0.0.1'),
        'PORT': os.environ.get('POSTGRES_PORT', '5432'),
    }
}
```

### compose.yaml

Docker ComposeでPostgreSQLを用意します。

```bash
touch compose.yaml
```

作ったファイルに以下を記述します。

```yaml
services:
  db:
    image: postgres:17
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-django}
      POSTGRES_USER: ${POSTGRES_USER:-django}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-django-local-only}
    ports:
      - "127.0.0.1:${POSTGRES_PORT:-5432}:5432"
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -h 127.0.0.1 -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"']
      interval: 2s
      timeout: 5s
      retries: 15

volumes:
  postgres-data:
```

### requirements.txt

`requirements.txt`に`psycopg`を追加することで、PostgreSQLとの接続が可能になります。

```bash
touch requirements.txt
```

```
Django==6.1.3
djangorestframework==3.18.3
psycopg[binary]==3.3.9
```

## 4. モデルとAPIを定義する

### posts/models.py

```python
from django.db import models

class Post(models.Model):
    title = models.CharField(max_length=200)
```

### posts/serializers.py

```python
from rest_framework import serializers

from .models import Post


class PostSerializer(serializers.ModelSerializer):
    class Meta:
        model = Post
        fields = ["id", "title"]
```

### posts/views.py

```python
from rest_framework.viewsets import ModelViewSet

from .models import Post
from .serializers import PostSerializer


class PostViewSet(ModelViewSet):
    queryset = Post.objects.order_by("id")
    serializer_class = PostSerializer
```

### config/urls.py

```python
from django.contrib import admin
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from posts.views import PostViewSet

router = DefaultRouter()
router.register("posts", PostViewSet)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(router.urls)),
]
```

## 5. 依存関係をインストールする

まぁ、いつものやつね。

```bash
python -m pip install -r requirements.txt
```

## 6. Docker ComposeでDBを構築する

```bash
docker compose up -d --wait db
```

## 7. マイグレーションを実行する

```bash
# マイグレーションファイルが用意されて、
python manage.py makemigrations posts
# マイグレーションが実行される
python manage.py migrate
```

## 8. Djangoサーバーを起動する

このコマンドを実行して、サーバーを起動しましょう。

```bash
python manage.py runserver
```

起動できたら、`http://127.0.0.1:8000/admin`にアクセスしてみましょう。以下のような画面が出てくるはずです。

![スクリーンショット 2026-11-22 23.20.54.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/2711491/575a585b-af8b-40a4-b532-cfc3901b97b3.png)

次に`http://127.0.0.1:8000/api/posts/`にアクセスしてみましょう。以下のような画面が出てくるはずです。

![スクリーンショット 2026-11-22 23.24.19.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/2711491/31796707-a0fa-4b56-a1a8-0aa6e99cc89c.png)

`Title`の部分にテキストを入れて`POST`をクリックすると、データが登録されるのがわかると思います。

![スクリーンショット 2026-11-22 23.25.29.png](https://qiita-image-store.s3.ap-northeast-1.amazonaws.com/0/2711491/70bad2a6-cd0d-4446-82f4-f1519df4e528.png)

:::note
リダイレクトの機能を実装してない、欠陥アプリケーションなので、画面をリロードすると同じデータが追加されていきます。
:::

# Lambda Web Functionsでデプロイしていきましょう（DBなしページ）

cdkdを使って、デプロイしていきます。（Pythonランタイムが出てきてから数時間しか経ってない時点で検証していますが、果たしてデプロイできるのでしょうか？）

:::note
cdkdがどれだけ凄いのか、検証してみました！っていうサブテーマ！
:::

## 1. Lambda Web Functionsで動くようにエントリーポイントを作成

```bash
touch main.py
```

```python
from config.wsgi import application as app
```

## 2. 設定を用意

```bash
config/lambda_settings.py
```

```python
from django.core.management.utils import get_random_secret_key

from .settings import *

DEBUG = False
ALLOWED_HOSTS = [".lambda-web.ap-northeast-1.on.aws"]
SECRET_KEY = get_random_secret_key()
```

## 3. 確認用にDBに接続しないビューを用意する

`config/urls.py`を以下のコードに置き換えます。

```python
from django.contrib import admin
from django.urls import include, path
from django.http import JsonResponse  # ここ追加
from rest_framework.routers import DefaultRouter

from posts.views import PostViewSet

# ここ追加
def healthz(request):
    return JsonResponse({"status": "ok"})

router = DefaultRouter()
router.register("posts", PostViewSet)

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include(router.urls)),
    path("healthz/", healthz),  # ここ追加
]
```

## 4. Lambda Web Functionsにデプロイするパッケージを用意

以下をターミナルで順に実行してください。

```bash
export WEB_BUILD="$(mktemp -d)"

python -m pip install \
  --platform manylinux_2_28_aarch64 \
  --implementation cp --python-version 3.15 --abi cp315 \
  --only-binary=:all: --no-compile \
  --target "$WEB_BUILD" \
  -r requirements.txt

rsync -a --exclude __pycache__ main.py manage.py config posts "$WEB_BUILD/"
```

## 5. CDKスタックを定義していく

cdkdでデプロイしますが、cdkdで扱うスタックはCDKと同じでいいので、CDKスタックと呼びます。

まずは、以下を実行します。

```bash
mkdir -p infra
cd infra
npm init -y
npm install aws-cdk-lib@2.278.0 constructs @cdkd/cli@0.366.0
```

次に、`cdk.json`を用意します。

```bash
# 今はinfraディレクトリにいるはず
touch cdk.json
```

```json
{
    "app":"node app.cjs"
}
```

ここで、CDKアプリケーションが`app.cjs`でっせと言っているので、`infra`ディレクトリ直下に`app.cjs`を用意します。

```bash
touch app.cjs
```

```python
const cdk = require("aws-cdk-lib");
const lambda = cdk.aws_lambda;

const app = new cdk.App();
const stack = new cdk.Stack(app, "DjangoWeb", {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: "ap-northeast-1" },
});

const fn = new lambda.WebFunction(stack, "Web", {
  code: lambda.WebFunctionCode.fromAssetToManagedBucket(process.env.WEB_BUILD),
  runtime: lambda.WebFunctionRuntime.of("python3.15"),
  defaultEndpointAuth: lambda.WebFunctionAuthType.IAM_AUTH,
  environment: { DJANGO_SETTINGS_MODULE: "config.lambda_settings" },
});

new cdk.CfnOutput(stack, "EndpointUrl", {
  value: `https://${fn.endpoint.domainName}`,
});

app.synth();
```

ここまでくれば実装完了です。じゃあデプロイ準備に進みましょう。

## 6. BootStrap

これを忘れないようにしましょうね。

```bash
npx cdkd bootstrap --region ap-northeast-1
```

## 7. synth

CDKスタックが問題ないことを確認します。

```bash
npx cdkd synth DjangoWeb
```

## 8. デプロイ！

いざデプロイ！

```bash
npx cdkd deploy DjangoWeb --region ap-northeast-1
```

:::note
僕の家、あまりネットワーク環境良くないんですけど、30~40秒くらいでデプロイ終わったと思います。速い！
:::

こんな感じの結果が返ってくればOK！

```bash
Deployment Summary:
  Stack: DjangoWeb
  Created: 15
  Updated: 0
  Deleted: 0
  Unchanged: 0
  Duration: 28.83s

Outputs:
  DjangoWeb.EndpointUrl = https://xxxxxxxxxxxxxxxx.dcz.lambda-web.ap-northeast-1.on.aws

✓ Deployment completed successfully
```

## 9. ちゃんとデプロイできてるか確認してみる

ターミナルで以下を実行してみましょう。（シェルでPythonをインライン実行してしまいます。）
`host`の値をデプロイ実行結果に記載されていた`DjangoWeb.EndpointUrl`の値に置き換えてください。

```bash
/usr/local/aws/bin/python - <<'PY'
from hashlib import sha256
from http.client import HTTPSConnection

from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.session import Session

host = "xxxxxxxxxxxxxxxx.dcz.lambda-web.ap-northeast-1.on.aws"
path = "/healthz/"

credentials = Session().get_credentials()
if credentials is None:
    raise SystemExit("AWS の認証情報が見つからない")

request = AWSRequest(
    method="GET",
    url=f"https://{host}{path}",
    headers={"Host": host, "X-Amz-Content-SHA256": sha256(b"").hexdigest()},
)
SigV4Auth(credentials.get_frozen_credentials(), "lambda", "ap-northeast-1").add_auth(request)

connection = HTTPSConnection(host, timeout=10)
try:
    connection.request("GET", path, headers=dict(request.headers.items()))
    response = connection.getresponse()
    print(f"HTTP {response.status}")
    print(response.read().decode())
finally:
    connection.close()
PY
```

実行した結果、以下が出てきていればOKです。

```bash
HTTP 200
{"status": "ok"}
```

### ブラウザでURLを叩いても403になる

これは想定通りで、CDKスタックでIAM_AUTHを指定しています。

```js
const fn = new lambda.WebFunction(stack, "Web", {
  // ...略...
  defaultEndpointAuth: lambda.WebFunctionAuthType.IAM_AUTH,
  // ...略...
});
```

この指定により、IAM認証をしないとエンドポイントURLへアクセスができないということになります。

# Lambda Web Functionsでデプロイしていきましょう（DB接続ありページ）

次は、Auroraもデプロイして、APIとして機能するかを確認します。

## 1. Lambda Web FunctionsがDBに接続するための設定を入れる

`config/lambda_settings.py`を以下のように更新します。

```python
import json
import os

import boto3
from botocore.config import Config

from .settings import *

DEBUG = False
ALLOWED_HOSTS = [".lambda-web.ap-northeast-1.on.aws"]

secrets = boto3.client(
    "secretsmanager",
    config=Config(connect_timeout=2, read_timeout=2, retries={"total_max_attempts": 2}),
)
SECRET_KEY = secrets.get_secret_value(SecretId=os.environ["DJANGO_SECRET_ARN"])["SecretString"]
db_credentials = json.loads(
    secrets.get_secret_value(SecretId=os.environ["APP_DB_SECRET_ARN"])["SecretString"]
)

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ["POSTGRES_DB"],
        "HOST": os.environ["POSTGRES_HOST"],
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        "USER": db_credentials["username"],
        "PASSWORD": db_credentials["password"],
        "OPTIONS": {
            "sslmode": "verify-full",
            "sslrootcert": str(BASE_DIR / "rds-ca.pem"),
            "connect_timeout": 35,
        },
    },
}

```

## 2. マイグレーション用スクリプトを用意する

デプロイを実行したときに、マイグレーションが実行されるように、スクリプトを用意します。

```bash
touch migrate_handler.py
```

```python
import json
import os
import subprocess
import sys
from pathlib import Path

import boto3
import psycopg
from psycopg import sql


def configure_api_user(connection, credentials):
    username = credentials["username"]
    encoding = connection.info.encoding
    verifier = connection.pgconn.encrypt_password(
        credentials["password"].encode(encoding),
        username.encode(encoding),
        b"scram-sha-256",
    ).decode("ascii")
    role = sql.Identifier(username)
    with connection.cursor() as cursor:
        cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (username,))
        action = sql.SQL("ALTER ROLE") if cursor.fetchone() else sql.SQL("CREATE ROLE")
        cursor.execute(sql.SQL("{} {} LOGIN PASSWORD {}").format(action, role, sql.Literal(verifier)))
        cursor.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(role))
        cursor.execute(
            sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.posts_post TO {}")
            .format(role)
        )
        cursor.execute(sql.SQL("GRANT USAGE ON SEQUENCE public.posts_post_id_seq TO {}").format(role))


def handler(event, context):
    physical_id = event.get("PhysicalResourceId", "django-aurora-migrations")
    request_type = event["RequestType"]
    if request_type == "Delete":
        return {"PhysicalResourceId": physical_id}
    if request_type not in {"Create", "Update"}:
        raise ValueError(f"Unexpected request type: {request_type}")

    secrets = boto3.client("secretsmanager")
    secret = secrets.get_secret_value(
        SecretId=os.environ["DB_SECRET_ARN"],
    )
    credentials = json.loads(secret["SecretString"])
    root = Path(__file__).resolve().parent
    env = {
        **os.environ,
        "POSTGRES_USER": credentials["username"],
        "POSTGRES_PASSWORD": credentials["password"],
        "PGSSLMODE": "verify-full",
        "PGSSLROOTCERT": str(root / "rds-ca.pem"),
        "PGCONNECT_TIMEOUT": "35",
    }
    subprocess.run(
        [sys.executable, str(root / "manage.py"), "migrate", "--noinput"],
        env=env,
        check=True,
    )

    api_secret = secrets.get_secret_value(SecretId=os.environ["APP_DB_SECRET_ARN"])
    with psycopg.connect(
        dbname=env["POSTGRES_DB"],
        host=env["POSTGRES_HOST"],
        port=env.get("POSTGRES_PORT", "5432"),
        user=credentials["username"],
        password=credentials["password"],
        sslmode=env["PGSSLMODE"],
        sslrootcert=env["PGSSLROOTCERT"],
        connect_timeout=int(env["PGCONNECT_TIMEOUT"]),
    ) as connection:
        configure_api_user(connection, json.loads(api_secret["SecretString"]))

    return {"PhysicalResourceId": physical_id}
```

マイグレーション用のEvent Functionが、Auroraのマスターユーザーで`manage.py migrate`を実行します。続いて、Secrets Managerの認証情報でAPI用のDBユーザー`django_web_api`を作成または更新し、投稿テーブルへの読み書きとID採番に必要な権限を付与します。Web FunctionはこのAPI用ユーザーでAuroraに接続します。

cdkdはカスタムリソースのLambdaから`PhysicalResourceId`を直接受け取れます。このハンドラーは作成・更新時に処理を実行し、削除時はIDを返します。

## 3. スタックを変更する

`infra/app.cjs`を以下のように変更します。（丸々置き換えてOK）

```js
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
```

Auroraの接続先は、CDKの `db.clusterEndpoint.hostname` で参照します。マスターシークレットのARNは、Auroraの作成後に `AwsCustomResource` が `DescribeDBClusters` で取得します。

同じデプロイの中で、Auroraを作成し、Lambda関数でマイグレーションを実行してから、Web Functionのリビジョンを作成します。

## 4. Lambdaのデプロイパッケージを作る

プロジェクト直下の `requirements.txt` に、Secrets Managerへアクセスするための `boto3` を追記します。

```text
boto3==1.44.9
```

次に、`infra/build-lambda.sh` を作ります。このスクリプトはPython 3.15向けのLinux arm64の依存パッケージを取得し、AuroraとのTLS接続に使う東京リージョンのRDS CA証明書を同梱します。Web Function用は `infra/.lambda-build/web`、マイグレーション用は `infra/.lambda-build/migration` に作成します。

```bash
#!/bin/bash
set -euo pipefail

infra_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_dir="$(cd "$infra_dir/.." && pwd)"
build_dir="$infra_dir/.lambda-build"
mkdir -p "$build_dir"

staging="$(mktemp -d "$build_dir/.stage.XXXXXX")"
trap 'rm -rf -- "$staging"' EXIT

cd "$project_dir"
.venv/bin/python -m pip install \
  --platform manylinux_2_28_aarch64 \
  --implementation cp --python-version 3.15 --abi cp315 \
  --only-binary=:all: --no-compile \
  --target "$staging/web" \
  -r requirements.txt

rsync -a --exclude __pycache__ \
  main.py manage.py config posts requirements.txt "$staging/web/"
curl -fsS --retry 2 --max-time 20 \
  https://truststore.pki.rds.amazonaws.com/ap-northeast-1/ap-northeast-1-bundle.pem \
  -o "$staging/web/rds-ca.pem"

mkdir "$staging/migration"
rsync -a "$staging/web/" "$staging/migration/"
cp migrate_handler.py "$staging/migration/"

mkdir -p "$build_dir/web" "$build_dir/migration"
rsync -a --delete "$staging/web/" "$build_dir/web/"
rsync -a --delete "$staging/migration/" "$build_dir/migration/"
printf 'Built Web Function and migration packages in %s\n' "$build_dir"
```

`infra` ディレクトリで実行します。設定やアプリのコードを変更したときも、デプロイ前にこのスクリプトを実行します。

```bash
bash build-lambda.sh
```

## 5. デプロイする

パッケージの作成が終わったら、引き続き `infra` ディレクトリで実行します。

```bash
npx cdkd synth DjangoWeb
npx cdkd deploy DjangoWeb --region ap-northeast-1
```

:::note
`AWS::Lambda::NetworkConnector`, `AWS::RDS::DBInstance`の作成で時間かかりますね...
:::

完了したら、デプロイ出力の `MigrateFunctionName` を使って、CloudWatch Logsの `/aws/lambda/<MigrateFunctionName>` を開きます。Djangoのマイグレーション結果を確認してみましょう。

## 6. APIを実行してみる

まず、ターミナルで以下を実行します。

```bash
posts_api() {                                      
  /usr/local/aws/bin/python - "$@" <<'PY'
import sys
from hashlib import sha256
from http.client import HTTPSConnection

from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.session import Session

host = "xxxxxxxxxxxxxxxx.dcz.lambda-web.ap-northeast-1.on.aws"
method, path = sys.argv[1:3]
body = sys.argv[3].encode("utf-8") if len(sys.argv) > 3 else None
headers = {
    "Host": host,
    "Accept": "application/json",
    "X-Amz-Content-SHA256": sha256(body or b"").hexdigest(),
}
if body is not None:
    headers["Content-Type"] = "application/json"

credentials = Session().get_credentials()
if credentials is None:
    raise SystemExit("AWS の認証情報が見つからない")

request = AWSRequest(method=method, url=f"https://{host}{path}", data=body, headers=headers)
SigV4Auth(credentials.get_frozen_credentials(), "lambda", "ap-northeast-1").add_auth(request)

connection = HTTPSConnection(host, timeout=60)
try:
    connection.request(method, path, body=body, headers=dict(request.headers.items()))
    response = connection.getresponse()
    print(f"HTTP {response.status}")
    print(response.read().decode("utf-8"))
finally:
    connection.close()
PY
}
```

これで、APIを実行するための関数を用意できたので、以下を実行します。

```bash
# 一覧取得
posts_api GET /api/posts/

# 登録
posts_api POST /api/posts/ '{"title":"Lambdaから作成した投稿"}'

# 閲覧
posts_api GET /api/posts/1/
```

これが正常に実行されていれば検証完了です。

# リソースの削除

以下を実行して、リソースの削除をしておきましょう。

```bash
npx cdkd destroy
```

# 今回の検証での注意

## Lambda Web Functionsとは別にマイグレーション用Lambdaを用意

`cdkd deploy`を実行した時のマイグレーションの実行を別のLambdaに切り出しています。そのため、それぞれにデプロイするためのリソースをスクリプトで用意してからデプロイを実行する設計にしています。

Lambda Web Functions用のリソースに関しては、`main.py`, `manage.py`, `config`, `posts`をコピーし、AuroraとのTLS接続で使う東京リージョンのRDS CA証明書を同梱しています。

マイグレーション用に関しては、Web用の中身をコピーし、`manage.py migrate`とAPI用DBユーザーの設定を実行する`migrate_handler.py`を追加しています。

以上のように役割が異なるので、今回は分けるようにしました。

:::note
分けずにLambda Web Functions内でマイグレーションすることもできなくはなさそうですが、**Lambda Web FunctionsにデプロイされたWebアプリが`main.py`を起点として起動することからも、マイグレーションはここから切り離したほうが良いかも**しれないですね。
:::

# 今回の検証に使ったソースコード

以下のリポジトリに検証に使ったソースコードをあげています。

https://github.com/kuracchi-enj/lambda-web-functions-python

:::note
どうやったらTypeScriptを可読性高く書けるのかを知りたい...
:::

# まとめ

Lambda Web FunctionsのPythonランタイムを試してみました。
ちゃんとAPIを叩くことができたので、Djangoで作った画面ありのPython製WebアプリもLambda Web Functionsで動かすことができそうですね。

ただ、DBのマイグレーションを実行するためのスクリプトを用意しなければいけないので、そこに注意が必要かなと思います。今回はLambda関数に切り出して、デプロイ時に呼び出して実行する方法を取りましたが、他にいい方法があれば...（マイグレーションに時間がかかる場合には、Lambda MicroVMsを使うのがいいのかも。）

:::note
Lambdaの最大実行時間が15→30分に伸びているので、基本Lambda関数のほうで大丈夫そうですけどね。（マイグレーションが30分以上かかることってあるのかな。めっちゃ規模がデカかったらあるかもだけど、ケースとしては少なそう）
:::

Elastic Beanstalkの`.ebextensions`みたいに、サービスネイティブに拡張スクリプトを実行できまっせみたいなのがあれば嬉しいかもなぁ...と思いつつ...
