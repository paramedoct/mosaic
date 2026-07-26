display_action_confirm() {
  local rows
  local pager
  local key
  rows=$1
  pager=$2
  printf '\033[%s;1H\033[2K\033[1;37;41m%s\033[0m' "$rows" "$pager"
  key=$(display_read_key)
  printf '\033[%s;1H\033[2K%s' "$rows" "$pager"
  case "$key" in
    '' | y | Y) return 0 ;;
    *) return 1 ;;
  esac
}

display_clear_history() {
  printf '\033[H\033[2J\033[3J'
}

display_cursor_hide() {
  printf '\033[?25l'
}

display_cursor_show() {
  printf '\033[?25h'
}

display_read_key() {
  local key
  local rest
  IFS= read -r -s -n 1 key </dev/tty
  if [ "$key" = $'\033' ]; then
    rest=
    if IFS= read -r -s -t 0.1 -n 1 rest </dev/tty && [ "$rest" = '[' ]; then
      key=$key$rest
      rest=
      if IFS= read -r -s -t 0.1 -n 1 rest </dev/tty; then
        key=$key$rest
      fi
    fi
  fi
  printf '%s' "$key"
}

display_size() {
  local rows
  local cols
  rows=24
  cols=80
  read -r rows cols \
    < <((stty size </dev/tty) 2>/dev/null || printf '24 80\n')
  if ((rows < 10)); then rows=10; fi
  if ((cols < 20)); then cols=20; fi
  printf '%s %s\n' "$rows" "$cols"
}

display_image_rows() {
  local path
  local rows
  local cols
  path=$1
  rows=$2
  cols=$3
  chafa --probe off --format symbols --colors none \
    --symbols ascii --animate off --scale max --align top,left \
    --size "${cols}x$((rows - 6))" --work 1 "$path" |
    awk 'END { print NR }'
}

display_image_start() {
  local path
  local rows
  local cols
  local mime
  local view_size
  local -a animation_args
  local -a quality_args
  path=$1
  rows=$2
  cols=$3
  mime=$4
  view_size="${cols}x$((rows - 6))"
  if [ "$mime" = image/gif ]; then
    animation_args=(--animate on --duration infinite)
  else
    animation_args=(--animate off)
  fi
  quality_args=()
  if [ "$SCRY_DISPLAY_FORMAT" = sixels ]; then
    quality_args=(
      --dither diffusion
      --dither-intensity 1.0
    )
  fi
  (
    local image_pid
    trap '
      kill "$image_pid" 2>/dev/null || true
      wait "$image_pid" 2>/dev/null || true
      display_cursor_hide
      exit 143
    ' TERM
    printf '\033[H'
    chafa --probe off --format "$SCRY_DISPLAY_FORMAT" \
      "${animation_args[@]}" "${quality_args[@]}" \
      --scale max --align top,left \
      --size "$view_size" "$path" &
    image_pid=$!
    wait "$image_pid"
    display_cursor_hide
  ) &
  DISPLAY_IMAGE_PID=$!
}

display_image_stop() {
  local status
  if [ -z "$DISPLAY_IMAGE_PID" ]; then return 0; fi
  status=0
  if kill -0 "$DISPLAY_IMAGE_PID" 2>/dev/null; then
    kill "$DISPLAY_IMAGE_PID" 2>/dev/null || true
  fi
  wait "$DISPLAY_IMAGE_PID" 2>/dev/null || status=$?
  DISPLAY_IMAGE_PID=
  [ "$status" -eq 0 ] || [ "$status" -eq 143 ]
}

display_browser() {
  local total
  local selected
  local image_rows
  local rows
  local cols
  local target
  local id
  local record
  local sha
  local source
  local subject
  local mime
  local key
  local path
  local pager
  local delta
  local position
  total=$#
  if ((total == 0)); then
    echo "no images found"
    return 0
  fi
  selected=${DISPLAY_SELECTED:-0}
  if ((selected >= total)); then selected=$((total - 1)); fi
  if ((selected < 0)); then selected=0; fi
  while :; do
    position=$((selected + 1))
    target=${!position}
    record=$(image_require "$target")
    IFS=$'\t' read -r id sha source mime subject _ <<<"$record"
    path=$(image_path "$source" "$sha")
    if [ ! -r "$path" ]; then
      echo "stored image not found: $path" >&2
      return 1
    fi
    read -r rows cols < <(display_size)
    image_rows=$(display_image_rows "$path" "$rows" "$cols")
    display_clear_history
    printf '\033[%s;1H' "$((image_rows + 1))"
    printf '%-7s %s\n%-7s %s\n' subject "$subject" source "$source"
    pager=$(printf '[%s/%s]' "$((selected + 1))" "$total")
    printf '\033[%s;1H\033[2K' "$rows"
    printf '%s' "$pager"
    printf '\033[H'
    display_image_start "$path" "$rows" "$cols" "$mime"
    while :; do
      key=$(display_read_key)
      delta=0
      case "$key" in
        $'\033[A' | $'\033[D') delta=-1 ;;
        $'\033[B' | $'\033[C') delta=1 ;;
        x | X)
          if display_action_confirm "$rows" "$pager"; then break; fi
          continue
          ;;
        q | Q | $'\033') break ;;
        *) continue ;;
      esac
      if ((delta != 0)); then
        break
      fi
    done
    if ! display_image_stop; then
      printf '\033[%s;1H\n' "$rows"
      return 1
    fi
    printf '\033[%s;1H\033[2K' "$rows"
    selected=$(((selected + delta + total) % total))
    case "$key" in
      x | X)
        if image_remove "$id"; then
          DISPLAY_SELECTED=$selected
          return 10
        fi
        ;;
      q | Q | $'\033')
        display_clear_history
        return 0
        ;;
    esac
  done
}
