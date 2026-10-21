import { useEffect, useRef } from 'react'
import type { VideoEditBuiltinEffectChanges } from '../application/videoEditCompositing'
import { beginVideoEditGesture, finishVideoEditGesture, type VideoEditGesture } from '../application/videoEditService'

/**
 * 内置参数（效果或过渡）的一次编辑会话：拖动数值、拖动取色时实时预览，结束时只记一步撤销；Esc / 指针被取消时回到开始前。
 * 没有进行中的会话时，`commit` 就是一次独立的编辑（输入回车、步进、选项、开关、重置）。`apply` 带手势时只预览。
 * `scope` 变了（换了片段、效果或过渡）时撤回进行中的会话。
 * 会话中的连续写入按显示帧合并：一帧最多改一次文档、渲染一次画面；结束时先落下最后一次写入再提交。
 */
export function useVideoEditBuiltinParamGesture(projectId: string, scope: string, apply: (changes: VideoEditBuiltinEffectChanges, gesture?: VideoEditGesture) => void, onError: (reason: unknown) => void) {
  const handle = useRef<VideoEditGesture>()
  const pending = useRef<{ changes: VideoEditBuiltinEffectChanges; frame: number }>()
  const errorHandler = useRef(onError); errorHandler.current = onError
  const applier = useRef(apply); applier.current = apply
  const drop = (): void => { if (pending.current) cancelAnimationFrame(pending.current.frame); pending.current = undefined }
  const run = (changes: VideoEditBuiltinEffectChanges, gesture?: VideoEditGesture): boolean => {
    try { applier.current(changes, gesture); return true } catch (error) {
      if (handle.current) end(false)
      errorHandler.current(error)
      return false
    }
  }
  const flush = (): boolean => {
    const queued = pending.current; drop()
    return !queued || !handle.current || run(queued.changes, handle.current)
  }
  useEffect(() => () => {
    drop()
    const previous = handle.current; handle.current = undefined
    if (previous) finishVideoEditGesture(previous, false)
  }, [projectId, scope])
  const end = (commit: boolean): void => {
    if (commit) { if (!flush()) return } else drop()
    const previous = handle.current; handle.current = undefined
    if (!previous) return
    try { finishVideoEditGesture(previous, commit) } catch (error) { finishVideoEditGesture(previous, false); errorHandler.current(error) }
  }
  const begin = (): void => {
    if (handle.current) return
    try { handle.current = beginVideoEditGesture(projectId) } catch (error) { errorHandler.current(error) }
  }
  const commit = (changes: VideoEditBuiltinEffectChanges): void => {
    if (!handle.current) { run(changes); return }
    const queued = pending.current
    const merged = queued ? { ...queued.changes, ...changes, ...(queued.changes.params || changes.params ? { params: { ...queued.changes.params, ...changes.params } } : {}) } : changes
    pending.current = { changes: merged, frame: queued?.frame ?? requestAnimationFrame(() => { flush() }) }
  }
  return { identity: JSON.stringify([projectId, scope]), begin, commit, finish: () => end(true), cancel: () => end(false), active: () => handle.current !== undefined }
}
export type VideoEditBuiltinParamGesture = ReturnType<typeof useVideoEditBuiltinParamGesture>
