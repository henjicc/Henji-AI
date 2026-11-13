#!/bin/sh
# 记录回放（只读，不碰用户资料与 git）：真实日志里的工具调用参数按当前工具定义校验，能解析的结果按当前投影重算体积；
# 再按真实请求序列估算缓存与费用（乐观、保守两种口径）。先跑一次同目录 run.sh 生成当前的 payloads.json。
# 用法：sh replay.sh <改前 payloads.json> <日志文件...>
#   例：sh replay.sh before-payloads.json "E:/文档/HenjiAI/.system/logs/henji-2026-11-12.log" "E:/文档/HenjiAI/.system/logs/henji-2026-11-13.log"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
OUT="$ROOT/.tmp/payload-audit"
BEFORE="$1"; shift
LOGS="$(printf '%s,' "$@")"
mkdir -p "$OUT"
cd "$ROOT" || exit 1
PAYLOAD_AUDIT_OUT="$OUT" PAYLOAD_AUDIT_LOGS="$LOGS" npx vitest run "$HERE/replay.test.ts" --config "$HERE/vitest.audit.config.mjs" || exit 1
PYTHONIOENCODING=utf-8 python "$HERE/replay_summary.py" "$OUT/replay.json" || exit 1
PYTHONIOENCODING=utf-8 python "$HERE/simulate.py" "$BEFORE" "$OUT/payloads.json" "$@"
