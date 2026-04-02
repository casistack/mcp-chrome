#!/bin/bash
set -e

# Pack the native server for global install, bundling the shared package
# This solves the workspace:* dependency issue

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE_DIR="$REPO_ROOT/app/native-server"
SHARED_DIR="$REPO_ROOT/packages/shared"

echo "Building shared package..."
cd "$REPO_ROOT"
pnpm run build:shared

echo "Packing shared package..."
cd "$SHARED_DIR"
SHARED_TGZ=$(npm pack --pack-destination "$NATIVE_DIR" 2>&1 | tail -1)
echo "Shared package: $SHARED_TGZ"

echo "Building native server..."
cd "$REPO_ROOT"
pnpm run build:native

echo "Patching package.json for global install..."
cd "$NATIVE_DIR"
# Replace workspace:* with local tarball reference
cp package.json package.json.bak
sed -i "s|\"chrome-mcp-shared\": \"workspace:\\*\"|\"chrome-mcp-shared\": \"file:./$SHARED_TGZ\"|" package.json

# Include the shared tarball in the package files
sed -i 's|"files": \[|"files": [\n    "'"$SHARED_TGZ"'",|' package.json

echo "Creating native server package..."
npm pack

echo "Restoring original package.json..."
mv package.json.bak package.json

echo ""
echo "Installing globally..."
npm install -g ./mcp-chrome-bridge-*.tgz

echo ""
echo "Registering native messaging host..."
mcp-chrome-bridge register

echo ""
echo "Cleaning up..."
rm -f "$NATIVE_DIR/$SHARED_TGZ"
rm -f "$NATIVE_DIR"/mcp-chrome-bridge-*.tgz

echo ""
echo "Done! Run 'mcp-chrome-bridge --version' to verify."
