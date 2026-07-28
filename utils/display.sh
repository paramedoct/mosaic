display_image_view() {
  local target
  local record
  local sha
  local source
  local path
  local -a paths
  source_require_command loupe || return 1
  paths=()
  for target in "$@"; do
    record=$(image_require "$target")
    IFS=$'\t' read -r _ sha source _ <<<"$record"
    path=$(image_path "$source" "$sha")
    if [ -r "$path" ]; then
      paths+=("$path")
    fi
  done
  if [ "${#paths[@]}" -eq 0 ]; then return 0; fi
  loupe "${paths[@]}" </dev/null >/dev/null 2>&1
}
