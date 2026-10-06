import { useEffect, useRef } from 'react'
import { updateVideoEditClipProperties, type VideoEditClipPropertyPatch } from '../application/videoEditClipProperties'
import { beginVideoEditGesture, finishVideoEditGesture, type VideoEditGesture } from '../application/videoEditService'

/**
 * 效果控件里片段固有属性的编辑会话：拖动数值、连续输入文字时实时预览，结束时只记一步撤销；
 * Esc / 指针被取消时整段回到开始前的值。没有进行中的会话时，`commit` 就是一次独立的编辑。
 * 目标片段变化或面板卸载时放弃未完成的会话（服务层切换选区时也会放弃）。
 */
export function useVideoEditClipPropertyGesture(projectId: string, sequenceId: string, clipId: string, onError: (reason: unknown) => void) {
  const handle = useRef<VideoEditGesture>()
  const errorHandler = useRef(onError); errorHandler.current = onError
  useEffect(() => () => {
    const previous = handle.current; handle.current = undefined
    if (previous) finishVideoEditGesture(previous, false)
  }, [projectId, sequenceId, clipId])

  const end = (commit: boolean): void => {
    const previous = handle.current; handle.current = undefined
    if (!previous) return
    try { finishVideoEditGesture(previous, commit) } catch (error) {
      finishVideoEditGesture(previous, false)
      errorHandler.current(error)
    }
  }
  const begin = (): void => {
    if (handle.current) return
    try { handle.current = beginVideoEditGesture(projectId) } catch (error) { errorHandler.current(error) }
  }
  const commit = (patch: VideoEditClipPropertyPatch): void => {
    try { updateVideoEditClipProperties(projectId, sequenceId, clipId, patch, handle.current) } catch (error) {
      if (handle.current) end(false)
      errorHandler.current(error)
    }
  }
  return { begin, commit, finish: () => end(true), cancel: () => end(false), active: () => handle.current !== undefined }
}
