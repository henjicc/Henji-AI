import { listLogDates, queryLogEvents } from '@/commands/logging'

/** 提交失败与续查失败都算：前者多是请求被拒（参数、字段、鉴权），后者多是结果解析或平台任务失败。 */
const FAILURE_EVENTS = ['generation.generate.failed', 'generation.continue_polling.failed'] as const

export interface ModelFailureSummary {
  count: number
  lastAt: string
  /** 不同的错误说明，按出现次数从多到少，最多 3 条 */
  messages: readonly string[]
}

function failureMessage(context: unknown, fallback: string): string {
  const message = context && typeof context === 'object' ? (context as { message?: unknown }).message : undefined
  return typeof message === 'string' && message.trim() ? message.trim() : fallback
}

/**
 * 从本机日志汇总最近几天每个模型的生成失败。日常使用里供应商返回 4xx 一类的错误，多半就是适配问题；
 * 走现有的日志查询，不另建通道。
 */
export async function loadRecentGenerationFailures(days = 7): Promise<ReadonlyMap<string, ModelFailureSummary>> {
  const dates = (await listLogDates()).slice(0, days)
  const byModel = new Map<string, { count: number; lastAt: string; messages: Map<string, number> }>()
  for (const date of dates) {
    for (const event of FAILURE_EVENTS) {
      const result = await queryLogEvents({ date, level: 'error', keyword: event, limit: 2000 })
      for (const item of result.events) {
        if (item.event !== event || !item.modelId) continue
        const entry = byModel.get(item.modelId) ?? { count: 0, lastAt: item.timestamp, messages: new Map<string, number>() }
        entry.count += 1
        if (item.timestamp > entry.lastAt) entry.lastAt = item.timestamp
        const message = failureMessage(item.context, item.message)
        entry.messages.set(message, (entry.messages.get(message) ?? 0) + 1)
        byModel.set(item.modelId, entry)
      }
    }
  }
  return new Map([...byModel].map(([modelId, entry]) => [modelId, {
    count: entry.count,
    lastAt: entry.lastAt,
    messages: [...entry.messages].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([message]) => message),
  }]))
}
