import { getPlatform } from '@/platform'
import type { RecordingProductStep } from '@/core/screenRecording/products'

/** Existing log query only. Never infer a recording wall clock from file modification time. */
export async function recordingProductLogs(sessionId: string, createdAt: number, steps: readonly RecordingProductStep[], signal: AbortSignal): Promise<{ text: string; warnings: string[] }> {
  const logging = getPlatform().logging
  const allDates = await logging.listLogDates()
  const localDate = (time: number): string => { const value = new Date(time); return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}` }
  const anchorDates = new Set([-864e5, 0, 864e5].map(offset => localDate(createdAt + offset)))
  let originMs: number | undefined
  for (const date of allDates.filter(date => anchorDates.has(date))) {
    signal.throwIfAborted()
    const result = await logging.queryLogEvents({ date, keyword: sessionId, domainPrefix: 'main.screen_recording.capture', limit: 256 })
    const anchor = result.events.find(event => event.event === 'recording.capture.prepare.completed' && event.context && typeof event.context === 'object' && 'sessionId' in event.context && event.context.sessionId === sessionId && 'monoUs' in event.context && 'capturesApplication' in event.context && event.context.capturesApplication === true)
    if (anchor && anchor.context && typeof anchor.context === 'object' && 'monoUs' in anchor.context && typeof anchor.context.monoUs === 'number') { originMs = Date.parse(anchor.timestamp) - anchor.context.monoUs / 1000; break }
  }
  if (originMs === undefined) return { text: '', warnings: ['未找到录制与应用日志的时钟关联，报告未附日志。'] }
  const startMs = originMs + Math.min(...steps.map(step => step.startUs)) / 1000, endMs = originMs + Math.max(...steps.map(step => step.endUs)) / 1000
  const lines: string[] = []
  let truncated = false
  const reportDates = new Set<string>()
  for (let day = startMs - 864e5; day <= endMs + 864e5; day += 864e5) reportDates.add(localDate(day))
  for (const date of allDates.filter(date => reportDates.has(date))) {
    // Query dates as declared by the logger; timestamp filters enforce the exact wall-clock range.
    signal.throwIfAborted()
    const result = await logging.queryLogEvents({ date, afterTimestamp: new Date(startMs).toISOString(), beforeTimestamp: new Date(endMs + 1).toISOString(), limit: 256 })
    truncated ||= result.hasMore
    for (const event of result.events) {
      const atUs = (Date.parse(event.timestamp) - originMs) * 1000
      if (!steps.some(step => atUs >= step.startUs && atUs < step.endUs)) continue
      // Context, errors/stacks and paths are deliberately excluded from the sharable report.
      lines.push(`${event.timestamp} ${event.level} ${event.domain} ${event.event}`)
    }
    if (lines.length >= 256) { truncated = true; break }
  }
  return { text: lines.slice(0, 256).reverse().join('\n'), warnings: truncated ? ['应用日志片段限 256 条，完整记录可在日志窗口查询。'] : [] }
}
