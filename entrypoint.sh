#!/bin/sh
set -e

# Smart init: generate audio samples if missing
if [ ! -f /app/audio-samples/sine-440hz.wav ]; then
  echo "First run — generating audio samples..."
  sh generate-audio-samples.sh
fi

# --- Continuous pcap capture ---
# Captures all SIP signaling (port 5060) and RTP/SRTP media (high UDP ports).
# Runs in the background for the entire session. Opens in Wireshark as-is.
# Disable with PINMOLI_NO_CAPTURE=1 if not needed.
if [ "${PINMOLI_NO_CAPTURE:-}" != "1" ]; then
  mkdir -p /app/captures
  PCAP_FILE="/app/captures/pinmoli-$(date +%Y%m%d-%H%M%S).pcap"
  tcpdump -i any -U -s 0 -w "$PCAP_FILE" \
    'port 5060 or (udp and portrange 10000-65535)' 2>/dev/null &
  TCPDUMP_PID=$!
  echo "Packet capture: $PCAP_FILE"
fi

# Cleanup tcpdump on any exit (normal, signal, error)
cleanup() {
  if [ -n "${TCPDUMP_PID:-}" ] && kill -0 "$TCPDUMP_PID" 2>/dev/null; then
    kill "$TCPDUMP_PID" 2>/dev/null || true
    wait "$TCPDUMP_PID" 2>/dev/null || true
    echo ""
    echo "Capture saved: $PCAP_FILE"
  fi
}
trap cleanup EXIT

# Hand off to tini (PID 1: signal forwarding + zombie reaping)
# Not using exec — trap needs to fire for tcpdump cleanup
/sbin/tini -s -- npx tsx src/cli.ts "$@"
