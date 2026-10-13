import { useEffect, useMemo, useRef } from 'react'
import { createRafScheduler, type RafOwner, type RafScheduler } from '@/utils/createRafScheduler'

/** 稳定调度接口，读取最新回调；卸载或切换宿主时取消旧窗口的待执行帧。 */
export function useRafCallback<Args extends unknown[]>(callback: (...args: Args) => void, ownerWindow?: RafOwner | null): RafScheduler<Args> {
  const callbackRef = useRef(callback)
  callbackRef.current = callback
  const scheduler = useMemo(() => createRafScheduler<Args>((...args) => callbackRef.current(...args), ownerWindow ?? window), [ownerWindow])
  useEffect(() => () => scheduler.cancel(), [scheduler])
  return scheduler
}
