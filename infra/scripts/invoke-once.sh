#!/usr/bin/env bash
#
# Trigger one run of the deployed agent by hand, and tail the logs.
# Useful right after a deploy to confirm the thing actually works up there.

set -euo pipefail

STACK_NAME="${STACK_NAME:-linkedin-tech-meme-agent}"
REGION="${AWS_REGION:-ap-south-1}"
FUNCTION="$STACK_NAME-scheduled"

echo "Invoking $FUNCTION..."
aws lambda invoke \
  --function-name "$FUNCTION" \
  --region "$REGION" \
  --payload '{"source":"manual"}' \
  --cli-binary-format raw-in-base64-out \
  /dev/stdout

echo
echo "Recent logs:"
sam logs --name "$FUNCTION" --region "$REGION" --tail
