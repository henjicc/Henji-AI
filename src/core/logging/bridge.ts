import { isTauri } from '@tauri-apps/api/core'
import { logFrontendEvents } from '@/commands/logging'
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

async function flushLogQueue(): Promise<void> {
  if (isFlushing || queue.length === 0) {
    return
  }

  if (!isTauri()) {
    queue = []
    return
  }

  isFlushing = true

  try {
    const batchSize = getLogConfig().flushBatchSize

    while (queue.length > 0) {
      const batch = queue.slice(0, batchSize)
      await logFrontendEvents(batch)
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
