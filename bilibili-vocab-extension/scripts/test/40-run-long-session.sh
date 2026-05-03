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

failure_reason="long-session validation remains a Phase 3 follow-up and is not implemented in Phase 0"
printf '%s\n' "$failure_reason"
exit 64
