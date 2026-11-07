image_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{ print $1 }'
  elif command -v sha256 >/dev/null 2>&1; then
    sha256 -q "$1"
  else
    echo "sha-256 command not found" >&2
    return 1
  fi
}

image_path() {
  printf '%s/%s/%s\n' "$SCRY_IMAGES_DIR" "$1" "$2"
}

image_file_delete() {
  local source
  local sha
  source=$1
  sha=$2
  rm -f -- "$(image_path "$source" "$sha")"
  rmdir "$SCRY_IMAGES_DIR/$source" 2>/dev/null || true
}

image_require() {
  local record
  record=$(database_value "
SELECT id, sha256, source, mime_type, subject, byte_size
FROM images
WHERE images.id = $1;
")
  if [ -z "$record" ]; then
    echo "image not found: $1" >&2
    return 1
  fi
  printf '%s\n' "$record"
}

image_add() {
  local subject
  local source
  local file
  local sha
  local existing_id
  local mime
  local size
  local target_dir
  local target
  local temporary
  local id
  subject=$1
  source=$2
  file=$3
  sha=$(image_sha256 "$file")
  existing_id=$(database_value \
    "SELECT id FROM images WHERE sha256 = $(database_quote "$sha");")
  if [ -n "$existing_id" ]; then
    echo "duplicate image skipped: sha256 $sha" >&2
    return 2
  fi
  mime=$(file -b --mime-type -- "$file")
  case "$mime" in
    image/*) ;;
    *)
      echo "not an image file: $file" >&2
      return 1
      ;;
  esac
  size=$(wc -c <"$file" | tr -d '[:space:]')
  target_dir=$SCRY_IMAGES_DIR/$source
  target=$(image_path "$source" "$sha")
  mkdir -p "$target_dir"
  temporary=$(mktemp "$target_dir/.${sha}.XXXXXX")
  if ! cp -- "$file" "$temporary"; then
    rm -f "$temporary"
    return 1
  fi
  chmod 600 "$temporary"
  if ! mv "$temporary" "$target"; then
    rm -f "$temporary"
    return 1
  fi
  if ! id=$(database_value "
INSERT INTO images (subject, source, sha256, mime_type, byte_size)
VALUES ($(database_quote "$subject"), $(database_quote "$source"),
        $(database_quote "$sha"), $(database_quote "$mime"), $size);
SELECT id FROM images WHERE sha256 = $(database_quote "$sha");"); then
    rm -f "$target"
    return 1
  fi
  printf '%s\n' "$id"
}

image_remove() {
  local id
  local record
  local sha
  local source
  id=$1
  record=$(image_require "$id")
  IFS=$'\t' read -r _ sha source _ _ _ <<<"$record"
  database_run "DELETE FROM images WHERE id = $id;"
  image_file_delete "$source" "$sha"
}

image_archive_add() (
  local subject
  local source
  local archive
  local work_dir
  local entries_file
  local entry
  local file
  local mime
  local image_id
  local count
  local status
  local -a image_ids
  local -a files
  subject=$1
  source=$2
  archive=$3
  source_require_command unzip || return 1
  work_dir=$(mktemp -d "$SCRY_STATE_DIR/.archive.XXXXXX")
  trap 'rm -rf "$work_dir"' EXIT
  entries_file=$work_dir/entries
  image_ids=()
  files=()
  if ! unzip -Z1 "$archive" >"$entries_file"; then
    echo "invalid zip archive" >&2
    return 1
  fi
  count=0
  while IFS= read -r entry; do
    case "$entry" in
      '' | */) continue ;;
    esac
    count=$((count + 1))
    file=$work_dir/$count
    if ! unzip -p "$archive" "$entry" >"$file"; then
      echo "could not extract zip entry: $entry" >&2
      return 1
    fi
    mime=$(file -b --mime-type -- "$file")
    case "$mime" in
      image/*) ;;
      *)
        echo "zip entry is not an image: $entry" >&2
        return 1
        ;;
    esac
    files+=("$file")
  done <"$entries_file"
  if [ "${#files[@]}" -eq 0 ]; then
    echo "zip archive contains no images" >&2
    return 1
  fi
  for file in "${files[@]}"; do
    if image_id=$(image_add "$subject" "$source" "$file"); then
      image_ids+=("$image_id")
      continue
    else
      status=$?
    fi
    for image_id in "${image_ids[@]}"; do
      image_remove "$image_id"
    done
    if [ "$status" -eq 2 ]; then
      echo "archive skipped: zip contains a duplicate image" >&2
      return 2
    fi
    return "$status"
  done
  printf '%s\n' "${image_ids[@]}"
)
