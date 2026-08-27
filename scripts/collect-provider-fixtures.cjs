#!/usr/bin/env node
'use strict'

/**
 * 从本机开发日志采集供应商请求/响应快照，脱敏后写成 fixture 草稿。
 *
 * 背景（任务 6.1）：`electron/main/services/ai-runtime/trace.ts` 在每次生成/轮询时会记录
 * `generation.runtime.request_json` 与 `generation.runtime.response_json` 两个事件（同一
 * `requestId`），日志文件是 `scripts/query-logs.cjs` 读的同一份 JSONL。本脚本按 `requestId`
 * 把这两个事件配对，套用与 `electron/main/services/logging/sanitize.ts` 的 `isSensitiveKey`
 * 一致的脱敏规则（脚本运行在 Node 环境、不经过 TS 构建，规则在本文件内重新实现一份，
 * 修改任一处都要同步另一处），输出到 `packages/ai-sdk/tests/fixtures/_drafts/<provider>/`。
 *
 * 输出是“草稿”，不是可直接使用的 fixture：脚本只负责配对 + 脱敏 + 套壳，`scenario`（属于
 * create/poll-success/poll-failure 里的哪一种）、`expectedRequest`、`expected` 这些需要人工
 * 判断的字段留空或给出最佳猜测，人工核对后再移进正式 fixture 目录、补齐字段、删掉 `_drafts`。
 *
 * 用法：
 *   node scripts/collect-provider-fixtures.cjs [--date YYYY-MM-DD] [--provider kie] [--dir 日志目录] [--out 输出目录]
 *
 * 当前已知情况（2026-08-27 采集时确认，详见 fixtures/README.md）：本机日志里只有 grsai 一个
 * 供应商的真实生成记录（2 组 request/response 配对），其余 7 个供应商本机从未真实调用过，
 * 脚本对它们运行时只会得到 0 条草稿——这不是脚本的 bug，是历史上这台机器没有真实调用过。
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const readline = require('node:readline')

const APP_IDENTIFIER = 'com.henji.ai'
const LOG_FILE_PREFIX = 'henji-'
const REQUEST_EVENT = 'generation.runtime.request_json'
const RESPONSE_EVENT = 'generation.runtime.response_json'

function getDefaultLogDir() {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, APP_IDENTIFIER, 'Henji-AI', 'logs')
  }
  const appDataDir = process.platform === 'darwin'
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config')
  return path.join(appDataDir, APP_IDENTIFIER, 'Henji-AI', 'logs')
}

function parseArgs(argv) {
  const options = { dir: getDefaultLogDir(), out: null, date: null, provider: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--date') options.date = argv[++i]
    else if (arg === '--provider') options.provider = argv[++i]
    else if (arg === '--dir') options.dir = argv[++i]
    else if (arg === '--out') options.out = argv[++i]
    else if (arg === '--help' || arg === '-h') options.help = true
  }
  return options
}

function printHelp() {
  console.log(`用法：node scripts/collect-provider-fixtures.cjs [选项]

从本机 Henji-AI 开发日志采集 generation.runtime.request_json / response_json 事件配对，
脱敏后写成 fixture 草稿，供人工核对后整理进 packages/ai-sdk/tests/fixtures/<provider>/。

选项：
  --date YYYY-MM-DD   只扫描这一天的日志文件（默认扫描日志目录下全部 henji-*.log）
  --provider ID       只采集指定 providerId（如 kie / grsai），默认采集全部
  --dir PATH          覆盖默认日志目录
  --out PATH          草稿输出目录（默认 packages/ai-sdk/tests/fixtures/_drafts）
  --help, -h          显示本帮助

示例：
  node scripts/collect-provider-fixtures.cjs --provider grsai
  node scripts/collect-provider-fixtures.cjs --date 2026-08-26 --out /tmp/fixture-drafts`)
}

/**
 * 与 electron/main/services/logging/sanitize.ts 的 isSensitiveKey 保持一致的判定规则。
 * 这两处是刻意的重复（脚本不经过 TS 构建，无法直接 import 源码），改任一处都要同步另一处。
 */
function isSensitiveKey(key) {
  const lower = key.toLowerCase()
  return lower.includes('api_key')
    || lower.includes('apikey')
    || lower.includes('authorization')
    || lower.includes('token')
    || lower.includes('secret')
    || lower.includes('password')
}

/** 字段名精确等于这些名字时，不论长度一律替换：这些字段按定义就是用户输入的创作内容。 */
const ALWAYS_REDACT_FIELD_NAMES = new Set(['prompt', 'negative_prompt', 'negativeprompt'])

/** 递归脱敏：敏感字段整体替换为 '***'；字符串值统一替换为占位符（prompt/URL 都不可信任保留原文）。 */
function sanitizeValue(value, keyName) {
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item))
  if (value && typeof value === 'object') {
    const next = {}
    for (const [key, item] of Object.entries(value)) {
      next[key] = isSensitiveKey(key) ? '***' : sanitizeValue(item, key)
    }
    return next
  }
  if (typeof value === 'string') {
    if (keyName && ALWAYS_REDACT_FIELD_NAMES.has(keyName.toLowerCase())) return '[REDACTED_PROMPT]'
    return sanitizeString(value)
  }
  return value
}

function sanitizeString(value) {
  // 结果 URL / 上传 URL：域名与路径结构保留（便于回归比对解析逻辑），查询串一律替换为占位符，
  // 避免带出可直接使用的签名参数。
  if (/^https?:\/\//.test(value) && value.includes('?')) {
    return `${value.split('?')[0]}?REDACTED_SIGNATURE`
  }
  // 长文本（多数是用户 prompt）一律替换，不保留原文内容。
  if (value.length > 40) {
    return '[REDACTED_LONG_TEXT]'
  }
  return value
}

function listLogFiles(dir, date) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((name) => name.startsWith(LOG_FILE_PREFIX) && name.endsWith('.log'))
    .filter((name) => !date || name === `${LOG_FILE_PREFIX}${date}.log`)
    .map((name) => path.join(dir, name))
}

async function collectPairs(logFiles, providerFilter) {
  // requestId -> { request, response }
  const pairs = new Map()
  for (const filePath of logFiles) {
    const rl = readline.createInterface({ input: fs.createReadStream(filePath), crlfDelay: Infinity })
    for await (const line of rl) {
      if (!line.trim()) continue
      let event
      try {
        event = JSON.parse(line)
      } catch {
        continue
      }
      if (event.event !== REQUEST_EVENT && event.event !== RESPONSE_EVENT) continue
      if (providerFilter && event.providerId !== providerFilter) continue
      const requestId = event.requestId
      if (!requestId) continue
      const entry = pairs.get(requestId) ?? {}
      if (event.event === REQUEST_EVENT) entry.request = event
      else entry.response = event
      pairs.set(requestId, entry)
    }
  }
  return pairs
}

function toDraftFixture(requestId, entry) {
  const request = entry.request
  const response = entry.response
  const providerId = request?.providerId ?? response?.providerId ?? 'unknown'
  const modelId = request?.modelId ?? response?.modelId ?? 'unknown'
  return {
    provider: providerId,
    modelId,
    scenario: 'TODO：人工判断属于 create-task-success / poll-success / poll-failure / boundary-* 中的哪一种',
    phase: request?.context?.route?.toLowerCase().includes('poll') || requestId?.startsWith('continue-')
      ? 'continuePolling'
      : 'execute',
    method: request?.context?.method ?? 'POST',
    route: request?.context?.route ?? 'TODO',
    params: sanitizeValue(request?.context?.requestBody ?? null),
    response: sanitizeValue(response?.context?.responseBody ?? null),
    expected: {
      outcome: 'TODO：resolve 或 reject',
    },
    source: {
      params: `真实开发日志（本机），requestId=${requestId}${request?.timestamp ? `，${request.timestamp}` : ''}`,
      response: `真实开发日志（本机），requestId=${requestId}${response?.timestamp ? `，${response.timestamp}` : ''}`,
    },
    _draft: true,
    _originalRequestId: requestId,
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  const outDir = options.out
    ?? path.resolve(__dirname, '..', 'packages', 'ai-sdk', 'tests', 'fixtures', '_drafts')

  const logFiles = listLogFiles(options.dir, options.date)
  if (logFiles.length === 0) {
    console.log(`[collect-provider-fixtures] 日志目录 ${options.dir} 下没有找到日志文件，未采集到任何草稿。`)
    return
  }

  const pairs = await collectPairs(logFiles, options.provider)
  let written = 0
  for (const [requestId, entry] of pairs) {
    if (!entry.request && !entry.response) continue
    const draft = toDraftFixture(requestId, entry)
    const providerDir = path.join(outDir, draft.provider)
    fs.mkdirSync(providerDir, { recursive: true })
    const safeName = requestId.replace(/[^a-zA-Z0-9_-]/g, '_')
    const filePath = path.join(providerDir, `${safeName}.draft.json`)
    fs.writeFileSync(filePath, `${JSON.stringify(draft, null, 2)}\n`, 'utf-8')
    written += 1
  }

  console.log(`[collect-provider-fixtures] 扫描 ${logFiles.length} 个日志文件，配对到 ${pairs.size} 条 requestId，写出 ${written} 份草稿到 ${outDir}`)
  if (written === 0) {
    console.log('[collect-provider-fixtures] 没有采集到任何真实记录：本机可能从未针对目标供应商发起过真实生成请求。')
  } else {
    console.log('[collect-provider-fixtures] 草稿仅完成配对+脱敏，scenario/expected 等字段需要人工核对后再移入正式 fixture 目录。')
  }
}

main().catch((error) => {
  console.error('[collect-provider-fixtures] 采集失败：', error)
  process.exitCode = 1
})
