import { logFrontendEvents } from '@/commands/logging'
import { isDesktopRuntime } from '@/platform/runtime'
import { getLogConfig } from './config'
import type { LogEventBridgeDto } from './types'

let queue: LogEventBridgeDto[] = []
let flushTimer: ReturnType<typeof setTimeout> | null = null
let isFlushing = false

function scheduleFlush(): void {
  if (flushTimer || isFlushing) {
    return
  }

  const interval = getLogConfig().flushIntervalMs
  flushTimer = setTimeout(() => {
    flushTimer = null
    void flushLogQueue()
  }, interval)
}

const SEND_TIMEOUT = Symbol('logBridgeSendTimeout')
const SEND_TIMEOUT_MS = 10_000

/** 主进程迟迟不答复时按失败处理：一直等下去会让之后的日志全部停在内存里。 */
function send(events: LogEventBridgeDto[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(SEND_TIMEOUT), SEND_TIMEOUT_MS)
    logFrontendEvents(events).then(resolve, reject).finally(() => clearTimeout(timer))
  })
}

/** 一条事件单独发送仍被拒绝：改记一条说明原因的事件。返回 false 表示连说明也发不出去（通道不通）。 */
async function sendRejected(event: LogEventBridgeDto, error: unknown): Promise<boolean> {
  if (error === SEND_TIMEOUT) return false
  const reason = error instanceof Error ? error.message : String(error)
  return send([{ timestamp: event.timestamp, level: 'warn', domain: 'core.logging', event: 'logging.bridge.event_rejected', message: '一条日志未能写入文件', context: { rejectedEvent: String(event.event), rejectedDomain: String(event.domain), reason } }]).then(() => true, () => false)
}

async function flushLogQueue(): Promise<void> {
  if (isFlushing || queue.length === 0) {
    return
  }

  if (!isDesktopRuntime()) {
    queue = []
    return
  }

  isFlushing = true

  try {
    const batchSize = getLogConfig().flushBatchSize

    while (queue.length > 0) {
      const batch = queue.slice(0, batchSize)
      try {
        await send(batch)
      } catch (error) {
        // 通道本身不通时保留队列稍后重试；只是其中某条事件写不进去时丢掉那一条，不能让它挡住之后的全部日志。
        if (error === SEND_TIMEOUT) throw error
        for (const event of batch) {
          try { await send([event]) } catch (reason) { if (!(await sendRejected(event, reason))) throw reason }
          queue = queue.slice(1)
        }
        continue
      }
      queue = queue.slice(batch.length)
    }
  } catch {
    // 保留队列，下一次重试
    scheduleFlush()
  } finally {
    isFlushing = false
  }
}

export function enqueueFrontendLogForBridge(event: LogEventBridgeDto): void {
  if (!getLogConfig().persistToFile) {
    return
  }

  queue = [...queue, event]
  scheduleFlush()
}

export async function flushFrontendLogBridge(): Promise<void> {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  await flushLogQueue()
}
