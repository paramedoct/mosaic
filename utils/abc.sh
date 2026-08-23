# shellcheck shell=bash
ABC_DIR="$ROOT_DIR/abc"

abc_error() {
  echo "$1" >&2
  return 1
}

abc_parse_reference() {
  local reference
  reference=$1
  case "$reference" in
    *:*)
      abc_name=${reference%%:*}
      abc_number=${reference#*:}
      ;;
    *)
      abc_error "usage: $0 <name:Xnum>"
      ;;
  esac
  case "$abc_name" in
    ''|.|..|*/*)
      abc_error "invalid abc name: $abc_name"
      ;;
  esac
  case "$abc_number" in
    ''|*[!0-9]*)
      abc_error "invalid X number: $abc_number"
      ;;
  esac
}

abc_file() {
  local name
  name=$1
  case "$name" in
    ''|.|..|*/*)
      abc_error "invalid abc name: $name"
      return
      ;;
  esac
  if [ ! -f "$ABC_DIR/$name.abc" ]; then
    abc_error "abc file not found: $name.abc"
    return
  fi
  echo "$ABC_DIR/$name.abc"
}

abc_extract_tune() {
  local file target
  file=$1
  target=$2
  awk -v target="$target" '
    /^[[:space:]]*X:[[:space:]]*/ {
      current = $0
      sub(/^[^:]*:[[:space:]]*/, "", current)
      sub(/[[:space:]].*$/, "", current)
      selected = (current + 0 == target + 0)
    }
    selected {
      print
      found = 1
    }
    END {
      if (!found) {
        print "abc tune not found: X:" target > "/dev/stderr"
        exit 1
      }
    }
  ' "$file"
}

abc_titles() {
  local file
  file=$1
  awk '
    /^[[:space:]]*X:[[:space:]]*/ {
      number = $0
      sub(/^[^:]*:[[:space:]]*/, "", number)
      sub(/[[:space:]].*$/, "", number)
    }
    /^[[:space:]]*T:[[:space:]]*/ {
      title = $0
      sub(/^[^:]*:[[:space:]]*/, "", title)
      print number ":" title
      found = 1
    }
    END {
      if (!found) {
        print "abc title not found" > "/dev/stderr"
        exit 1
      }
    }
  ' "$file"
}
