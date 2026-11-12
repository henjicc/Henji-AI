import { useEffect } from 'react'
import { getApplicationHostService } from '@/commands/applicationControl'
import { createLogger } from '@/core/logging'
import { createHostContextSnapshot, retainHostContextTracking, subscribeHostContext } from './hostContext/hostContext'
import { attachOperationReviews } from './operationReviews'
import { useCanvasStore } from '@/stores/canvasStore'

const logger = createLogger('features.application_control.host')

/** 拖动、缩放节点时的发布间隔；助手读到的快照最多旧这么久，修订号照常逐帧推进。 */
export const GESTURE_PUBLISH_INTERVAL_MS = 250

/**
 * 合并上下文发布：同一轮任务里的多次变化只发一次；画布手势进行中尾随节流，
 * 手势一结束（下一次变化发生在手势之外）立即补发，不必等节流窗口。
 */
export function createHostContextPublishScheduler(publishNow: () => void, isGestureActive: () => boolean): { request(): void; dispose(): void } {
  let queued = false
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null
  let lastPublishedAt = Number.NEGATIVE_INFINITY
  const flush = (): void => {
    queued = false
    timer = null
    if (disposed) return
    lastPublishedAt = Date.now()
    publishNow()
  }
  const queueFlush = (): void => {
    if (queued) return
    queued = true
    queueMicrotask(flush)
  }
  return {
    request() {
      if (disposed) return
      if (!isGestureActive()) {
        if (timer) { clearTimeout(timer); timer = null }
        queueFlush()
        return
      }
      if (queued || timer) return
      const wait = lastPublishedAt + GESTURE_PUBLISH_INTERVAL_MS - Date.now()
      if (wait <= 0) queueFlush()
      else timer = setTimeout(flush, wait)
    },
    dispose() {
      disposed = true
      if (timer) clearTimeout(timer)
      timer = null
    },
  }
}

/** 根应用装配，页面不拥有公共工具桥和上下文通道。 */
export function useApplicationHost(uiReady: boolean): void {
  useEffect(() => attachOperationReviews(getApplicationHostService()), [])
  useEffect(() => {
    let disposed = false
    let detach: (() => void) | undefined
    void import('./localApplicationHost').then(({ attachLocalApplicationHost }) => {
      if (!disposed) detach = attachLocalApplicationHost(getApplicationHostService(), uiReady)
    }).catch(error => logger.error('初始化应用宿主失败', error, { event: 'application.host.initialize.failed' }))
    return () => { disposed = true; detach?.() }
  }, [uiReady])
  useEffect(() => {
    const disposeTracking = retainHostContextTracking()
    const scheduler = createHostContextPublishScheduler(() => {
      void getApplicationHostService().publishContext(createHostContextSnapshot(uiReady)).catch(error => {
        logger.error('发布应用上下文失败', error, { event: 'application.host.context.failed' })
      })
    }, () => useCanvasStore.getState().dragHistorySnapshot !== null)
    const unsubscribe = subscribeHostContext(scheduler.request)
    scheduler.request()
    return () => { scheduler.dispose(); unsubscribe(); disposeTracking() }
  }, [uiReady])
}
