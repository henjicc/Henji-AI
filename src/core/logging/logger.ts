import { enqueueFrontendLogForBridge, flushFrontendLogBridge } from './bridge'
import { isDomainEnabled, refreshLogConfigByRuntime, shouldLogLevel } from './config'
import { sanitizeLogPayload } from './sanitize'
import { appendLogEvent } from './store'
import type { LogCallMeta, LogEvent, LogEventBridgeDto, LogLevel } from './types'
import { listenLlmRuntimeRequestPreview, listenRuntimeRequestPreview } from '@/commands/logging'
import { isDesktopRuntime } from '@/platform/runtime'

export interface Logger {
  trace: (...args: DynamicValue[]) => void
  debug: (...args: DynamicValue[]) => void
  info: (...args: DynamicValue[]) => void
  warn: (...args: DynamicValue[]) => void
  error: (...args: DynamicValue[]) => void
  table: (...args: DynamicValue[]) => void
  group: (...args: DynamicValue[]) => void
  groupCollapsed: (...args: DynamicValue[]) => void
  groupEnd: (...args: DynamicValue[]) => void
  child: (subDomain: string, context?: DynamicValueMap) => Logger
  withContext: (context: DynamicValueMap) => Logger
}

interface LoggerContext {
  domain: string
  context: DynamicValueMap
}

const META_KEYS = new Set(['event', 'requestId', 'taskId', 'modelId', 'providerId', 'context', 'error'])
const CONSOLE_EVENT_LABELS: Record<string, string> = {
  'generation.generate.start': '🚀 开始生成',
  'generation.generate.pending': '⏳ 进入轮询',
  'generation.generate.completed': '✅ 生成完成',
  'generation.generate.failed': '❌ 生成失败',
  'generation.continue_polling.start': '🔄 开始继续轮询',
  'generation.continue_polling.completed': '✅ 轮询完成',
  'generation.continue_polling.failed': '❌ 轮询失败',
  'generation.cancel.start': '🛑 请求取消任务',
  'generation.cancel.completed': '🧹 任务取消完成',
  'generation.cancel.failed': '❌ 任务取消失败',
  'generation.runtime.request_json': '🧾 最终请求参数(JSON)',
  'generation.runtime.response_json': '📥 API原始响应(JSON)',
  'generation.runtime.trace': '🧾 运行时追踪',
  'ai_runtime.generate.start': '🛰️ 后端开始生成',
  'ai_runtime.generate.result': '🛰️ 后端生成结果',
  'ai_runtime.continue_polling.start': '🛰️ 后端开始轮询',
  'ai_runtime.continue_polling.result': '🛰️ 后端轮询结果',
  'ai_runtime.cancel.requested': '🛰️ 后端收到取消请求',
  'ai_runtime.cancel.completed': '🛰️ 后端取消完成',
}

let loggerConfigInitialized = false
let runtimePreviewUnlisten: (() => void) | null = null
let llmRuntimePreviewUnlisten: (() => void) | null = null

function isRecord(value: DynamicValue): value is DynamicValueMap {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeContextValue(base: DynamicValue, extra: DynamicValueMap): DynamicValue {
  if (base === undefined) {
    return extra
  }

  if (isRecord(base)) {
    return {
      ...extra,
      ...base,
    }
  }

  return {
    detail: base,
    extra,
  }
}

function pickMetaFromRecord(value: DynamicValueMap): {
  hasMeta: boolean
  meta: LogCallMeta
  extraContext?: DynamicValueMap
} {
  const meta: LogCallMeta = {}
  const extraContext: DynamicValueMap = {}
  let hasMeta = false

  Object.entries(value).forEach(([key, nested]) => {
    if (!META_KEYS.has(key)) {
      extraContext[key] = nested
      return
    }

    hasMeta = true
    if (key === 'event' && typeof nested === 'string') {
      meta.event = nested
      return
    }
    if (key === 'requestId' && typeof nested === 'string') {
      meta.requestId = nested
      return
    }
    if (key === 'taskId' && typeof nested === 'string') {
      meta.taskId = nested
      return
    }
    if (key === 'modelId' && typeof nested === 'string') {
      meta.modelId = nested
      return
    }
    if (key === 'providerId' && typeof nested === 'string') {
      meta.providerId = nested
      return
    }
    if (key === 'context') {
      meta.context = nested
      return
    }
    if (key === 'error') {
      meta.error = nested
    }
  })

  return {
    hasMeta,
    meta,
    extraContext: Object.keys(extraContext).length > 0 ? extraContext : undefined,
  }
}

function assignMetaFromRecord(target: LogCallMeta, value: DynamicValueMap): boolean {
  const extracted = pickMetaFromRecord(value)
  if (!extracted.hasMeta) {
    return false
  }

  Object.assign(target, extracted.meta)
  if (extracted.extraContext) {
    target.context = mergeContextValue(target.context, extracted.extraContext)
  }

  return true
}

function inferMessage(args: DynamicValue[]): string {
  const [first] = args
  if (typeof first === 'string') {
    return first
  }
  if (first === undefined) {
    return ''
  }
  return typeof first === 'number' || typeof first === 'boolean'
    ? String(first)
    : 'log'
}

function inferEvent(message: string, level: LogLevel): string {
  const trimmed = message.trim().toLowerCase()
  if (!trimmed) {
    return `${level}.event`
  }

  const compact = trimmed
    .replace(/\[[^\]]+\]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (!compact) {
    return `${level}.event`
  }

  return compact.slice(0, 64)
}

function normalizeMetaFromArgs(level: LogLevel, args: DynamicValue[]): { message: string; meta: LogCallMeta } {
  const message = inferMessage(args)
  const rest = typeof args[0] === 'string' ? args.slice(1) : args

  if (level === 'error') {
    const [error, contextOrMeta, maybeMeta, ...remaining] = rest

    const baseMeta: LogCallMeta = {}
    if (error !== undefined) {
      baseMeta.error = error
    }

    if (isRecord(contextOrMeta)) {
      const usedAsMeta = assignMetaFromRecord(baseMeta, contextOrMeta)
      if (!usedAsMeta) {
        baseMeta.context = contextOrMeta
      }
    } else if (contextOrMeta !== undefined) {
      baseMeta.context = contextOrMeta
    }

    if (isRecord(maybeMeta)) {
      const usedAsMeta = assignMetaFromRecord(baseMeta, maybeMeta)
      if (!usedAsMeta) {
        baseMeta.context = mergeContextValue(baseMeta.context, maybeMeta)
      }
    }

    if (remaining.length > 0) {
      baseMeta.context = [baseMeta.context, ...remaining].filter((item) => item !== undefined)
    }

    return { message, meta: baseMeta }
  }

  const [contextOrMeta, maybeMeta, ...remaining] = rest
  const meta: LogCallMeta = {}

  if (isRecord(contextOrMeta)) {
    const usedAsMeta = assignMetaFromRecord(meta, contextOrMeta)
    if (!usedAsMeta) {
      meta.context = contextOrMeta
    }
  } else if (contextOrMeta !== undefined) {
    meta.context = contextOrMeta
  }

  if (isRecord(maybeMeta)) {
    const usedAsMeta = assignMetaFromRecord(meta, maybeMeta)
    if (!usedAsMeta) {
      meta.context = mergeContextValue(meta.context, maybeMeta)
    }
  } else if (maybeMeta !== undefined) {
    const existing = meta.context === undefined ? [] : [meta.context]
    meta.context = [...existing, maybeMeta]
  }

  if (remaining.length > 0) {
    const existing = meta.context === undefined
      ? []
      : Array.isArray(meta.context) ? meta.context : [meta.context]
    meta.context = [...existing, ...remaining]
  }

  return { message, meta }
}

function toBridgePayload(event: LogEvent): LogEventBridgeDto {
  return {
    timestamp: event.timestamp,
    level: event.level,
    domain: event.domain,
    event: event.event,
    message: event.message,
    requestId: event.requestId,
    taskId: event.taskId,
    modelId: event.modelId,
    providerId: event.providerId,
    context: event.context,
    error: event.error,
  }
}

function normalizeSyntheticLogArgs(kind: 'table' | 'group' | 'group_collapsed' | 'group_end', args: DynamicValue[]): DynamicValue[] {
  if (kind === 'group_end') {
    return ['group_end', { event: 'log.group_end' }]
  }

  if (args.length === 0) {
    return [kind, { event: `log.${kind}` }]
  }

  const [first, ...rest] = args
  if (typeof first === 'string') {
    if (rest.length === 0) {
      return [first, { event: `log.${kind}` }]
    }

    return [
      first,
      {
        event: `log.${kind}`,
        context: rest.length === 1 ? rest[0] : rest,
      },
    ]
  }

  return [
    kind,
    {
      event: `log.${kind}`,
      context: args.length === 1 ? args[0] : args,
    },
  ]
}

function compactId(value: string | undefined): string {
  if (!value) {
    return ''
  }

  return value.length > 14 ? `${value.slice(0, 8)}...${value.slice(-4)}` : value
}

function getLevelLabel(level: LogLevel): string {
  if (level === 'error') return '❌ 错误'
  if (level === 'warn') return '⚠️ 警告'
  if (level === 'debug') return '🛠️ 调试'
  if (level === 'trace') return '🔍 追踪'
  return 'ℹ️ 信息'
}

function simplifyMessage(message: string): string {
  const cleaned = message.replace(/\[[^\]]+\]\s*/g, '').trim()
  if (!cleaned) {
    return ''
  }
  return cleaned.length > 28 ? `${cleaned.slice(0, 28)}...` : cleaned
}

function getConsoleTitle(eventName: string, level: LogLevel, message: string): string {
  const mapped = CONSOLE_EVENT_LABELS[eventName]
  if (mapped) {
    return mapped
  }

  const conciseMessage = simplifyMessage(message)
  if (conciseMessage) {
    return `📝 ${conciseMessage}`
  }

  return getLevelLabel(level)
}

function isEmptyRecord(value: DynamicValue): boolean {
  return isRecord(value) && Object.keys(value).length === 0
}

function toPrettyJson(value: DynamicValue): string {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function compactRuntimeString(value: string): string {
  if (value.startsWith('data:')) {
    const [header = 'data:', payload = ''] = value.split(',', 2)
    if (payload.length <= 96) {
      return value
    }
    return `${header},${payload.slice(0, 64)}...(len=${payload.length})...${payload.slice(-24)}`
  }

  const normalized = value.replace(/\s+/g, '')
  const looksLikeBase64 = normalized.length > 256 && /^[A-Za-z0-9+/=_-]+$/.test(normalized)
  if (looksLikeBase64) {
    return `${value.slice(0, 64)}...(len=${value.length})...${value.slice(-24)}`
  }

  if (value.length > 280) {
    return `${value.slice(0, 120)}...(len=${value.length})...${value.slice(-36)}`
  }

  return value
}

function compactRuntimePayload(value: DynamicValue, depth = 0): DynamicValue {
  if (depth > 8) {
    return '[depth-limited]'
  }

  if (typeof value === 'string') {
    return compactRuntimeString(value)
  }

  if (Array.isArray(value)) {
    return value.map((item) => compactRuntimePayload(item, depth + 1))
  }

  if (isRecord(value)) {
    const next: DynamicValueMap = {}
    Object.entries(value).forEach(([key, nested]) => {
      next[key] = compactRuntimePayload(nested, depth + 1)
    })
    return next
  }

  return value
}

function getStringValue(value: DynamicValue): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function getNumberValue(value: DynamicValue): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getBooleanValue(value: DynamicValue): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function formatSmartAspectReason(reason: string | undefined): string {
  if (reason === 'reference-image') {
    return '参考图匹配'
  }
  if (reason === 'fallback-square') {
    return '回退方图'
  }
  if (reason === 'fallback-nearest') {
    return '回退最近比例'
  }
  return '自动处理'
}

function formatDurationMsLabel(value: DynamicValue): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return null
  }
  const seconds = Math.max(0.1, value / 1000)
  return `${seconds.toFixed(seconds >= 10 ? 1 : 2)}s`
}

function buildGenerateStartDetail(event: LogEvent): DynamicValueMap | null {
  const context = isRecord(event.context) ? event.context : {}
  const preflight = isRecord(context['preflight']) ? context['preflight'] : null
  if (!preflight) {
    return null
  }

  const detail: DynamicValueMap = {}
  const lines: string[] = []

  const smartAspect = isRecord(preflight['smartAspect']) ? preflight['smartAspect'] : null
  if (smartAspect) {
    const totalSmartParams = getNumberValue(smartAspect['totalSmartParams']) ?? 0
    const hasReferenceImage = getBooleanValue(smartAspect['hasReferenceImage']) ?? false
    const hasImageInput = getBooleanValue(smartAspect['hasImageInput']) ?? false
    const imageRatioReadFailed = getBooleanValue(smartAspect['imageRatioReadFailed']) ?? false
    const referenceImageRatio = getNumberValue(smartAspect['referenceImageRatio'])
    const adjustments = Array.isArray(smartAspect['adjustments']) ? smartAspect['adjustments'] : []
    const unresolvedParamIds = Array.isArray(smartAspect['unresolvedParamIds'])
      ? smartAspect['unresolvedParamIds'].filter((item): item is string => typeof item === 'string' && item.length > 0)
      : []

    if (totalSmartParams > 0) {
      const adjustmentSummary = adjustments
        .slice(0, 3)
        .map((item) => {
          if (!isRecord(item)) {
            return null
          }
          const paramId = getStringValue(item['paramId']) || 'DynamicValue'
          const from = item['from']
          const to = item['to']
          const fromText = typeof from === 'string' || typeof from === 'number' ? String(from) : 'smart'
          const toText = typeof to === 'string' || typeof to === 'number' ? String(to) : 'DynamicValue'
          return `${paramId}: ${fromText} -> ${toText} (${formatSmartAspectReason(getStringValue(item['reason']))})`
        })
        .filter((item): item is string => Boolean(item))

      if (adjustmentSummary.length > 0) {
        const suffix = adjustments.length > adjustmentSummary.length
          ? `，另外 ${adjustments.length - adjustmentSummary.length} 项已省略`
          : ''
        lines.push(`🧠 智能比例: ${adjustmentSummary.join('；')}${suffix}`)
      } else {
        lines.push('🧠 智能比例: 已检测到智能选项，但未命中可替换值')
      }

      if (hasReferenceImage && referenceImageRatio !== undefined) {
        lines.push(`📐 参考图比例: ${referenceImageRatio.toFixed(4)}`)
      }
      if (hasImageInput && imageRatioReadFailed) {
        lines.push('⚠️ 参考图存在，但本地未读取到宽高比（已回退默认比例）')
      }
      if (unresolvedParamIds.length > 0) {
        lines.push(`⚠️ 未解析参数: ${unresolvedParamIds.join(', ')}`)
      }
    }
  }

  const resolutionPreprocess = isRecord(preflight['resolutionPreprocess'])
    ? preflight['resolutionPreprocess']
    : null
  if (resolutionPreprocess) {
    const mode = getStringValue(resolutionPreprocess['mode']) || 'DynamicValue'
    const aspectRatio = getStringValue(resolutionPreprocess['aspectRatio']) || '-'
    const quality = getStringValue(resolutionPreprocess['quality']) || '-'
    const width = getNumberValue(resolutionPreprocess['width'])
    const height = getNumberValue(resolutionPreprocess['height'])
    const ratioHint = getNumberValue(resolutionPreprocess['ratioHint'])

    if (mode === 'smart') {
      const ratioPart = ratioHint !== undefined
        ? `参考图比例hint=${ratioHint.toFixed(4)}`
        : '未获取参考图比例hint（将走默认比例）'
      lines.push(`🧠 智能分辨率: 比例=${aspectRatio} | 质量=${quality} | ${ratioPart}`)
    } else if (mode === 'fixed') {
      const sizePart = width !== undefined && height !== undefined
        ? ` | 固定尺寸=${width}x${height}`
        : ''
      lines.push(`🧠 分辨率模式: 比例=${aspectRatio} | 质量=${quality}${sizePart}`)
    }
  }

  const mediaInputs = isRecord(preflight['mediaInputs']) ? preflight['mediaInputs'] : null
  if (mediaInputs) {
    const hasPrompt = getBooleanValue(mediaInputs['hasPrompt']) ?? false
    const imagesCount = getNumberValue(mediaInputs['imagesCount']) ?? 0
    const videosCount = getNumberValue(mediaInputs['videosCount']) ?? 0
    const uploadedVideoPathCount = getNumberValue(mediaInputs['uploadedVideoPathCount']) ?? 0
    lines.push(
      `🧪 输入检查: 文本${hasPrompt ? '✓' : '✗'} | 图片${imagesCount} | 视频${videosCount} | 本地视频路径${uploadedVideoPathCount}`
    )
  }

  const uploadStrategy = isRecord(preflight['uploadStrategy']) ? preflight['uploadStrategy'] : null
  if (uploadStrategy) {
    const provider = getStringValue(uploadStrategy['provider']) || 'DynamicValue'
    const fallbackEnabled = getBooleanValue(uploadStrategy['fallbackEnabled']) ?? false
    lines.push(`📤 上传策略: ${provider} | fallback ${fallbackEnabled ? '开启' : '关闭'}`)
  }

  const progressEstimate = isRecord(context['progressEstimate']) ? context['progressEstimate'] : null
  if (progressEstimate) {
    const durationLabel = formatDurationMsLabel(getNumberValue(progressEstimate['durationMs']))
    const source = getStringValue(progressEstimate['source']) || 'DynamicValue'
    const globalCount = getNumberValue(progressEstimate['globalSampleCount']) ?? 0
    const bucketCount = getNumberValue(progressEstimate['bucketSampleCount']) ?? 0
    const recentGlobal = Array.isArray(progressEstimate['recentGlobalDurationsMs'])
      ? progressEstimate['recentGlobalDurationsMs']
        .filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
        .slice(0, 8)
        .map((item) => formatDurationMsLabel(item))
        .filter((item): item is string => Boolean(item))
      : []
    const recentBucket = Array.isArray(progressEstimate['recentBucketDurationsMs'])
      ? progressEstimate['recentBucketDurationsMs']
        .filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
        .slice(0, 8)
        .map((item) => formatDurationMsLabel(item))
        .filter((item): item is string => Boolean(item))
      : []

    if (durationLabel) {
      lines.push(`⏱️ 本轮预计: ${durationLabel} | 来源=${source} | 全局样本=${globalCount} | 时段样本=${bucketCount}`)
    }
    if (recentGlobal.length > 0) {
      lines.push(`📚 最近全局样本: ${recentGlobal.join('、')}`)
    }
    if (recentBucket.length > 0) {
      lines.push(`🕒 最近时段样本: ${recentBucket.join('、')}`)
    }
  }

  if (lines.length === 0) {
    return null
  }

  detail['本地处理流程'] = lines
  return detail
}

function buildConsoleHead(event: LogEvent): string {
  const title = getConsoleTitle(event.event, event.level, event.message)
  const segments = [title]

  if (event.providerId) {
    segments.push(`供应商:${event.providerId}`)
  }
  if (event.modelId) {
    segments.push(`模型:${event.modelId}`)
  }
  if (event.taskId) {
    segments.push(`任务:${compactId(event.taskId)}`)
  }
  if (event.requestId) {
    segments.push(`请求:${compactId(event.requestId)}`)
  }

  return `[HenjiLog] ${segments.join(' | ')}`
}

function buildConsoleDetail(event: LogEvent): DynamicValueMap | null {
  if (event.event === 'generation.generate.start') {
    return buildGenerateStartDetail(event)
  }

  if (event.event === 'generation.generate.completed' || event.event === 'generation.continue_polling.completed') {
    const context = isRecord(event.context) ? event.context : {}
    const progressTiming = isRecord(context['progressTiming']) ? context['progressTiming'] : null
    if (!progressTiming) {
      return null
    }

    const estimatedLabel = formatDurationMsLabel(getNumberValue(progressTiming['estimatedDurationMs']))
    const actualLabel = formatDurationMsLabel(getNumberValue(progressTiming['actualDurationMs']))
    const globalEstimateLabel = formatDurationMsLabel(getNumberValue(progressTiming['globalEstimateMs']))
    const bucketEstimateLabel = formatDurationMsLabel(getNumberValue(progressTiming['bucketEstimateMs']))
    const defaultLabel = formatDurationMsLabel(getNumberValue(progressTiming['defaultDurationMs']))
    const recentGlobal = Array.isArray(progressTiming['recentGlobalDurationsMs'])
      ? progressTiming['recentGlobalDurationsMs']
        .filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
        .slice(0, 10)
        .map((item) => formatDurationMsLabel(item))
        .filter((item): item is string => Boolean(item))
      : []
    const recentBucket = Array.isArray(progressTiming['recentBucketDurationsMs'])
      ? progressTiming['recentBucketDurationsMs']
        .filter((item): item is number => typeof item === 'number' && Number.isFinite(item) && item > 0)
        .slice(0, 10)
        .map((item) => formatDurationMsLabel(item))
        .filter((item): item is string => Boolean(item))
      : []

    return {
      '本轮预计时间': estimatedLabel,
      '本轮实际时间': actualLabel,
      '预计来源': getStringValue(progressTiming['estimatedSource']) || '-',
      '默认时间': defaultLabel,
      '全局估算时间': globalEstimateLabel,
      '当前时段估算时间': bucketEstimateLabel,
      '当前时段': getStringValue(progressTiming['timeBucket']) || '-',
      '全局样本数': getNumberValue(progressTiming['globalSampleCount']) ?? 0,
      '时段样本数': getNumberValue(progressTiming['bucketSampleCount']) ?? 0,
      '最近全局样本': recentGlobal.length > 0 ? recentGlobal.join('、') : '无',
      '最近时段样本': recentBucket.length > 0 ? recentBucket.join('、') : '无',
    }
  }

  if (event.event === 'generation.runtime.request_json') {
    const context = isRecord(event.context) ? event.context : {}
    const requestBody = compactRuntimePayload(context['requestBody'])
    return {
      '最终请求参数(JSON)': toPrettyJson(requestBody ?? null),
    }
  }

  if (event.event === 'generation.runtime.response_json') {
    const context = isRecord(event.context) ? event.context : {}
    const responseBody = compactRuntimePayload(context['responseBody'])
    const detail: DynamicValueMap = {
      'API原始响应(JSON)': toPrettyJson(responseBody ?? null),
    }
    if (typeof context['phase'] === 'string') {
      detail['阶段'] = context['phase']
    }
    if (typeof context['method'] === 'string') {
      detail['方法'] = context['method']
    }
    if (typeof context['route'] === 'string') {
      detail['路由'] = context['route']
    }
    return detail
  }

  if (event.level !== 'error' && event.level !== 'warn') {
    return null
  }

  const detail: DynamicValueMap = {
    事件: event.event,
    域: event.domain,
    时间: event.timestamp,
  }

  if (event.message && event.message !== event.event) {
    detail['消息'] = event.message
  }
  if (event.requestId) {
    detail['requestId'] = event.requestId
  }
  if (event.taskId) {
    detail['taskId'] = event.taskId
  }
  if (event.modelId) {
    detail['modelId'] = event.modelId
  }
  if (event.providerId) {
    detail['providerId'] = event.providerId
  }
  if (event.context !== undefined && !isEmptyRecord(event.context)) {
    detail['上下文'] = event.context
  }
  if (event.error !== undefined && !isEmptyRecord(event.error)) {
    detail['错误'] = event.error
  }

  return detail
}

function writeToConsole(event: LogEvent): void {
  if (event.event === 'generation.runtime.trace') {
    return
  }

  const head = buildConsoleHead(event)
  const detail = buildConsoleDetail(event)

  if (!detail) {
    if (event.level === 'error') {
      console.error(head)
      return
    }
    if (event.level === 'warn') {
      console.warn(head)
      return
    }
    if (event.level === 'debug' || event.level === 'trace') {
      console.debug(head)
      return
    }
    console.info(head)
    return
  }

  console.groupCollapsed(head)
  console.log(detail)
  console.groupEnd()
}

/**
 * 记录一条"仅本地展示"的日志事件：写入内存 store（供 `UnifiedLogViewer` 等消费）并打印到
 * 控制台，但**不**经 `enqueueFrontendLogForBridge` 桥接回主进程落盘。
 *
 * 用于 `henji://runtime-request-preview` / `henji://llm-runtime-request-preview` 预览通道，
 * 以及 `GenerationService` 里从返回结果 `trace` 派生出的展示日志——这些事实主进程已经
 * 通过 `createMainLogger` 直接落盘一次，渲染层这里只做"实时预览"，避免同一份请求/响应
 * 内容经"渲染层转发再桥接"重复写入 `henji-*.log`。
 */
export function logPreviewOnly(domain: string, message: string, meta: LogCallMeta = {}): void {
  const level: LogLevel = 'info'
  if (!isDomainEnabled(domain) || !shouldLogLevel(level)) {
    return
  }

  const sanitizedContext = sanitizeLogPayload(meta.context)
  const event: LogEvent = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    timestamp: new Date().toISOString(),
    level,
    domain,
    event: meta.event || inferEvent(message, level),
    message,
    requestId: meta.requestId,
    taskId: meta.taskId,
    modelId: meta.modelId,
    providerId: meta.providerId,
    context: sanitizedContext,
    error: undefined,
    source: 'frontend',
  }

  appendLogEvent(event)
  writeToConsole(event)
}

function createInternalLogger(ctx: LoggerContext): Logger {
  const logAt = (level: LogLevel, args: DynamicValue[]): void => {
    if (!isDomainEnabled(ctx.domain) || !shouldLogLevel(level)) {
      return
    }

    const { message, meta } = normalizeMetaFromArgs(level, args)
    const mergedContext = meta.context === undefined
      ? ctx.context
      : isRecord(meta.context)
        ? { ...ctx.context, ...meta.context }
        : { ...ctx.context, detail: meta.context }

    const sanitizedContext = sanitizeLogPayload(mergedContext)
    const sanitizedError = sanitizeLogPayload(meta.error)

    const event: LogEvent = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      timestamp: new Date().toISOString(),
      level,
      domain: ctx.domain,
      event: meta.event || inferEvent(message, level),
      message,
      requestId: meta.requestId,
      taskId: meta.taskId,
      modelId: meta.modelId,
      providerId: meta.providerId,
      context: sanitizedContext,
      error: sanitizedError,
      source: 'frontend',
    }

    appendLogEvent(event)
    writeToConsole(event)
    enqueueFrontendLogForBridge(toBridgePayload(event))
  }

  const logger: Logger = {
    trace: (...args: DynamicValue[]) => logAt('trace', args),
    debug: (...args: DynamicValue[]) => logAt('debug', args),
    info: (...args: DynamicValue[]) => logAt('info', args),
    warn: (...args: DynamicValue[]) => logAt('warn', args),
    error: (...args: DynamicValue[]) => logAt('error', args),
    table: (...args: DynamicValue[]) => logAt('info', normalizeSyntheticLogArgs('table', args)),
    group: (...args: DynamicValue[]) => logAt('debug', normalizeSyntheticLogArgs('group', args)),
    groupCollapsed: (...args: DynamicValue[]) => logAt('debug', normalizeSyntheticLogArgs('group_collapsed', args)),
    groupEnd: (...args: DynamicValue[]) => logAt('debug', normalizeSyntheticLogArgs('group_end', args)),
    child: (subDomain: string, context: DynamicValueMap = {}) => {
      const nextDomain = subDomain.trim().length > 0 ? `${ctx.domain}.${subDomain}` : ctx.domain
      return createInternalLogger({
        domain: nextDomain,
        context: { ...ctx.context, ...context },
      })
    },
    withContext: (context: DynamicValueMap) => {
      return createInternalLogger({
        domain: ctx.domain,
        context: { ...ctx.context, ...context },
      })
    },
  }

  return logger
}

export function createLogger(domain: string, context: DynamicValueMap = {}): Logger {
  const normalizedDomain = domain.trim() || 'app'
  return createInternalLogger({
    domain: normalizedDomain,
    context,
  })
}

export function initLoggerConfig(): void {
  if (loggerConfigInitialized) {
    return
  }
  const { persistToFile } = refreshLogConfigByRuntime()
  if (!persistToFile) {
    return
  }

  if (isDesktopRuntime()) {
    // 两路预览通道只负责渲染层"实时预览"（控制台 + 测试模式面板的统一日志查看器），
    // 落盘职责已移交主进程（`ai-runtime/runtime.ts` / `llm/runtime.ts` 的 `createMainLogger`），
    // 这里改用 `logPreviewOnly` 避免同一份请求内容经桥接重复写入 `henji-*.log`。
    void listenRuntimeRequestPreview((payload) => {
      logPreviewOnly('core.services.GenerationService', '最终请求参数(JSON)', {
        event: 'generation.runtime.request_json',
        requestId: payload.requestId,
        taskId: payload.taskId,
        modelId: payload.modelId,
        providerId: payload.providerId,
        context: {
          method: payload.method,
          route: payload.route,
          requestBody: payload.requestBody,
        },
      })
    }).then((unlisten) => {
      runtimePreviewUnlisten = unlisten
    }).catch(() => {
      runtimePreviewUnlisten = null
    })

    void listenLlmRuntimeRequestPreview((payload) => {
      logPreviewOnly('commands.llmRuntime', 'LLM 实际请求参数(JSON)', {
        event: 'llm_runtime.chat_stream.request_json',
        requestId: payload.requestId,
        modelId: payload.modelId,
        providerId: payload.providerId,
        context: {
          method: payload.method,
          route: payload.route,
          requestBody: payload.requestBody,
        },
      })
    }).then((unlisten) => {
      llmRuntimePreviewUnlisten = unlisten
    }).catch(() => {
      llmRuntimePreviewUnlisten = null
    })
  }

  window.addEventListener('beforeunload', () => {
    runtimePreviewUnlisten?.()
    runtimePreviewUnlisten = null
    llmRuntimePreviewUnlisten?.()
    llmRuntimePreviewUnlisten = null
    void flushFrontendLogBridge()
  })
  loggerConfigInitialized = true
}
