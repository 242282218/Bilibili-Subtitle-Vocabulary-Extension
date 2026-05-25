#!/usr/bin/env bash

set -Eeuo pipefail

REMOTE_ROOT="${TEST_MACHINE_REMOTE_ROOT:-/root/bilibili-vocab-extension}"
if [ "$REMOTE_ROOT" != "/" ]; then
  REMOTE_ROOT="${REMOTE_ROOT%/}"
fi
EXTENSION_DIR="${TEST_MACHINE_EXTENSION_DIR:-$REMOTE_ROOT/bilibili-vocab-extension}"
if [ "$EXTENSION_DIR" != "/" ]; then
  EXTENSION_DIR="${EXTENSION_DIR%/}"
fi
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

validate_remote_root() {
  local root_without_slashes="${REMOTE_ROOT//\//}"
  if [ -z "$REMOTE_ROOT" ] || [[ "$REMOTE_ROOT" != /* ]] || [ -z "$root_without_slashes" ] || [[ "$REMOTE_ROOT" == *"/../"* ]] || [[ "$REMOTE_ROOT" == */.. ]]; then
    failure_reason="invalid TEST_MACHINE_REMOTE_ROOT: $REMOTE_ROOT"
    printf '%s\n' "$failure_reason" >&2
    exit 1
  fi
}

validate_log_path_segment() {
  local field_name="$1"
  local value="$2"
  if [ -z "$value" ] || [[ "$value" == */* ]] || [ "$value" = "." ] || [ "$value" = ".." ]; then
    failure_reason="invalid $field_name: $value"
    printf '%s\n' "$failure_reason" >&2
    exit 1
  fi
}

validate_summary_fields() {
  if [ "$COMMIT_SHA" != "unknown" ] && [[ ! "$COMMIT_SHA" =~ ^[0-9a-fA-F]{40}$ ]]; then
    failure_reason="invalid TEST_MACHINE_COMMIT_SHA: $COMMIT_SHA"
    printf '%s\n' "$failure_reason" >&2
    exit 1
  fi
  if [ "$BLOCKS_PHASE" != "yes" ] && [ "$BLOCKS_PHASE" != "no" ]; then
    failure_reason="invalid TEST_MACHINE_BLOCKS_PHASE: $BLOCKS_PHASE"
    printf '%s\n' "$failure_reason" >&2
    exit 1
  fi
}

validate_log_dir() {
  local remote_root_base="${REMOTE_ROOT%/}"
  local expected_log_dir="$remote_root_base/test-results/test-machine/$PHASE/$TASK_CARD/$TIMESTAMP"
  local log_dir_suffix="${LOG_DIR#"$expected_log_dir"}"
  if [ -z "$LOG_DIR" ] || [[ "$LOG_DIR" != /* ]] || [[ "$LOG_DIR" == *"/../"* ]] || [[ "$LOG_DIR" == */.. ]] || [[ "$LOG_DIR" != "$expected_log_dir"* ]]; then
    failure_reason="invalid TEST_MACHINE_LOG_DIR: $LOG_DIR"
    printf '%s\n' "$failure_reason" >&2
    exit 1
  fi
  if [ -n "$log_dir_suffix" ] && { [[ "$log_dir_suffix" != -* ]] || [[ "$log_dir_suffix" == */* ]]; }; then
    failure_reason="invalid TEST_MACHINE_LOG_DIR: $LOG_DIR"
    printf '%s\n' "$failure_reason" >&2
    exit 1
  fi
}

format_summary_value() {
  local value="$1"
  value="${value//$'\r'/ }"
  value="${value//$'\n'/ }"
  printf '%s' "$value"
}

validate_extension_dir() {
  local expected_extension_dir="$REMOTE_ROOT/bilibili-vocab-extension"
  if [ -z "$EXTENSION_DIR" ] || [[ "$EXTENSION_DIR" != /* ]] || [[ "$EXTENSION_DIR" == *"/../"* ]] || [[ "$EXTENSION_DIR" == */.. ]] || [ "$EXTENSION_DIR" != "$expected_extension_dir" ]; then
    failure_reason="invalid TEST_MACHINE_EXTENSION_DIR: $EXTENSION_DIR"
    exit 1
  fi
}

validate_remote_root
validate_log_path_segment "TEST_MACHINE_PHASE" "$PHASE"
validate_log_path_segment "TEST_MACHINE_TASK_CARD" "$TASK_CARD"
validate_log_path_segment "TEST_MACHINE_TIMESTAMP" "$TIMESTAMP"
validate_summary_fields
validate_log_dir

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
    printf 'failure_root_cause=%s\n' "$(format_summary_value "$failure_reason")"
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

validate_extension_dir

for browser_pattern in chromium chromium-browser google-chrome google-chrome-stable chrome msedge microsoft-edge playwright; do
  pkill -f "$browser_pattern" >/dev/null 2>&1 || true
done

rm -rf "$REMOTE_ROOT/tmp"/*
rm -rf /tmp/bili-vocab-extension-smoke-* /tmp/bili-vocab-zip-smoke-* /tmp/bili-vocab-real-site-* /tmp/playwright-artifacts-* 2>/dev/null || true
rm -rf "$EXTENSION_DIR/playwright-report" "$EXTENSION_DIR/extension.zip" 2>/dev/null || true

sleep 1

if command -v pgrep >/dev/null 2>&1; then
  if pgrep -af 'chromium|chrome|msedge|playwright' >/dev/null 2>&1; then
    failure_reason="browser processes remain after cleanup"
    pgrep -af 'chromium|chrome|msedge|playwright' || true
    exit 1
  fi
fi

printf 'cleanup_root=%s\n' "$REMOTE_ROOT"
printf 'log_dir=%s\n' "$LOG_DIR"
