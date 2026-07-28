garbage_collect() {
  local records
  local id
  local sha
  local source
  local path
  records=$(database_value "
SELECT id, sha256, source
FROM images
ORDER BY id;
")
  while IFS=$'\t' read -r id sha source; do
    [ -n "$id" ] || continue
    path=$(image_path "$source" "$sha")
    if [ ! -e "$path" ]; then
      image_remove "$id"
      echo "removed missing image metadata: $id" >&2
    fi
  done <<<"$records"
}
