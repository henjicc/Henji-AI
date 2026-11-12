import { useCallback, useEffect, useRef } from 'react'
import { beginAudioEditGesture } from '../application/audioEditProjectInstances'

type GestureHandle = ReturnType<typeof beginAudioEditGesture>

/**
 * 组件里开始连续拖动的唯一入口：记下没结束的拖动，组件卸载（面板收起、换作品）时取消它们，
 * 实例不会一直停在“拖动中”（只做部分校验、不保存）的状态。
 */
export function useAudioEditGestures(projectId: string): () => GestureHandle {
  const open = useRef(new Set<GestureHandle>())
  useEffect(() => {
    const handles = open.current
    return () => {
      for (const handle of [...handles]) handle.cancel()
      handles.clear()
    }
  }, [projectId])
  return useCallback(() => {
    const handle = beginAudioEditGesture(projectId)
    const tracked: GestureHandle = {
      finish: () => { open.current.delete(tracked); handle.finish() },
      cancel: () => { open.current.delete(tracked); handle.cancel() },
    }
    open.current.add(tracked)
    return tracked
  }, [projectId])
}
