import {
  appendLogEvents,
  exportImageEditorDiagnosticBundle,
  getAgentTraceCaptureMode,
  getAgentTraceStore,
  getLogCaptureMode,
  listLogDates,
  queryLogEvents,
  setLogCaptureMode,
  setAgentTraceCaptureMode,
  type LogCaptureMode,
  type LogEventBridgeDto,
  type LogQueryParams,
  type LogQueryResult,
} from '../services/logging'
import type {
  ImageEditorDiagnosticBundleRequest,
  ImageEditorDiagnosticBundleResult,
  ImageEditorDiagnosticHostV3,
} from '../../../src/core/logging/diagnosticBundle'
import {
  agentTraceCaptureModeSchema,
  agentTraceQuerySchema,
  type AgentTraceCaptureMode,
  type AgentTraceQuery,
  type AgentTraceQueryResult,
  type AgentTraceDetailResult,
} from '../../../src/core/assistant/trace'
import { openLogWindow } from '../windows/log-window'
import { parseRecord, parseVoid, registerIpcHandler } from './registry'

interface LogEventsPayload {
  events: LogEventBridgeDto[]
}

interface SetCaptureConfigPayload {
  mode: LogCaptureMode
}

interface SetAgentTraceCapturePayload {
  mode: 'summary' | 'detailed'
}

interface AgentTraceDetailPayload {
  traceId: string
}

interface ClearAgentTracePayload {
  date?: string
}

const LOG_LEVELS = new Set(['trace', 'debug', 'info', 'warn', 'error'])
const LOG_SOURCES = new Set(['frontend', 'backend'])
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const IMAGE_EDITOR_HOSTS = new Set<ImageEditorDiagnosticHostV3>([
  'full',
  'quick',
  'canvas-edit',
  'mask',
])

function parseFiniteNonNegative(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw new Error(`Expected ${field} to be a non-negative finite number`)
  }
  return value
}

function parseImageEditorDiagnosticBundleRequest(input: unknown): ImageEditorDiagnosticBundleRequest {
  const record = parseRecord(input)
  const host = record.host
  const documentId = record.documentId
  const sessionId = record.sessionId
  if (typeof host !== 'string' || !IMAGE_EDITOR_HOSTS.has(host as ImageEditorDiagnosticHostV3)) {
    throw new Error('Expected a valid image editor host')
  }
  if (typeof documentId !== 'string' || !documentId.trim() || documentId.length > 256) {
    throw new Error('Expected a valid image editor documentId')
  }
  if (sessionId !== undefined && (typeof sessionId !== 'string' || sessionId.length > 512)) {
    throw new Error('Expected a valid image editor sessionId')
  }
  const source = parseRecord(record.source)
  if (!Array.isArray(source.mediaTypes)
    || !source.mediaTypes.every((value) => (
      typeof value === 'string'
      && ['image/jpeg', 'image/png', 'image/webp'].includes(value)
    ))) {
    throw new Error('Expected safe image editor media types')
  }
  const layers = parseRecord(record.layers)
  const effectIds = layers.effectIds
  if (!Array.isArray(effectIds)
    || !effectIds.every((value) => (
      typeof value === 'string'
      && value.length <= 256
      && /^[a-zA-Z0-9._:-]+$/.test(value)
    ))) {
    throw new Error('Expected safe image editor effect ids')
  }
  return {
    host: host as ImageEditorDiagnosticHostV3,
    documentId,
    revision: parseFiniteNonNegative(record.revision, 'revision'),
    ...(sessionId ? { sessionId } : {}),
    source: {
      mediaTypes: [...new Set(source.mediaTypes)],
      width: parseFiniteNonNegative(source.width, 'source.width'),
      height: parseFiniteNonNegative(source.height, 'source.height'),
      byteLength: parseFiniteNonNegative(source.byteLength, 'source.byteLength'),
    },
    layers: {
      raster: parseFiniteNonNegative(layers.raster, 'layers.raster'),
      annotation: parseFiniteNonNegative(layers.annotation, 'layers.annotation'),
      effect: parseFiniteNonNegative(layers.effect, 'layers.effect'),
      adjustment: parseFiniteNonNegative(layers.adjustment, 'layers.adjustment'),
      group: parseFiniteNonNegative(layers.group, 'layers.group'),
      masked: parseFiniteNonNegative(layers.masked, 'layers.masked'),
      hidden: parseFiniteNonNegative(layers.hidden, 'layers.hidden'),
      locked: parseFiniteNonNegative(layers.locked, 'layers.locked'),
      annotationObjects: parseFiniteNonNegative(layers.annotationObjects, 'layers.annotationObjects'),
      effectIds,
    },
  }
}

function isLogEvent(value: unknown): value is LogEventBridgeDto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const record = value as Record<string, unknown>
  return (
    typeof record.timestamp === 'string' &&
    typeof record.level === 'string' &&
    LOG_LEVELS.has(record.level) &&
    typeof record.domain === 'string' &&
    typeof record.event === 'string' &&
    typeof record.message === 'string'
  )
}

function parseLogEventsPayload(input: unknown): LogEventsPayload {
  const record = parseRecord(input)
  const events = record.events
  if (!Array.isArray(events) || !events.every(isLogEvent)) {
    throw new Error('Expected log events array')
  }
  return { events }
}

function parseCaptureConfigPayload(input: unknown): SetCaptureConfigPayload {
  const record = parseRecord(input)
  const mode = record.mode
  if (mode !== 'standard' && mode !== 'full') {
    throw new Error('Expected capture mode to be "standard" or "full"')
  }
  return { mode }
}

function parseAgentTraceCapturePayload(input: unknown): SetAgentTraceCapturePayload {
  const record = parseRecord(input)
  return { mode: agentTraceCaptureModeSchema.parse(record.mode) }
}

function parseAgentTraceQueryPayload(input: unknown): AgentTraceQuery {
  return agentTraceQuerySchema.parse(parseRecord(input))
}

function parseAgentTraceDetailPayload(input: unknown): AgentTraceDetailPayload {
  const record = parseRecord(input)
  if (typeof record.traceId !== 'string' || !record.traceId.trim()) {
    throw new Error('Expected traceId to be a non-empty string')
  }
  return { traceId: record.traceId }
}

function parseClearAgentTracePayload(input: unknown): ClearAgentTracePayload {
  const record = parseRecord(input)
  if (record.date !== undefined && (typeof record.date !== 'string' || !DATE_PATTERN.test(record.date))) {
    throw new Error('Expected date in YYYY-MM-DD format')
  }
  return { date: record.date as string | undefined }
}

function parseLogQueryPayload(input: unknown): LogQueryParams {
  const record = parseRecord(input)

  const date = record.date
  if (typeof date !== 'string' || !DATE_PATTERN.test(date)) {
    throw new Error('Expected date in YYYY-MM-DD format')
  }

  const level = record.level
  if (level !== undefined && (typeof level !== 'string' || !LOG_LEVELS.has(level))) {
    throw new Error('Expected level to be a valid log level')
  }

  const source = record.source
  if (source !== undefined && (typeof source !== 'string' || !LOG_SOURCES.has(source))) {
    throw new Error('Expected source to be "frontend" or "backend"')
  }

  const domainPrefix = record.domainPrefix
  if (domainPrefix !== undefined && typeof domainPrefix !== 'string') {
    throw new Error('Expected domainPrefix to be a string')
  }

  const requestId = record.requestId
  if (requestId !== undefined && typeof requestId !== 'string') {
    throw new Error('Expected requestId to be a string')
  }

  const keyword = record.keyword
  if (keyword !== undefined && typeof keyword !== 'string') {
    throw new Error('Expected keyword to be a string')
  }

  const beforeTimestamp = record.beforeTimestamp
  if (beforeTimestamp !== undefined && typeof beforeTimestamp !== 'string') {
    throw new Error('Expected beforeTimestamp to be a string')
  }

  const afterTimestamp = record.afterTimestamp
  if (afterTimestamp !== undefined && typeof afterTimestamp !== 'string') {
    throw new Error('Expected afterTimestamp to be a string')
  }

  let beforeLine: number | undefined
  if (record.beforeLine !== undefined) {
    const value = record.beforeLine
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
      throw new Error('Expected beforeLine to be a non-negative integer')
    }
    beforeLine = value
  }

  const limit = record.limit
  if (limit !== undefined && (typeof limit !== 'number' || !Number.isFinite(limit))) {
    throw new Error('Expected limit to be a finite number')
  }

  return {
    date,
    level: level as LogQueryParams['level'],
    source: source as LogQueryParams['source'],
    domainPrefix,
    requestId,
    keyword,
    beforeTimestamp,
    afterTimestamp,
    beforeLine,
    limit,
  }
}

export function registerLoggingIpc(): void {
  registerIpcHandler<LogEventsPayload, void>('logging:frontendEvents', parseLogEventsPayload, ({ events }) =>
    appendLogEvents(events.map((event) => ({ ...event, source: 'frontend' as const })))
  )
  registerIpcHandler<SetCaptureConfigPayload, void>('logging:setCaptureConfig', parseCaptureConfigPayload, ({ mode }) =>
    setLogCaptureMode(mode)
  )
  registerIpcHandler<void, LogCaptureMode>('logging:getCaptureConfig', parseVoid, () => getLogCaptureMode())
  // 打开独立日志窗口：不做打包态/测试模式主进程侧门控，入口可见性与快捷键注册完全由渲染层决定
  // （与既有 F12 DevTools 切换 IPC 同款模式：主进程始终暴露能力，渲染层负责判断"是否该调用"）。
  registerIpcHandler<void, void>('logging:openWindow', parseVoid, () => openLogWindow())
  // 历史日志回读（2.3）：日期列表 + 按日期流式查询，过滤下沉在 query.ts 内完成。
  registerIpcHandler<void, string[]>('logging:listDates', parseVoid, () => listLogDates())
  registerIpcHandler<LogQueryParams, LogQueryResult>('logging:query', parseLogQueryPayload, (params) => queryLogEvents(params))
  registerIpcHandler<ImageEditorDiagnosticBundleRequest, ImageEditorDiagnosticBundleResult>(
    'logging:exportDiagnosticBundle',
    parseImageEditorDiagnosticBundleRequest,
    (request) => exportImageEditorDiagnosticBundle(request),
  )
  registerIpcHandler<void, AgentTraceCaptureMode>(
    'logging:agentTrace:getCaptureMode',
    parseVoid,
    () => getAgentTraceCaptureMode()
  )
  registerIpcHandler<SetAgentTraceCapturePayload, void>(
    'logging:agentTrace:setCaptureMode',
    parseAgentTraceCapturePayload,
    ({ mode }) => setAgentTraceCaptureMode(mode)
  )
  registerIpcHandler<AgentTraceQuery, AgentTraceQueryResult>(
    'logging:agentTrace:query',
    parseAgentTraceQueryPayload,
    (params) => getAgentTraceStore().query(params)
  )
  registerIpcHandler<AgentTraceDetailPayload, AgentTraceDetailResult | null>(
    'logging:agentTrace:getDetail',
    parseAgentTraceDetailPayload,
    ({ traceId }) => getAgentTraceStore().getDetail(traceId)
  )
  registerIpcHandler<ClearAgentTracePayload, void>(
    'logging:agentTrace:clear',
    parseClearAgentTracePayload,
    ({ date }) => getAgentTraceStore().clear(date)
  )
}
