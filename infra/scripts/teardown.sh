#!/usr/bin/env bash
#
# Delete the whole stack, including the DynamoDB table and its data.
# Asks first, because the post history is not recoverable afterwards.

set -euo pipefail

STACK_NAME="${STACK_NAME:-linkedin-tech-meme-agent}"
REGION="${AWS_REGION:-ap-south-1}"

echo "This deletes stack '$STACK_NAME' in $REGION, including the DynamoDB"
echo "table with every article, post and learning the agent has stored."
read -rp "Type the stack name to confirm: " confirm

[[ "$confirm" == "$STACK_NAME" ]] || { echo "Cancelled."; exit 1; }

sam delete --stack-name "$STACK_NAME" --region "$REGION" --no-prompts
