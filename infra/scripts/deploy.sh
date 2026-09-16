#!/usr/bin/env bash
#
# Deploy the LinkedIn agent to AWS Lambda.
#
# Needs: the AWS SAM CLI and AWS credentials with permission to create Lambda
# functions, a DynamoDB table and an EventBridge rule. No Docker.
#
#   ./infra/scripts/deploy.sh                 deploy with DRY_RUN=true
#   ./infra/scripts/deploy.sh --live          deploy with real publishing on
#
# Secrets are read from .env so they never end
# up in shell history or a committed config file.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
STACK_NAME="${STACK_NAME:-linkedin-tech-meme-agent}"
REGION="${AWS_REGION:-ap-south-1}"

DRY_RUN=true
PUBLISHER=console

if [[ "${1:-}" == "--live" ]]; then
  DRY_RUN=false
  PUBLISHER=linkedin
  echo "WARNING: deploying with live publishing enabled."
  read -rp "Type 'yes' to continue: " confirm
  [[ "$confirm" == "yes" ]] || { echo "Cancelled."; exit 1; }
fi

if [[ ! -f "$ROOT/.env" ]]; then
  echo "Missing $ROOT/.env - copy .env.example and fill it in first." >&2
  exit 1
fi

# Pull just the values the stack needs out of .env.
read_env() {
  grep -E "^$1=" "$ROOT/.env" | tail -1 | cut -d= -f2- || true
}

OPENAI_API_KEY="$(read_env OPENAI_API_KEY)"
LINKEDIN_ACCESS_TOKEN="$(read_env LINKEDIN_ACCESS_TOKEN)"
LINKEDIN_MEMBER_ID="$(read_env LINKEDIN_MEMBER_ID)"
ADMIN_API_KEY="$(read_env ADMIN_API_KEY)"

if [[ -z "$OPENAI_API_KEY" ]]; then
  echo "OPENAI_API_KEY is empty in .env" >&2
  exit 1
fi

if [[ -z "$ADMIN_API_KEY" || "$ADMIN_API_KEY" == "change-me-to-a-long-random-string" ]]; then
  echo "Set a real ADMIN_API_KEY in .env before deploying." >&2
  exit 1
fi

# Builds infra/build/, which the template uses as its CodeUri. We do this
# ourselves rather than via `sam build` because the package needs the Linux
# arm64 sharp binary and the bundled fonts, neither of which sam build knows
# about.
"$ROOT/infra/scripts/build.sh"

echo
echo "Deploying stack '$STACK_NAME' to $REGION..."
sam deploy \
  --template "$ROOT/infra/template.yaml" \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides \
    "DryRun=$DRY_RUN" \
    "Publisher=$PUBLISHER" \
    "OpenAiApiKey=$OPENAI_API_KEY" \
    "LinkedInAccessToken=$LINKEDIN_ACCESS_TOKEN" \
    "LinkedInMemberId=$LINKEDIN_MEMBER_ID" \
    "AdminApiKey=$ADMIN_API_KEY"

echo
echo "Done. Admin URL:"
aws cloudformation describe-stacks \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --query 'Stacks[0].Outputs[?OutputKey==`AdminUrl`].OutputValue' \
  --output text
