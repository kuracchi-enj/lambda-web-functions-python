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
