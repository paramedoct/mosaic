database_quote() {
  local value
  value=$1
  value=${value//\'/\'\'}
  printf "'%s'\n" "$value"
}

database_run() {
  sqlite3 -batch -bail -cmd 'PRAGMA foreign_keys = ON;' "$SCRY_DB_FILE" "$1"
}

database_value() {
  sqlite3 -batch -bail -noheader -separator $'\t' \
    -cmd 'PRAGMA foreign_keys = ON;' "$SCRY_DB_FILE" "$1"
}

database_cleanup() {
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

database_init() {
  local sql
  local violations
  sql=$(cat <<'SQL'
CREATE TABLE IF NOT EXISTS images (
  id INTEGER PRIMARY KEY,
  subject TEXT NOT NULL CHECK(subject <> ''),
  source TEXT NOT NULL CHECK(source <> ''),
  sha256 TEXT NOT NULL UNIQUE
    CHECK(length(sha256) = 64 AND sha256 = lower(sha256)),
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK(byte_size >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

CREATE INDEX IF NOT EXISTS images_classification_idx
ON images(subject, source);
SQL
)
  database_run "$sql"
  violations=$(database_value "PRAGMA foreign_key_check;")
  if [ -n "$violations" ]; then
    echo "foreign key check failed" >&2
    return 1
  fi
}

database_prepare() {
  SCRY_HOME=${SCRY_HOME:-"$HOME/.config/scry"}
  SCRY_IMAGES_DIR=$SCRY_HOME/images
  SCRY_STATE_DIR=$SCRY_HOME/state
  SCRY_DB_FILE=$SCRY_STATE_DIR/scry.db
  mkdir -p "$SCRY_IMAGES_DIR" "$SCRY_STATE_DIR"
  database_init
}
