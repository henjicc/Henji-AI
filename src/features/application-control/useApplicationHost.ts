import { useEffect } from 'react'
import { getApplicationHostService } from '@/commands/applicationControl'
import { createLogger } from '@/core/logging'
import { createHostContextSnapshot, retainHostContextTracking, subscribeHostContext } from './hostContext/hostContext'

const logger = createLogger('features.application_control.host')

/** 根应用装配，页面不拥有公共工具桥和上下文通道。 */
export function useApplicationHost(uiReady: boolean): void {
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
    let queued = false
    let disposed = false
    const publish = (): void => {
      if (queued || disposed) return
      queued = true
      queueMicrotask(() => {
        queued = false
        if (disposed) return
        void getApplicationHostService().publishContext(createHostContextSnapshot(uiReady)).catch(error => {
          logger.error('发布应用上下文失败', error, { event: 'application.host.context.failed' })
        })
      })
    }
    const unsubscribe = subscribeHostContext(publish)
    publish()
    return () => { disposed = true; unsubscribe(); disposeTracking() }
  }, [uiReady])
}
