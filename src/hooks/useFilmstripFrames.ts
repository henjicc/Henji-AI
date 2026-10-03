import { useEffect, useRef, useSyncExternalStore } from 'react'
import {
  acquireFilmstripFrames, filmstripFrameKey, filmstripFramesRevision, subscribeFilmstripFrames,
  type FilmstripFrameRef,
} from '@/services/videoFilmstrip/filmstripFrameService'

export type { FilmstripFrameRef }

/** 缩略帧就绪状态的版本号：读取 `readFilmstripFrame` / `nearestFilmstripFrame` 的组件订阅它。 */
export function useFilmstripFramesRevision(): number {
  return useSyncExternalStore(subscribeFilmstripFrames, filmstripFramesRevision, filmstripFramesRevision)
}

/**
 * 声明正在显示的一组缩略帧（任务 2.4）。滚动、缩放时帧集合每帧都在变：首次立即请求，之后等集合稳定
 * `settleMs` 再换一批，期间旧的一批继续持有（不取消、不重发）；换批时先持有新的再释放旧的，两批共有的帧不中断。
 * 首格（`index === 0` 的 ref 由调用方标为 first）优先。
 */
export function useFilmstripFrames(refs: readonly FilmstripFrameRef[], firstKeys: ReadonlySet<string>, enabled: boolean, settleMs = 80): void {
  const signature = enabled ? refs.map(filmstripFrameKey).join('\n') : ''
  const latest = useRef({ refs, firstKeys })
  latest.current = { refs, firstKeys }
  const held = useRef<{ signature: string; release: () => void } | null>(null)
  useEffect(() => {
    if (held.current?.signature === signature) return
    const swap = (): void => {
      const { refs: current, firstKeys: first } = latest.current
      const release = signature ? acquireFilmstripFrames(current, ref => first.has(filmstripFrameKey(ref)) ? 'first' : 'normal') : () => undefined
      held.current?.release()
      held.current = { signature, release }
    }
    if (!held.current) { swap(); return }
    const timer = setTimeout(swap, settleMs)
    return () => clearTimeout(timer)
  }, [signature, settleMs])
  useEffect(() => () => { held.current?.release(); held.current = null }, [])
}
