#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -lt 5 ] || [ "$4" != "--" ]; then
  echo 'Usage: run-bounded-command <name> <seconds> <log-path> -- <command> [args...]' >&2
  exit 64
fi

name="$1"
limit="$2"
log_path="$3"
shift 4

case "$limit" in
  ''|*[!0-9]*)
    echo "CI bounded test has an invalid limit for $name: $limit" >&2
    exit 64
    ;;
esac
if [ "$limit" -eq 0 ]; then
  echo "CI bounded test has a zero limit for $name" >&2
  exit 64
fi

mkdir -p "$(dirname "$log_path")"
started_epoch="$SECONDS"
printf 'Running bounded CI test: %s (limit %ss)\n' "$name" "$limit" | tee "$log_path"

set +e
timeout --signal=TERM --kill-after=30s "${limit}s" "$@" 2>&1 | tee -a "$log_path"
statuses=("${PIPESTATUS[@]}")
command_status="${statuses[0]}"
tee_status="${statuses[1]}"
set -e
elapsed_seconds=$((SECONDS - started_epoch))
printf 'Finished bounded CI test: %s (exit %s, duration %ss)\n' "$name" "$command_status" "$elapsed_seconds" | tee -a "$log_path"

if [ "$tee_status" -ne 0 ]; then
  echo "CI diagnostic log could not be retained: $name (exit $tee_status)" >&2
  exit "$tee_status"
fi
if [ "$command_status" -ne 0 ]; then
  echo "CI test failed or timed out: $name (exit $command_status; duration ${elapsed_seconds}s; log $log_path)" >&2
  exit "$command_status"
fi
