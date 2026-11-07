location_validate_name() {
  local type
  local name
  type=$1
  name=$2
  case "$name" in
    '' | '.' | '..' | *:* | */*)
      echo "invalid $type: $name" >&2
      return 1
      ;;
  esac
}

location_parse() {
  local location
  local mode
  local subject
  local source
  location=$1
  mode=$2
  subject=${location%%:*}
  source=
  case "$location" in
    *:*:*)
      echo "invalid location: $location" >&2
      return 1
      ;;
    *:*)
      source=${location#*:}
      location_validate_name source "$source" || return 1
      ;;
    *)
      if [ "$mode" = add ]; then
        echo "source is required: $location" >&2
        return 1
      fi
      ;;
  esac
  if [ "$mode" = add ] || [ "$subject" = "$location" ] ||
    [ -n "$subject" ]; then
    location_validate_name subject "$subject" || return 1
  fi
  printf '%s:%s\n' "$subject" "$source"
}

location_search() {
  local fields
  local subject
  local source
  local where
  if [ "$#" -eq 0 ]; then
    subject=
    source=
  else
    fields=$(location_parse "$1" search) || return 1
    IFS=: read -r subject source <<<"$fields"
  fi
  where='1 = 1'
  if [ -n "$subject" ]; then
    where="$where AND images.subject = $(database_quote "$subject")"
  fi
  if [ -n "$source" ]; then
    where="$where AND images.source = $(database_quote "$source")"
  fi
  database_value "
SELECT images.id
FROM images
WHERE $where
ORDER BY images.id;
"
}
