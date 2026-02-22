#!/bin/bash
set -e

echo "🐳 Building Pinmoli Docker image..."
docker-compose build

echo ""
echo "✅ Build complete!"
echo ""
echo "Available commands:"
echo "  docker-compose run pinmoli npm test              # Run all tests"
echo "  docker-compose run pinmoli npm test -- test/live/  # Run live tests"
echo "  docker-compose run pinmoli node dist/cli.js      # Run CLI"
echo "  docker-compose run pinmoli npx tsx demo/sip-streaming.ts  # Run demo"
echo ""
