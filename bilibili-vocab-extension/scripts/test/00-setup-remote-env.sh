#!/usr/bin/env bash

set -Eeuo pipefail

REMOTE_ROOT="${TEST_MACHINE_REMOTE_ROOT:-/root/bilibili-vocab-extension}"
PHASE="${TEST_MACHINE_PHASE:-phase-0}"
TASK_CARD="${TEST_MACHINE_TASK_CARD:-P0-TEST-BOOTSTRAP}"
TIMESTAMP="${TEST_MACHINE_TIMESTAMP:-$(date -u +%Y%m%dT%H%M%SZ)}"
LOG_DIR="${TEST_MACHINE_LOG_DIR:-$REMOTE_ROOT/test-results/test-machine/$PHASE/$TASK_CARD/$TIMESTAMP}"
COMMAND_LOG="$LOG_DIR/command.txt"
STDOUT_LOG="$LOG_DIR/stdout.log"
STDERR_LOG="$LOG_DIR/stderr.log"
SUMMARY_LOG="$LOG_DIR/summary.txt"
SCRIPT_NAME="$(basename "$0")"
COMMIT_SHA="${TEST_MACHINE_COMMIT_SHA:-unknown}"
BLOCKS_PHASE="${TEST_MACHINE_BLOCKS_PHASE:-yes}"
MIN_FREE_KB="${TEST_MACHINE_MIN_FREE_KB:-2097152}"
failure_reason="none"

mkdir -p "$LOG_DIR"
: > "$COMMAND_LOG"
: > "$STDOUT_LOG"
: > "$STDERR_LOG"

printf '%s\n' "$SCRIPT_NAME $*" > "$COMMAND_LOG"
exec > >(tee -a "$STDOUT_LOG") 2> >(tee -a "$STDERR_LOG" >&2)

write_summary() {
  local exit_code="$1"
  local status_text="PASS"
  if [ "$exit_code" -ne 0 ]; then
    status_text="FAIL"
  fi

  {
    printf 'commit_sha=%s\n' "$COMMIT_SHA"
    printf 'script=%s\n' "$SCRIPT_NAME"
    printf 'status=%s\n' "$status_text"
    printf 'failure_root_cause=%s\n' "$failure_reason"
    printf 'blocks_phase=%s\n' "$BLOCKS_PHASE"
    printf 'log_dir=%s\n' "$LOG_DIR"
  } > "$SUMMARY_LOG"
}

on_error() {
  if [ "$failure_reason" = "none" ]; then
    failure_reason="command failed at line $1"
  fi
}

trap 'on_error $LINENO' ERR
trap 'status=$?; write_summary "$status"; exit "$status"' EXIT

require_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    failure_reason="missing command: $command_name"
    return 1
  fi
}

resolve_browser() {
  local candidates="chromium chromium-browser google-chrome google-chrome-stable chrome microsoft-edge msedge"
  local candidate
  for candidate in $candidates; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done
  failure_reason="missing browser executable"
  return 1
}

for command_name in bash node pnpm tar zip unzip df; do
  require_command "$command_name"
done

browser_command="$(resolve_browser)"
available_kb="$(df -Pk "$REMOTE_ROOT" 2>/dev/null | awk 'NR==2 { print $4 }')"
if [ -z "$available_kb" ]; then
  available_kb="$(df -Pk /root | awk 'NR==2 { print $4 }')"
fi
if [ -z "$available_kb" ]; then
  failure_reason="unable to resolve free disk space"
  exit 1
fi
if [ "$available_kb" -lt "$MIN_FREE_KB" ]; then
  failure_reason="insufficient disk space: ${available_kb}KB"
  exit 1
fi

mkdir -p "$REMOTE_ROOT" "$REMOTE_ROOT/tmp" "$REMOTE_ROOT/test-results/test-machine"

printf 'node=%s\n' "$(node --version)"
printf 'pnpm=%s\n' "$(pnpm --version)"
printf 'browser=%s\n' "$browser_command"
printf 'available_kb=%s\n' "$available_kb"
printf 'remote_root=%s\n' "$REMOTE_ROOT"
printf 'log_dir=%s\n' "$LOG_DIR"
