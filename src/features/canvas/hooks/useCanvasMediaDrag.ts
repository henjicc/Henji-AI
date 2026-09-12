import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react'
import { useDragDrop } from '@/contexts/DragDropContext'
import { useCanvasStore } from '@/stores/canvasStore'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { getCanvasMediaTransfers } from '../application/canvasMediaTransfer'

const INTERACTIVE = 'button,input,textarea,select,[contenteditable="true"],[role="button"],[role="slider"],.react-flow__handle,.nodrag'

/** 在 ReactFlow 收到按下事件前接管 Shift 素材拖动，复用应用内部拖放会话。 */
export function useCanvasMediaDrag() {
  const { startDrag, endDrag } = useDragDrop()
  const cleanupRef = useRef<(() => void) | null>(null)
  useEffect(() => () => cleanupRef.current?.(), [])

  return useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target
    if (!(target instanceof Element) || target.closest(INTERACTIVE)) return
    const nodeId = target.closest('.react-flow__node')?.getAttribute('data-id')
    const nodes = useCanvasStore.getState().nodes
    const node = nodes.find(item => item.id === nodeId)
    if (!node) return
    const media = getCanvasMediaTransfers(node, nodes)
    const element = target.closest('img,video,audio')
    const src = element?.getAttribute('src')
    const item = media.length === 1 ? media[0] : media.find(entry => src && (
      resolveImageDisplayUrl(entry.data.imageUrl) === src
      || (entry.data.thumbnailUrl && resolveImageDisplayUrl(entry.data.thumbnailUrl) === src)
    ))
    if (!item) return
    event.preventDefault()
    event.stopPropagation()
    cleanupRef.current?.()
    const origin = { x: event.clientX, y: event.clientY }
    let started = false
    let releaseTimer: ReturnType<typeof setTimeout> | undefined
    const cleanup = () => {
      clearTimeout(releaseTimer)
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', release, true)
      window.removeEventListener('blur', cleanup)
      window.removeEventListener('keydown', keydown)
      if (started) endDrag()
      cleanupRef.current = null
    }
    // 放置区会阻止冒泡；捕获释放并等它消费完会话后再清理。
    const release = () => { releaseTimer = setTimeout(cleanup, 0) }
    const move = (next: MouseEvent) => {
      if (!(next.buttons & 1)) { cleanup(); return }
      if (started || Math.hypot(next.clientX - origin.x, next.clientY - origin.y) < 5) return
      started = true
      const preview = item.data.thumbnailUrl || (item.data.type === 'image' ? item.data.imageUrl : '')
      startDrag(item.data, preview ? resolveImageDisplayUrl(preview) : '')
    }
    const keydown = (next: KeyboardEvent) => { if (next.key === 'Escape') cleanup() }
    cleanupRef.current = cleanup
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', release, true)
    window.addEventListener('blur', cleanup)
    window.addEventListener('keydown', keydown)
  }, [startDrag, endDrag])
}
