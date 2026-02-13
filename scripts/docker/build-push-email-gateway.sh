#!/bin/bash
# Build the email gateway image for linux/amd64 and push to a registry.
# Run from repo root. Set EMAIL_GATEWAY_IMAGE to override the image tag.
set -e

REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$REPO_ROOT"

IMAGE="${EMAIL_GATEWAY_IMAGE:-docker.io/openclaw/openclaw-email-gateway:latest}"

echo "Building for linux/amd64: $IMAGE"
docker build \
  --platform linux/amd64 \
  -t "$IMAGE" \
  -f Dockerfile.email-gateway \
  .

echo "Pushing $IMAGE"
docker push "$IMAGE"

echo "Done. Image: $IMAGE"
