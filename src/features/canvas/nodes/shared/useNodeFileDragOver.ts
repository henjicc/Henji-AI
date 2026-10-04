import { useCallback, useRef, useState, type DragEvent } from 'react'

/**
 * 上传类节点的“文件拖到上面”状态（任务 5.8，N03.2）：原来拖着文件经过上传节点没有任何反馈，
 * 看不出松手会不会被接住。只认带文件的拖动；子元素间移动用计数抵消，松手或离开即复位。
 */
export function useNodeFileDragOver(enabled = true): {
  isDragOver: boolean
  dragOverProps: {
    onDragEnter: (event: DragEvent) => void
    onDragLeave: (event: DragEvent) => void
  }
  resetDragOver: () => void
} {
  const [isDragOver, setIsDragOver] = useState(false)
  const depth = useRef(0)
  const carriesFiles = (event: DragEvent): boolean => Array.from(event.dataTransfer?.types ?? []).includes('Files')
  const resetDragOver = useCallback(() => {
    depth.current = 0
    setIsDragOver(false)
  }, [])
  const onDragEnter = useCallback((event: DragEvent) => {
    if (!enabled || !carriesFiles(event)) return
    depth.current += 1
    setIsDragOver(true)
  }, [enabled])
  const onDragLeave = useCallback((event: DragEvent) => {
    if (!enabled || !carriesFiles(event)) return
    depth.current = Math.max(0, depth.current - 1)
    if (depth.current === 0) setIsDragOver(false)
  }, [enabled])
  return { isDragOver, dragOverProps: { onDragEnter, onDragLeave }, resetDragOver }
}
