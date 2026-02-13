#!/bin/bash
# OpenClaw Email Gateway - Docker entrypoint
set -e

DATA_DIR="${OPENCLAW_STATE_DIR:-/data}"
HOME_CONFIG="$HOME/.openclaw"

# Symlink ~/.openclaw -> /data so config and state persist in the volume
if [ ! -L "$HOME_CONFIG" ]; then
  rm -rf "$HOME_CONFIG"
  ln -s "$DATA_DIR" "$HOME_CONFIG"
fi

mkdir -p "$DATA_DIR"

# Copy default config if not already present (preserves user modifications)
if [ ! -f "$DATA_DIR/openclaw.json" ]; then
  cp /app/scripts/docker/email-gateway-config.json "$DATA_DIR/openclaw.json"
  echo "Config initialized at $DATA_DIR/openclaw.json"
fi

exec node dist/index.js gateway --allow-unconfigured --bind lan --port 3000
