#!/usr/bin/env bash
# 重命令排队：全机同时最多 2 个（tsc、vitest、cargo 等）。用法：bash tickets/45-全局性能/heavy.sh <命令...>
LOCK_ROOT="${TMPDIR:-/tmp}/henji-heavy-locks"; mkdir -p "$LOCK_ROOT"
slot=""
while [ -z "$slot" ]; do
  for i in 1 2; do
    d="$LOCK_ROOT/slot-$i"
    if mkdir "$d" 2>/dev/null; then echo $$ > "$d/pid"; slot="$d"; break; fi
    pid=$(cat "$d/pid" 2>/dev/null)
    if [ -n "$pid" ] && ! kill -0 "$pid" 2>/dev/null; then rm -rf "$d"; fi
  done
  [ -z "$slot" ] && sleep 5
done
trap 'rm -rf "$slot"' EXIT
"$@"
