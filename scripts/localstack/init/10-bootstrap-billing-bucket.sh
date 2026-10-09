#!/bin/sh
# LocalStack-only initialization hook. It runs inside the local container after S3 is ready.
set -eu

bucket="billing-documents"

if awslocal s3api head-bucket --bucket "$bucket" >/dev/null 2>&1; then
  echo "[billing-localstack] bucket already exists: $bucket"
  exit 0
fi

awslocal s3api create-bucket --bucket "$bucket" --region us-east-1 >/dev/null
echo "[billing-localstack] bucket created: $bucket"
