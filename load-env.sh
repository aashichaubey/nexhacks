#!/usr/bin/env bash
# Load environment variables from .env file

if [ -f .env ]; then
  echo "Loading environment variables from .env file..."
  export $(grep -v '^#' .env | xargs)
  echo "✓ Environment variables loaded"
  echo "  LIVEKIT_URL: ${LIVEKIT_URL:-not set}"
  echo "  LIVEKIT_TOKEN: ${LIVEKIT_TOKEN:-not set}"
else
  echo "⚠ .env file not found. Create one from .env.example"
fi

