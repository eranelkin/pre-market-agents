#!/bin/bash
# Switch the active prompts between test and production.
#
# Usage:
#   ./use-prompts.sh test        — fast stubs for dev/testing
#   ./use-prompts.sh production  — full prompts for real runs

set -e

VARIANT="${1:?Usage: $0 test|production}"
DIR="prompts/$VARIANT"

if [ ! -d "$DIR" ]; then
  echo "Error: folder '$DIR' not found." >&2
  exit 1
fi

cp "$DIR"/*.md prompts/
echo "Active prompts switched to: $VARIANT"
echo "Reload without restart: curl -X POST http://localhost:3301/api/v1/prompts/reload"
