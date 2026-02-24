#!/bin/bash

echo "🎙️  Starting Pinmoli with pi-tui"
echo ""
echo "Try these commands:"
echo "  test sip:5eezfwavhxe.sip.livekit.cloud with OPTIONS"
echo "  make an INVITE call using opus codec"
echo "  list my saved tests"
echo "  clear (clear messages)"
echo "  exit (quit)"
echo ""
echo "Starting..."
sleep 2

cd "$(dirname "$0")"
node dist/index.js
