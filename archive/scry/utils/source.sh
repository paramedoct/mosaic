source_modules() {
  local module
  for module in "$@"; do
    # shellcheck source=/dev/null
    source "$ROOT_DIR/$module"
  done
}

source_require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "$1 command not found" >&2
    return 1
  fi
}
