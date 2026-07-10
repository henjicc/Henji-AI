import { useEffect, useState } from 'react'
import { listenLogEvent, type LogEventPushDto } from '@/commands/logging'
import { createLogger } from '@/core/logging'
import type { DisplayLogEvent } from './eventDisplay'

const logger = createLogger('features.logs.logStore')

/**
 * 日志窗口内存缓冲上限。日志窗口是独立渲染进程，`src/core/logging/store.ts` 在这里是空的
 * （见 handoff.md）——本 store 的数据完全来自主进程实时推送 `henji://log-event`，不依赖
 * 渲染层内存日志 store，也不做历史回读（历史回读是 2.3 的范围）。
 */
const MAX_EVENTS = 5000

type Listener = () => void

/**
 * 日志窗口专用数据源：订阅主进程推送、维护有上限的事件缓冲、支持暂停/恢复/清空。
 * 暂停期间新事件不会进入可见列表，而是缓冲到 `pausedBuffer`，恢复时一次性并入，
 * 保证"暂停后触发新请求列表不动、恢复后补上"这条验收标准。
 */
class LogWindowStore {
  private events: DisplayLogEvent[] = []
  private pausedBuffer: DisplayLogEvent[] = []
  private paused = false
  private seq = 0
  private listeners = new Set<Listener>()

  getSnapshot(): DisplayLogEvent[] {
    return this.events
  }

  isPaused(): boolean {
    return this.paused
  }

  getPausedCount(): number {
    return this.pausedBuffer.length
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener())
  }

  private withIds(batch: LogEventPushDto[]): DisplayLogEvent[] {
    return batch.map((event) => ({ ...event, id: `${Date.now()}-${this.seq++}` }))
  }

  private static capped(list: DisplayLogEvent[]): DisplayLogEvent[] {
    if (list.length <= MAX_EVENTS) {
      return list
    }
    return list.slice(list.length - MAX_EVENTS)
  }

  ingest(batch: LogEventPushDto[]): void {
    if (batch.length === 0) {
      return
    }

    const withIds = this.withIds(batch)
    if (this.paused) {
      this.pausedBuffer = LogWindowStore.capped([...this.pausedBuffer, ...withIds])
      this.emit()
      return
    }

    this.events = LogWindowStore.capped([...this.events, ...withIds])
    this.emit()
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) {
      return
    }

    this.paused = paused
    if (!paused && this.pausedBuffer.length > 0) {
      const buffered = this.pausedBuffer
      this.pausedBuffer = []
      this.events = LogWindowStore.capped([...this.events, ...buffered])
    }
    this.emit()
  }

  clear(): void {
    this.events = []
    this.pausedBuffer = []
    this.emit()
  }
}

export const logWindowStore = new LogWindowStore()

let subscriptionStarted = false

/** 建立主进程推送订阅，全应用只需成功建立一次（幂等）。 */
function ensureLogWindowSubscription(): void {
  if (subscriptionStarted) {
    return
  }
  subscriptionStarted = true

  void listenLogEvent((events) => {
    logWindowStore.ingest(events)
  }).catch((error) => {
    subscriptionStarted = false
    logger.error('[LogsWindow] 订阅日志推送失败', error)
  })
}

export interface UseLogWindowStoreResult {
  events: DisplayLogEvent[]
  paused: boolean
  pausedCount: number
  setPaused: (paused: boolean) => void
  clear: () => void
}

/** 日志窗口专用 hook：挂载时建立订阅，返回当前事件缓冲与暂停/清空控制。 */
export function useLogWindowStore(): UseLogWindowStoreResult {
  const [, forceRender] = useState(0)

  useEffect(() => {
    ensureLogWindowSubscription()
    return logWindowStore.subscribe(() => forceRender((tick) => tick + 1))
  }, [])

  return {
    events: logWindowStore.getSnapshot(),
    paused: logWindowStore.isPaused(),
    pausedCount: logWindowStore.getPausedCount(),
    setPaused: (paused) => logWindowStore.setPaused(paused),
    clear: () => logWindowStore.clear(),
  }
}
