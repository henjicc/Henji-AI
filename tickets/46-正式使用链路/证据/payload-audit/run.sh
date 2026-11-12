#!/bin/sh
# 助手信息冗余总账（只读，不碰用户资料与 git，约 45 秒）：sh tickets/46-正式使用链路/证据/payload-audit/run.sh
# 需要 Python 与 tiktoken（pip install tiktoken）；输出 .tmp/payload-audit/report.txt
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
OUT="$ROOT/.tmp/payload-audit"
mkdir -p "$OUT"
cd "$ROOT" && PAYLOAD_AUDIT_OUT="$OUT" npx vitest run "$HERE/audit.test.ts" --config "$HERE/vitest.audit.config.mjs" \
  && PYTHONIOENCODING=utf-8 python "$HERE/tokens.py" "$OUT/payloads.json" > "$OUT/report.txt" && cat "$OUT/report.txt"
