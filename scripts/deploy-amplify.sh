#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

STACK_NAME="${STACK_NAME:-OcrStack}"
API_URL="${PUBLIC_API_BASE_URL:-}"
APP_ID="${AMPLIFY_APP_ID:-}"
BRANCH="${AMPLIFY_BRANCH:-main}"

if [[ -z "$API_URL" || -z "$APP_ID" ]]; then
  echo "Resolving Amplify/API outputs from CloudFormation stack ${STACK_NAME}..."
  API_URL="${API_URL:-$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text)}"
  APP_ID="${APP_ID:-$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='AmplifyAppId'].OutputValue" --output text)}"
  BRANCH="${BRANCH:-$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='AmplifyBranch'].OutputValue" --output text)}"
fi

if [[ -z "$API_URL" || "$API_URL" == "None" ]]; then
  echo "Missing ApiUrl. Deploy the stack first or export PUBLIC_API_BASE_URL." >&2
  exit 1
fi
if [[ -z "$APP_ID" || "$APP_ID" == "None" ]]; then
  echo "Missing AmplifyAppId. Deploy the stack with Amplify resources first." >&2
  exit 1
fi

echo "API: $API_URL"
echo "Amplify app: $APP_ID  branch: $BRANCH"

export PUBLIC_API_BASE_URL="$API_URL"
npm run build -w @ocr/shared
npm run build -w @ocr/web

DIST="$ROOT/apps/web/dist"
ZIP="$ROOT/apps/web/amplify-deploy.zip"
rm -f "$ZIP"
(
  cd "$DIST"
  zip -r "$ZIP" . >/dev/null
)

echo "Creating Amplify deployment..."
CREATE_OUT=$(aws amplify create-deployment --app-id "$APP_ID" --branch-name "$BRANCH" --output json)
JOB_ID=$(python3 -c "import json,sys; print(json.load(sys.stdin)['jobId'])" <<<"$CREATE_OUT")
UPLOAD_URL=$(python3 -c "import json,sys; print(json.load(sys.stdin)['zipUploadUrl'])" <<<"$CREATE_OUT")

echo "Uploading artifact (job $JOB_ID)..."
curl -sS -X PUT -H "Content-Type: application/zip" --data-binary @"$ZIP" "$UPLOAD_URL" >/dev/null

echo "Starting deployment..."
aws amplify start-deployment --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" >/dev/null

echo "Waiting for job to finish..."
while true; do
  STATUS=$(aws amplify get-job --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" --query "job.summary.status" --output text)
  echo "  status=$STATUS"
  case "$STATUS" in
    SUCCEED)
      URL=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query "Stacks[0].Outputs[?OutputKey=='AmplifyUrl'].OutputValue" --output text)
      echo "Deployed: $URL"
      exit 0
      ;;
    FAILED|CANCELLED)
      echo "Amplify job $STATUS" >&2
      aws amplify get-job --app-id "$APP_ID" --branch-name "$BRANCH" --job-id "$JOB_ID" --output json | python3 -m json.tool | tail -60
      exit 1
      ;;
  esac
  sleep 5
done
