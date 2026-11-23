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
