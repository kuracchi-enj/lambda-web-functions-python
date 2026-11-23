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
