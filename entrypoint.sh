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
  # Fail fast: tcpdump must be installed
  if ! command -v tcpdump >/dev/null 2>&1; then
    echo "FATAL: tcpdump not found. Rebuild the Docker image: docker compose build" >&2
    exit 1
  fi

  # Fail fast: /app/captures must be writable (volume-mounted to host)
  mkdir -p /app/captures
  VERIFY_FILE="/app/captures/.verify-$$"
  if ! touch "$VERIFY_FILE" 2>/dev/null; then
    echo "FATAL: Cannot write to /app/captures/. Mount a volume:" >&2
    echo "  docker run -v \$(pwd)/captures:/app/captures ..." >&2
    exit 1
  fi
  rm -f "$VERIFY_FILE"

  # Verify host visibility — detect ephemeral container filesystem
  # If /app/captures is NOT a mount point, files won't survive container exit
  if ! mountpoint -q /app/captures 2>/dev/null && ! mountpoint -q /app 2>/dev/null; then
    echo "WARNING: /app/captures is not volume-mounted. Pcap files will be lost when the container exits." >&2
    echo "  Fix: docker run -v \$(pwd)/captures:/app/captures ..." >&2
    echo "  Or:  docker compose up -d (bind mount in docker-compose.yml)" >&2
    echo "  Disable: PINMOLI_NO_CAPTURE=1" >&2
    echo "" >&2
  fi

  PCAP_FILE="/app/captures/pinmoli-$(date +%Y%m%d-%H%M%S).pcap"
  tcpdump -i any -U -s 0 -w "$PCAP_FILE" \
    'port 5060 or (udp and portrange 10000-65535)' 2>/dev/null &
  TCPDUMP_PID=$!

  # Verify tcpdump actually started (might fail without CAP_NET_RAW)
  sleep 0.1
  if ! kill -0 "$TCPDUMP_PID" 2>/dev/null; then
    echo "FATAL: tcpdump failed to start. Container may need --cap-add NET_RAW or --privileged." >&2
    exit 1
  fi

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
