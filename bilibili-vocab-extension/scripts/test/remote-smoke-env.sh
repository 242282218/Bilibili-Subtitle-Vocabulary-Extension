REMOTE_SMOKE_BROWSER_CANDIDATES=(
  chromium
  chromium-browser
  google-chrome
  google-chrome-stable
  chrome
  microsoft-edge
  msedge
)

resolve_remote_smoke_browser_path() {
  local smoke_name="$1"
  local candidate
  for candidate in "${REMOTE_SMOKE_BROWSER_CANDIDATES[@]}"; do
    if command -v "$candidate" >/dev/null 2>&1; then
      command -v "$candidate"
      return 0
    fi
  done

  failure_reason="missing browser executable for $smoke_name"
  return 1
}

prepare_remote_smoke_environment() {
  local smoke_name="$1"
  local browser_path

  if [ ! -f "$EXTENSION_DIR/package.json" ]; then
    failure_reason="extension workspace not found: $EXTENSION_DIR"
    return 1
  fi

  if [ -z "${BILI_VOCAB_EXTENSION_BROWSER:-}" ]; then
    browser_path="$(resolve_remote_smoke_browser_path "$smoke_name")" || return 1
    export BILI_VOCAB_EXTENSION_BROWSER="$browser_path"
  fi

  if [ -z "${BILI_VOCAB_EXTENSION_TMPDIR:-}" ]; then
    export BILI_VOCAB_EXTENSION_TMPDIR="$REMOTE_ROOT/tmp"
  fi
}
