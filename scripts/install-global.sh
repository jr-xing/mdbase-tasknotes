#!/usr/bin/env bash
# Build and install mtnj globally.
# Usage: ./scripts/install-global.sh
set -e

cd "$(dirname "$0")/.."

echo "Building..."
npm run build

echo "Installing globally..."
npm install -g .

echo "Done. Verify with: mtnj --version"
