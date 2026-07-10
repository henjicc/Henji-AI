import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'
import { getLogDir } from './writer'
import { MAIN_LOG_FILE_PREFIX, type MainLogEvent, type MainLogLevel, type MainLogSource } from './types'

/**
 * 历史日志文件查询服务（2.3 历史日志回读）。
 *
 * 与 `retention.ts`（清理）、`writer.ts`（写入）职责相邻但不同：本文件只读，服务于
 * 渲染层"历史模式"查看某一天的日志。流式逐行读取 JSONL，绝不整文件读入内存——
 * 内存占用只与 `limit` 成正比，与文件大小无关；解析失败的行跳过并计数，不中断查询。
 */

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const LOG_FILE_DATE_PATTERN = new RegExp(`^${MAIN_LOG_FILE_PREFIX}(\\d{4}-\\d{2}-\\d{2})\\.log$`)

const DEFAULT_QUERY_LIMIT = 200
/** 单次查询最多返回的事件数，防止异常调用（比如误传超大 limit）拖垮渲染层。 */
const MAX_QUERY_LIMIT = 2000

export interface LogQueryParams {
  /** 目标日期，格式 YYYY-MM-DD，对应 `henji-YYYY-MM-DD.log` 文件。 */
  date: string
  level?: MainLogLevel
  source?: MainLogSource
  /** domain 前缀匹配（`event.domain.startsWith(domainPrefix)`）；传入完整 domain 字符串等价于精确匹配。 */
  domainPrefix?: string
  requestId?: string
  /** 大小写不敏感关键词，命中 domain/event/message/requestId/taskId/modelId/providerId/context/error 任一字段。 */
  keyword?: string
  /** 分页游标：只返回时间戳严格早于该值的事件，用于"加载更早"翻页。省略则从最新事件开始。 */
  beforeTimestamp?: string
  /**
   * 同一日志文件内的行号游标（从 0 开始，不含该行及其后的内容）。
   * UI 分页优先使用它，避免多条事件拥有相同毫秒级 timestamp 时用时间戳游标漏项。
   */
  beforeLine?: number
  /** 单页最大返回条数，默认 200，上限 2000。 */
  limit?: number
}

export interface LogQueryResult {
  /** 命中事件，按时间戳降序排列（最新在前），与实时模式列表展示顺序一致。 */
  events: MainLogEvent[]
  /** 是否还有更早的匹配事件（用于"加载更早"按钮的可用性判断）。 */
  hasMore: boolean
  /** 本次查询中因 JSON 解析失败而跳过的行数。 */
  corruptedLines: number
  /** 下一页的行号游标；与 `beforeLine` 配套使用。 */
  nextBeforeLine?: number
}

/**
 * 列出当前存在的日志文件对应的日期（`henji-YYYY-MM-DD.log` → `YYYY-MM-DD`），按日期降序排列。
 * 只识别新命名规则文件，旧 `frontend-*.log` 不纳入（与 `retention.ts` 的扫描范围保持一致）。
 */
export async function listLogDates(): Promise<string[]> {
  const logDir = getLogDir()
  let entries: string[]
  try {
    entries = await fsPromises.readdir(logDir)
  } catch {
    return []
  }

  const dates = new Set<string>()
  for (const entry of entries) {
    const match = LOG_FILE_DATE_PATTERN.exec(entry)
    if (match) {
      dates.add(match[1])
    }
  }

  return Array.from(dates).sort((a, b) => b.localeCompare(a))
}

function getQueryFilePath(date: string): string {
  if (!DATE_PATTERN.test(date)) {
    throw new Error(`Invalid log date: ${date}`)
  }
  return path.join(getLogDir(), `${MAIN_LOG_FILE_PREFIX}${date}.log`)
}

function stringifyForKeyword(value: unknown): string {
  if (value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function isMainLogEvent(value: unknown): value is MainLogEvent {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.timestamp === 'string' &&
    typeof record.domain === 'string' &&
    typeof record.event === 'string' &&
    typeof record.message === 'string' &&
    typeof record.level === 'string' &&
    ['trace', 'debug', 'info', 'warn', 'error'].includes(record.level) &&
    typeof record.source === 'string' &&
    ['frontend', 'backend'].includes(record.source)
  )
}

function matchesKeyword(event: MainLogEvent, keyword: string): boolean {
  const target = keyword.toLowerCase()
  const fields = [
    event.domain,
    event.event,
    event.message,
    event.requestId ?? '',
    event.taskId ?? '',
    event.modelId ?? '',
    event.providerId ?? '',
    stringifyForKeyword(event.context),
    stringifyForKeyword(event.error),
  ]
  return fields.some((field) => field.toLowerCase().includes(target))
}

function matchesFilters(event: MainLogEvent, params: LogQueryParams): boolean {
  if (params.level && event.level !== params.level) {
    return false
  }
  if (params.source && event.source !== params.source) {
    return false
  }
  if (params.domainPrefix && !event.domain.startsWith(params.domainPrefix)) {
    return false
  }
  if (params.requestId && event.requestId !== params.requestId) {
    return false
  }
  if (params.beforeTimestamp && !(event.timestamp < params.beforeTimestamp)) {
    return false
  }
  if (params.keyword && !matchesKeyword(event, params.keyword)) {
    return false
  }
  return true
}

/**
 * 按日期流式查询日志事件，过滤全部在本函数内完成（下沉到主进程，不整文件传给渲染层）。
 *
 * 分页语义选择"游标 + 最后 N 条"而非数值 offset：`readline` 单次遍历中维护一个大小为
 * `limit` 的滚动缓冲区（命中就 push，超出 limit 就 shift 最旧的一条），遍历结束时缓冲区
 * 就是"游标之前最近 limit 条匹配事件"，只反转一次即可得到降序结果——内存占用恒为
 * `O(limit)`，与文件行数无关；UI 翻页优先使用 `beforeLine` 行号游标，避免同一毫秒多条
 * 日志共用 timestamp 时因时间戳游标漏项。`beforeTimestamp` 保留给需要按时间边界筛选的调用方。
 *
 * 文件不存在（当天没有日志）时返回空结果而非报错。
 */
export async function queryLogEvents(params: LogQueryParams): Promise<LogQueryResult> {
  const requestedLimit = Number.isFinite(params.limit) ? Math.trunc(params.limit as number) : DEFAULT_QUERY_LIMIT
  const limit = Math.min(Math.max(requestedLimit, 1), MAX_QUERY_LIMIT)
  const filePath = getQueryFilePath(params.date)

  let stream: fs.ReadStream
  try {
    await fsPromises.access(filePath)
    stream = fs.createReadStream(filePath, { encoding: 'utf8' })
  } catch {
    return { events: [], hasMore: false, corruptedLines: 0 }
  }

  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity })

  const buffer: Array<{ event: MainLogEvent; lineNumber: number }> = []
  let totalMatched = 0
  let corruptedLines = 0

  try {
    let lineNumber = 0
    for await (const line of rl) {
      if (params.beforeLine !== undefined && lineNumber >= params.beforeLine) {
        break
      }
      const trimmed = line.trim()
      const currentLineNumber = lineNumber
      lineNumber += 1
      if (!trimmed) {
        continue
      }

      let value: unknown
      try {
        value = JSON.parse(trimmed) as unknown
      } catch {
        corruptedLines += 1
        continue
      }
      if (!isMainLogEvent(value)) {
        corruptedLines += 1
        continue
      }
      const event = value

      if (!matchesFilters(event, params)) {
        continue
      }

      totalMatched += 1
      buffer.push({ event, lineNumber: currentLineNumber })
      if (buffer.length > limit) {
        buffer.shift()
      }
    }
  } finally {
    rl.close()
    stream.close()
  }

  return {
    events: buffer.map(({ event }) => event).reverse(),
    hasMore: totalMatched > limit,
    corruptedLines,
    nextBeforeLine: buffer[0]?.lineNumber,
  }
}
