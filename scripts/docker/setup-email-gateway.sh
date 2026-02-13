#!/bin/bash
# Build and run the OpenClaw email gateway in Docker.
# Run from repo root. Loads .env if present.
set -e

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_ROOT"

# Load .env so docker-compose sees RESEND_*, BOT_EMAIL, etc.
if [ -f .env ]; then
  set -a
  # shellcheck source=/dev/null
  source .env
  set +a
  echo "Loaded .env"
fi

# Compose parses the whole file; other services need these or volume specs become invalid
export OPENCLAW_CONFIG_DIR="${OPENCLAW_CONFIG_DIR:-$HOME/.openclaw}"
export OPENCLAW_WORKSPACE_DIR="${OPENCLAW_WORKSPACE_DIR:-$HOME/.openclaw/workspace}"

# Fail fast if required vars are missing
require_var() {
  if [ -z "${!1}" ]; then
    echo "Missing required env: $1 (set in .env or environment)" >&2
    exit 1
  fi
}
require_var RESEND_API_KEY
require_var RESEND_WEBHOOK_SECRET
require_var BOT_EMAIL
require_var OPENCLAW_GATEWAY_TOKEN
# At least one AI provider (config default is openai/gpt-4o)
if [ -z "${ANTHROPIC_API_KEY}" ] && [ -z "${OPENAI_API_KEY}" ]; then
  echo "Set OPENAI_API_KEY or ANTHROPIC_API_KEY in .env" >&2
  exit 1
fi

echo "Building email gateway image..."
docker compose build openclaw-email-gateway

echo "Starting openclaw-email-gateway..."
docker compose up -d openclaw-email-gateway

echo "Email gateway is up on port 3000. Logs: docker compose logs -f openclaw-email-gateway"
