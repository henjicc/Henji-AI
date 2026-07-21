import { getDomainHint, getEventDisplay, type DisplayLogEvent } from './eventDisplay'

/**
 * 单条事件与整条请求链路的复制格式化模块：Markdown（适合贴给人/AI 排查）与原始 JSON。
 * 复制动作本身用 `copyTextToClipboard`（渲染层 `navigator.clipboard` 兜底，见 handoff.md
 * 关于剪贴板能力落点的决策：preload 当前没有"写文本到剪贴板"的方法，日志窗口不新增 IPC）。
 */

function toCodeBlock(value: DynamicValue, lang: string): string {
  if (value === undefined) {
    return ''
  }
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
  return `\`\`\`${lang}\n${text}\n\`\`\``
}

/** 单条事件的 Markdown 摘要：元信息 + context/error 代码块。 */
export function eventToMarkdown(event: DisplayLogEvent): string {
  const display = getEventDisplay(event)
  const lines: string[] = []

  lines.push(`### ${display.emoji} ${display.title}`)
  lines.push('')
  lines.push(`- 时间: ${event.timestamp}`)
  lines.push(`- 级别: ${event.level}`)
  lines.push(`- 来源: ${event.source}`)
  lines.push(`- Domain: ${getDomainHint(event.domain)} (${event.domain})`)
  lines.push(`- 事件类型: ${event.event}`)
  if (event.requestId) lines.push(`- requestId: ${event.requestId}`)
  if (event.taskId) lines.push(`- taskId: ${event.taskId}`)
  if (event.modelId) lines.push(`- 模型: ${event.modelId}`)
  if (event.providerId) lines.push(`- Provider: ${event.providerId}`)
  lines.push(`- 消息: ${event.message}`)

  if (event.context !== undefined) {
    lines.push('')
    lines.push('**上下文数据（context）：**')
    lines.push(toCodeBlock(event.context, 'json'))
  }

  if (event.error !== undefined) {
    lines.push('')
    lines.push('**错误信息（error）：**')
    lines.push(toCodeBlock(event.error, 'json'))
  }

  return lines.join('\n')
}

/** 单条事件的原始 JSON（含渲染层本地 id）。 */
export function eventToJson(event: DisplayLogEvent): string {
  return JSON.stringify(event, null, 2)
}

/** 按时间升序排列链路事件，供 Markdown/JSON 两种格式化共用。 */
function sortByTimestamp(events: DisplayLogEvent[]): DisplayLogEvent[] {
  return [...events].sort((a, b) => a.timestamp.localeCompare(b.timestamp))
}

/** 整条请求链路的 Markdown：标题 + 事件计数 + 逐条事件（按时间升序、分隔线隔开）。 */
export function chainToMarkdown(events: DisplayLogEvent[]): string {
  if (events.length === 0) {
    return ''
  }

  const sorted = sortByTimestamp(events)
  const requestId = sorted[0].requestId || '-'
  const header = [`# 请求链路 requestId: ${requestId}`, '', `共 ${sorted.length} 条事件`, '']

  const body = sorted.map((event) => eventToMarkdown(event)).join('\n\n---\n\n')

  return [...header, body].join('\n')
}

/** 整条请求链路的原始 JSON（按时间升序的事件数组）。 */
export function chainToJson(events: DisplayLogEvent[]): string {
  return JSON.stringify(sortByTimestamp(events), null, 2)
}

/**
 * 写文本到系统剪贴板。preload 的 `HenjiClipboardApi` 目前只有读剪贴板/写图片，没有写文本方法，
 * 日志窗口是纯渲染层调试功能，直接用 `navigator.clipboard.writeText` 兜底（Electron 渲染进程
 * 内可直接调用，不需要走 preload 新增 IPC）。
 */
export async function copyTextToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}
