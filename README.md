# Django REST API on Lambda Web Functions

Django REST Frameworkで作った投稿APIを、AWS Lambda Web FunctionsのPythonランタイムで動かすサンプル。ローカルではDocker ComposeのPostgreSQL、AWSではAurora PostgreSQL Serverless v2を使う。検証の経緯とコードの解説は [ART.md](ART.md) にまとめている。

## ローカルで起動する

Python 3.14とDocker Composeを使う。プロジェクトのルートで実行する。

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
docker compose up -d --wait db
python manage.py migrate
python manage.py runserver
```

別のターミナルから、起動確認と投稿の一覧取得・作成を試せる。

```bash
curl -fsS http://127.0.0.1:8000/healthz/
curl -fsS http://127.0.0.1:8000/api/posts/
curl -fsS -X POST http://127.0.0.1:8000/api/posts/ \
  -H 'Content-Type: application/json' \
  -d '{"title":"最初の投稿"}'
```

| メソッド | パス | 動作 |
| --- | --- | --- |
| GET | `/healthz/` | Djangoの起動確認 |
| GET、POST | `/api/posts/` | 投稿の一覧取得・作成 |
| GET、PUT、PATCH、DELETE | `/api/posts/<id>/` | 投稿の詳細取得・更新・削除 |

詳細URLの `<id>` には、POSTのレスポンスで返った `id` を使う。

## AWSにデプロイする

東京リージョン（`ap-northeast-1`）向けの構成。上の手順で作った `.venv` とPythonの依存ライブラリに加え、Node.js 22.12以上、npm、Bash、rsync、curl、デプロイ先のAWS認証情報が必要。Web Functionは [Python 3.15のプレビューランタイム](https://aws.amazon.com/about-aws/whats-new/2026/11/aws-lambda-python-315/) を使う。

プロジェクトのルートから実行する。同じAWSアカウント・リージョンでの `cdkd bootstrap` は初回に実行する。

```bash
cd infra
npm ci
bash build-lambda.sh
npx cdkd bootstrap --region ap-northeast-1
npx cdkd synth DjangoWeb --region ap-northeast-1
npx cdkd deploy DjangoWeb --region ap-northeast-1
```

ビルドではPython 3.15のLinux arm64向け依存ライブラリとRDS CA証明書を、Web用・マイグレーション用のパッケージにまとめる。1回の `deploy` でAuroraを作成し、Event FunctionがスキーマのマイグレーションとAPI用DBユーザーの設定を行ったあと、Web Functionのリビジョンを作成する。この1回デプロイ構成は `synth` まで確認済み。

### AWSで動作を確認する

`infra` ディレクトリで実行する。`ENDPOINT_URL` にはデプロイ出力の `EndpointUrl` を `https://` から入力する。エンドポイントはIAM認証を使うため、呼び出し元に `lambda:InvokeWebFunctionEndpoint` が必要。以下はそのAWS認証情報でリクエストをSigV4署名する。 [AWSのエンドポイント認証](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html)

```bash
export ENDPOINT_URL='https://<デプロイ出力のホスト名>'
../.venv/bin/python - <<'PY'
from hashlib import sha256
import os
from urllib.request import Request, urlopen

from botocore.auth import SigV4Auth
from botocore.awsrequest import AWSRequest
from botocore.session import get_session

endpoint = os.environ["ENDPOINT_URL"].rstrip("/")
credentials = get_session().get_credentials()
if credentials is None:
    raise SystemExit("AWSの認証情報が見つからない")

signer = SigV4Auth(credentials.get_frozen_credentials(), "lambda", "ap-northeast-1")
for path in ("/healthz/", "/api/posts/"):
    request = AWSRequest(
        method="GET",
        url=f"{endpoint}{path}",
        headers={"X-Amz-Content-SHA256": sha256(b"").hexdigest()},
    )
    signer.add_auth(request)
    with urlopen(Request(request.url, headers=dict(request.headers.items())), timeout=65) as response:
        print(f"{path} HTTP {response.status}")
        print(response.read().decode("utf-8"))
PY
```

`/healthz/` でWeb Function上のDjangoの起動を、`/api/posts/` でAuroraから投稿を読み取れることを確認できる。マイグレーションのログはCloudWatch Logsの `/aws/lambda/<MigrateFunctionName>` に出力される。`MigrateFunctionName` はデプロイ出力に表示される。

### AWSリソースを削除する

`infra` ディレクトリで実行する。

```bash
npx cdkd destroy DjangoWeb --region ap-northeast-1
```

削除後はAuroraの最終スナップショットとCloudWatchロググループの残存を確認する。
