/**
 * 内置助手一次运行的完整处理链路，由同一 requestId 的日志事件还原。
 * 日志窗口“助手追踪”和 `npm run logs:query -- --chain <runId>` 共用这里，保证人和 AI 看到同一份链路；
 * 本文件不依赖浏览器或 Node 能力，命令行用 esbuild 直接加载。
 */

/** 只用到的日志字段；渲染层事件与日志文件里的 JSON 行都满足它。 */
export interface AssistantChainLogEvent {
  timestamp: string
  level: string
  domain: string
  event: string
  message: string
  source?: string
  requestId?: string
  modelId?: string
  providerId?: string
  context?: unknown
  error?: unknown
}

export type AssistantChainStepKind = 'input' | 'context' | 'model' | 'tool' | 'transaction' | 'reply'
export type AssistantChainStatus = 'running' | 'completed' | 'failed' | 'cancelled'

export interface AssistantChainStep {
  id: string
  kind: AssistantChainStepKind
  title: string
  summary: string
  status: AssistantChainStatus
  startedAt?: string
  durationMs?: number
  paid?: boolean
  /** 事务挂在所属工具调用下面。 */
  nested?: boolean
  /** 模型轮次对应的助手追踪记录。 */
  traceId?: string
  data: Record<string, unknown>
  /** 组成这一步的日志事件在 events 中的下标。 */
  eventIndexes: number[]
}

export interface AssistantChain {
  runId: string
  sessionId: string | null
  input: string
  status: AssistantChainStatus
  startedAt: string | null
  durationMs?: number
  answer: string
  steps: AssistantChainStep[]
  /** 按时间升序的全部相关日志。 */
  events: AssistantChainLogEvent[]
}

type Facts = Record<string, unknown>
const record = (value: unknown): Facts => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Facts : {}
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const text = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined
const facts = (event: AssistantChainLogEvent | undefined): Facts => record(event?.context)
const errorText = (event: AssistantChainLogEvent | undefined): string | undefined => text(record(event?.error).message) ?? text(facts(event).failureReason)

const STOP_REASONS: Record<string, string> = { stop: '回复结束', toolUse: '调用工具', length: '达到长度上限', error: '出错', aborted: '已中止' }
export const ASSISTANT_CHAIN_STATUS_LABEL: Record<AssistantChainStatus, string> = { running: '进行中', completed: '完成', failed: '失败', cancelled: '已停止' }
const STATUS_LABEL = ASSISTANT_CHAIN_STATUS_LABEL
const TURN_END = new Set(['embedded_agent.turn.completed', 'embedded_agent.turn.failed', 'embedded_agent.turn.cancelled'])
const CHAIN_MARKERS = new Set(['embedded_agent.message.queued', 'embedded_agent.turn.start'])

function oneLine(value: string, limit = 120): string {
  const line = value.replace(/\s+/g, ' ').trim()
  return line.length > limit ? `${line.slice(0, limit)}…` : line
}

function compactJson(value: unknown, limit = 120): string {
  try { return oneLine(JSON.stringify(value) ?? '', limit) } catch { return '' }
}

function formatChainTokens(value: number | undefined | null): string {
  if (value === undefined || value === null) return '—'
  return value >= 1000 ? `${(value / 1000).toFixed(1)}K` : String(value)
}

export function formatChainDuration(value: number | undefined): string {
  if (value === undefined) return ''
  if (value < 1000) return `${value}ms`
  if (value < 60_000) return `${(value / 1000).toFixed(1)}s`
  return `${Math.floor(value / 60_000)}m ${Math.round((value % 60_000) / 1000)}s`
}

const EVENT_KEYS = ['timestamp', 'level', 'domain', 'event', 'message', 'source', 'requestId', 'taskId', 'modelId', 'providerId', 'context', 'error', 'truncatedByLimit'] as const
/** 日志文件行和窗口里的事件字段顺序、附加字段不同；按固定字段重排，命令行与界面输出才逐字相同。 */
function normalizeEvent(event: AssistantChainLogEvent): AssistantChainLogEvent {
  const source = event as unknown as Record<string, unknown>
  return Object.fromEntries(EVENT_KEYS.flatMap(key => source[key] === undefined ? [] : [[key, source[key]]])) as unknown as AssistantChainLogEvent
}

/** 这组事件是不是内置助手的一次运行（旧助手只有模型追踪，没有链路日志）。 */
export function isAssistantChainRun(events: AssistantChainLogEvent[]): boolean {
  return events.some(event => CHAIN_MARKERS.has(event.event))
}

/**
 * 按时间还原：收到输入 → 组装上下文 → 每轮模型请求与工具调用交错（事务紧跟所属工具）→ 最终回复。
 * 记忆整理用 `<runId>:memory` 另起一条链路，不混进来。
 */
export function buildAssistantChain(runId: string, input: AssistantChainLogEvent[], now = Date.now()): AssistantChain {
  const events = input.filter(event => event.requestId === runId).map(normalizeEvent).sort((left, right) => left.timestamp.localeCompare(right.timestamp))
  const index = new Map(events.map((event, position) => [event, position]))
  const at = (...items: Array<AssistantChainLogEvent | undefined>): number[] => items.flatMap(item => item && index.has(item) ? [index.get(item)!] : [])
  const find = (name: string): AssistantChainLogEvent | undefined => events.find(event => event.event === name)
  const queued = find('embedded_agent.message.queued')
  const start = find('embedded_agent.turn.start')
  const requestFailed = find('embedded_agent.request.failed')
  const end = [...events].reverse().find(event => TURN_END.has(event.event))
  const status: AssistantChainStatus = requestFailed ? 'failed' : !end ? 'running'
    : end.event.endsWith('.completed') ? 'completed' : end.event.endsWith('.cancelled') ? 'cancelled' : 'failed'
  const settled = status !== 'running'
  const first = queued ?? events[0]
  const startedAt = first?.timestamp ?? null
  const elapsed = (from: string, to?: string): number => Math.max(0, (to ? Date.parse(to) : now) - Date.parse(from))
  const inputText = text(facts(queued).text) ?? ''
  const sessionId = text(facts(start).sessionId) ?? text(facts(end).sessionId) ?? null
  const steps: AssistantChainStep[] = []

  if (queued) {
    const queuedFacts = facts(queued)
    steps.push({ id: 'input', kind: 'input', title: '收到输入', summary: oneLine(inputText) || '（无文字）', status: 'completed', startedAt: queued.timestamp,
      data: { text: inputText, delivery: queuedFacts.delivery, attachmentCount: queuedFacts.attachmentCount, model: queuedFacts.model }, eventIndexes: at(queued) })
  }

  const prepared = find('embedded_agent.context.prepared')
  if (prepared) {
    const preparedFacts = facts(prepared)
    const parts = Array.isArray(preparedFacts.parts) ? preparedFacts.parts.map(record) : []
    const total = parts.reduce((sum, part) => sum + (number(part.estimatedTokens) ?? 0), 0)
    const count = (id: string): number => number(parts.find(part => part.id === id)?.count) ?? 0
    steps.push({ id: 'context', kind: 'context', title: '组装上下文',
      summary: `约 ${formatChainTokens(total)} tok · 技能 ${count('skills')} · 记忆 ${count('memory')} · 工具 ${count('tools')}`,
      status: 'completed', startedAt: prepared.timestamp, durationMs: number(preparedFacts.durationMs),
      data: { ...preparedFacts, providerId: prepared.providerId, modelId: prepared.modelId }, eventIndexes: at(prepared) })
  }

  const requests = events.filter(event => event.event === 'embedded_agent.turn.model_requested')
  const completions = events.filter(event => event.event === 'embedded_agent.turn.model_completed')
  const middle: AssistantChainStep[] = requests.map((request, position) => {
    const turn = number(facts(request).turn) ?? position + 1
    const done = completions.find(event => number(facts(event).turn) === turn) ?? completions[position]
    const doneFacts = facts(done)
    const metrics = record(doneFacts.metrics)
    const stopReason = text(doneFacts.stopReason)
    const roundStatus: AssistantChainStatus = done ? stopReason === 'error' ? 'failed' : stopReason === 'aborted' ? 'cancelled' : 'completed'
      : settled ? status === 'completed' ? 'completed' : status : 'running'
    const input = number(metrics.input)
    const cacheRead = number(metrics.cacheRead)
    return { id: `model-${turn}`, kind: 'model', title: `第 ${turn} 轮模型请求`, traceId: `${runId}:${turn}`,
      summary: done ? `输入 ${formatChainTokens((input ?? 0) + (cacheRead ?? 0) + (number(metrics.cacheWrite) ?? 0))}（缓存 ${formatChainTokens(cacheRead)}）· 输出 ${formatChainTokens(number(metrics.output))} · ${STOP_REASONS[stopReason ?? ''] ?? stopReason ?? '已返回'}`
        : `${request.providerId ?? ''}/${request.modelId ?? ''}`,
      status: roundStatus, startedAt: request.timestamp, durationMs: number(doneFacts.durationMs),
      data: { turn, providerId: request.providerId, modelId: request.modelId, request: facts(request).requestMetrics, usage: metrics, stopReason,
        ...(roundStatus === 'failed' ? { error: errorText(done) } : {}) }, eventIndexes: at(request, done) }
  })

  // 媒体分块读取按 `<调用>:<偏移>` 逐块派发给应用，归并回 Pi 的那一次调用
  const executedIds = new Set(events.filter(event => event.event === 'embedded_agent.turn.tool_executed').flatMap(event => text(record(facts(event).tool).toolCallId) ?? []))
  const baseCall = (id: string): string => { const chunk = /^(.*):\d+$/.exec(id); return chunk && executedIds.has(chunk[1]) ? chunk[1] : id }
  for (const toolStart of events.filter(event => event.event === 'embedded_agent.tool.start')) {
    const startFacts = facts(toolStart)
    const dispatchId = text(startFacts.toolCallId) ?? toolStart.timestamp
    const callId = baseCall(dispatchId)
    const toolEnd = events.find(event => (event.event === 'embedded_agent.tool.completed' || event.event === 'embedded_agent.tool.failed') && facts(event).toolCallId === dispatchId)
    const chunked = middle.find(step => step.id === `tool-${callId}`)
    if (chunked) {
      chunked.eventIndexes.push(...at(toolStart, toolEnd))
      chunked.durationMs = (chunked.durationMs ?? 0) + (number(facts(toolEnd).durationMs) ?? 0)
      chunked.data.chunks = (number(chunked.data.chunks) ?? 1) + 1
      if (toolEnd?.event === 'embedded_agent.tool.failed') { chunked.status = 'failed'; chunked.summary = oneLine(errorText(toolEnd) ?? '调用失败') }
      continue
    }
    const endFacts = facts(toolEnd)
    const result = record(endFacts.result)
    const failed = toolEnd?.event === 'embedded_agent.tool.failed'
    const awaiting = result.executionState === 'awaiting_user_confirmation'
    const toolName = text(startFacts.toolName) ?? '工具'
    const toolStatus: AssistantChainStatus = toolEnd ? failed ? 'failed' : 'completed' : settled ? 'cancelled' : 'running'
    middle.push({ id: `tool-${callId}`, kind: 'tool', title: text(startFacts.title) ?? toolName,
      summary: failed ? oneLine(errorText(toolEnd) ?? '调用失败') : awaiting ? '等待用户确认付费' : `${toolName} ${compactJson(startFacts.input, 100)}`,
      status: toolStatus, startedAt: toolStart.timestamp, durationMs: number(endFacts.durationMs), paid: startFacts.paid === true,
      data: { toolName, toolCallId: callId, operationId: startFacts.operationId, readOnly: startFacts.readOnly, paid: startFacts.paid === true, input: startFacts.input,
        ...(toolEnd ? { result, ...(failed ? { failureCode: endFacts.failureCode, error: errorText(toolEnd) } : {}) } : {}) },
      eventIndexes: at(toolStart, toolEnd) })
    if (!['transactionRef', 'undoRef', 'resultRefs', 'persistence'].some(key => result[key] !== undefined)) continue
    const refs = number(result.resultRefCount) ?? 0
    middle.push({ id: `transaction-${callId}`, kind: 'transaction', title: '执行事务', nested: true,
      summary: [refs ? `写入 ${refs} 项` : '无写入引用', result.undoRef ? '有撤销点' : '无撤销点',
        result.persistence ? `保存 ${String(result.persistence)}` : '', result.verified === false ? '验证未通过' : ''].filter(Boolean).join(' · '),
      status: result.ok === false || result.verified === false ? 'failed' : 'completed', startedAt: toolEnd?.timestamp,
      data: { transactionRef: result.transactionRef, undoRef: result.undoRef, resultRefs: result.resultRefs, resultRefCount: result.resultRefCount,
        effectCount: result.effectCount, verified: result.verified, persistence: result.persistence, executionState: result.executionState, status: result.status },
      eventIndexes: at(toolEnd) })
  }
  // Pi 层的执行记录：交给应用的调用补上模型实际看到的回执；Pi 自己处理或拒绝的调用（未加载的工具、参数不合格、本地读取）单列一步。
  for (const executed of events.filter(event => event.event === 'embedded_agent.turn.tool_executed')) {
    const tool = record(facts(executed).tool)
    const callId = text(tool.toolCallId)
    if (!callId) continue
    const dispatched = middle.find(step => step.id === `tool-${callId}`)
    if (dispatched) {
      dispatched.eventIndexes.push(...at(executed))
      dispatched.data.modelSawResult = tool.resultText
      continue
    }
    const failed = tool.isError === true
    const toolName = text(tool.toolName) ?? '工具'
    const durationMs = number(tool.durationMs)
    middle.push({ id: `tool-${callId}`, kind: 'tool', title: toolName,
      summary: failed ? oneLine(text(tool.resultText) ?? '执行出错') : `${toolName} ${compactJson(tool.args, 100)}`,
      status: failed ? 'failed' : 'completed', startedAt: durationMs === undefined ? executed.timestamp : new Date(Date.parse(executed.timestamp) - durationMs).toISOString(), durationMs,
      data: { toolName, toolCallId: callId, handledBy: 'pi', input: tool.args, isError: failed, modelSawResult: tool.resultText }, eventIndexes: at(executed) })
  }
  steps.push(...middle.sort((left, right) => (left.startedAt ?? '').localeCompare(right.startedAt ?? '') || Number(Boolean(left.nested)) - Number(Boolean(right.nested))))

  const answer = text(facts(end).answer) ?? ''
  if (settled) {
    const usage = find('embedded_agent.turn.usage_summary')
    const failure = status === 'failed' ? errorText(requestFailed) ?? errorText(end) ?? end?.message : undefined
    const closing = end ?? requestFailed
    steps.push({ id: 'reply', kind: 'reply', title: '最终回复',
      summary: failure ? oneLine(failure) : answer ? oneLine(answer) : status === 'cancelled' ? '已停止' : '无文字回复',
      status, startedAt: closing?.timestamp, durationMs: number(facts(end).durationMs),
      data: { answer, ...(failure ? { error: failure } : {}), usage: record(facts(usage).summary) }, eventIndexes: at(end, requestFailed, usage) })
  }
  // 没有的字段不留空键，详情树里不出现一排 undefined
  for (const step of steps) step.data = Object.fromEntries(Object.entries(step.data).filter(([, value]) => value !== undefined))
  const lastAt = events.at(-1)?.timestamp
  return { runId, sessionId, input: inputText, status, startedAt, durationMs: startedAt && settled && lastAt ? elapsed(startedAt, lastAt) : undefined,
    answer, steps, events }
}

/** 可读摘要 + 结构化 JSON；命令行输出与界面“复制完整链路”都用它。 */
export function formatAssistantChainReport(chain: AssistantChain): string {
  const lines = [`助手运行 ${chain.runId} · ${STATUS_LABEL[chain.status]}${chain.durationMs !== undefined ? ` · ${formatChainDuration(chain.durationMs)}` : ''}${chain.sessionId ? ` · 会话 ${chain.sessionId}` : ''}`]
  let position = 0
  for (const step of chain.steps) {
    const marks = [`[${STATUS_LABEL[step.status]}]`, step.paid ? '[付费]' : ''].join('')
    const duration = step.durationMs !== undefined ? ` · ${formatChainDuration(step.durationMs)}` : ''
    lines.push(`${step.nested ? '   └ ' : `${++position}. `}${marks} ${step.title}${duration} · ${step.summary}`)
  }
  if (chain.answer) lines.push('', '最终回复：', chain.answer)
  const json = JSON.stringify({ ...chain, steps: chain.steps.map(step => ({ ...step })) }, null, 2)
  return `${lines.join('\n')}\n\n完整链路（JSON）：\n${json}\n`
}
