#!/bin/sh
# Run all interactive call scenarios against the LiveKit endpoint.
# Usage: docker compose exec pinmoli sh test/scenarios/run-all.sh

set -eu

SCENARIOS_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="/app/captures/scenario-results-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RESULTS_DIR"

echo "=== Pinmoli Scenario Runner ==="
echo "Results: $RESULTS_DIR"
echo ""

passed=0
failed=0
total=0

for scenario in "$SCENARIOS_DIR"/*.txt; do
  name="$(basename "$scenario" .txt)"
  total=$((total + 1))

  echo "--- Scenario: $name ---"
  stderr_log="$RESULTS_DIR/${name}-stderr.log"
  stdout_log="$RESULTS_DIR/${name}-stdout.log"

  set +e
  npx tsx src/cli-pipe.ts < "$scenario" > "$stdout_log" 2> "$stderr_log"
  exit_code=$?
  set -e

  # Count RTP packets received across all receive_audio calls
  packets=$(grep -o 'Received [0-9]* RTP packets' "$stderr_log" 2>/dev/null | grep -o '[0-9]*' | awk '{s+=$1}END{print s+0}' 2>/dev/null || echo 0)
  # Check if call was established
  established=$(grep -c "Call established" "$stderr_log" 2>/dev/null || echo 0)
  # Check for BYE
  bye_sent=$(grep -c "Sending BYE" "$stderr_log" 2>/dev/null || echo 0)

  if [ "$established" -gt 0 ] && [ "$bye_sent" -gt 0 ]; then
    status="PASS"
    passed=$((passed + 1))
  else
    status="FAIL"
    failed=$((failed + 1))
  fi

  echo "  Status: $status | Call: ${established}x established | BYE: ${bye_sent}x | RTP in: ${packets} packets | Exit: $exit_code"
  echo "  Logs: $stderr_log"
  echo ""
done

echo "=== Results: $passed/$total passed, $failed failed ==="
echo "Full logs: $RESULTS_DIR"
