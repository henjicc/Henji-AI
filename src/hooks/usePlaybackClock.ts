import { useCallback, useEffect, useState, type RefObject } from 'react'
import { createStore, type StoreApi } from 'zustand/vanilla'
import { createRafScheduler } from '@/utils/createRafScheduler'

export type PlaybackClockStore = StoreApi<{ currentTime: number }>

/** 播放时钟是局部瞬态状态，父组件只生产，显示叶子用 useStore 自订阅。 */
export function usePlaybackClock(mediaRef: RefObject<HTMLMediaElement | null>, playing: boolean, source: string | null, enabled = true, initialTime = 0): { store: PlaybackClockStore; setTime: (time: number) => void } {
  const [store] = useState(() => createStore(() => ({ currentTime: initialTime })))
  const setTime = useCallback((currentTime: number): void => {
    if (store.getState().currentTime !== currentTime) store.setState({ currentTime })
  }, [store])
  useEffect(() => {
    if (!playing || !enabled) return
    const scheduler = createRafScheduler(() => {
      setTime(mediaRef.current?.currentTime ?? 0)
      scheduler.schedule()
    }, mediaRef.current?.ownerDocument.defaultView ?? window)
    scheduler.schedule()
    return scheduler.cancel
  }, [mediaRef, playing, source, enabled, setTime])
  return { store, setTime }
}
