import { useEffect, useRef } from 'react'

interface Options { enabled: boolean; edge: 'left' | 'right'; delayMs: number; dragDelayMs: number; open: boolean; onOpen: () => void }

export function useAssetEdgeTrigger({ enabled, edge, delayMs, dragDelayMs, open, onOpen }: Options): void {
  const timerRef = useRef<number | null>(null)
  const pointerBlockedUntilLeaveRef = useRef(false)
  useEffect(() => {
    if (!enabled || open) return
    const clear = (): void => { if (timerRef.current !== null) window.clearTimeout(timerRef.current); timerRef.current = null }
    const isPointerAtEdge = (clientX: number, threshold: number): boolean => (
      edge === 'left' ? clientX <= threshold : clientX >= window.innerWidth - threshold
    )
    const onPointerMove = (event: PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null
      const interacting = event.buttons !== 0 || Boolean(target?.closest('[data-window-nodrag],[data-dialog="true"],.react-flow__node,.react-flow__handle,.react-flow__selection,.react-flow__resize-control'))
      const atEdge = isPointerAtEdge(event.clientX, 4)
      if (!atEdge) {
        pointerBlockedUntilLeaveRef.current = false
        clear()
        return
      }
      if (pointerBlockedUntilLeaveRef.current || interacting || !document.hasFocus()) { clear(); return }
      if (timerRef.current === null) timerRef.current = window.setTimeout(() => { timerRef.current = null; onOpen() }, delayMs)
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (!isPointerAtEdge(event.clientX, 4)) return
      pointerBlockedUntilLeaveRef.current = true
      clear()
    }
    const onDragOver = (event: DragEvent): void => {
      const atEdge = isPointerAtEdge(event.clientX, 12)
      if (!atEdge) { clear(); return }
      if (timerRef.current === null) timerRef.current = window.setTimeout(() => { timerRef.current = null; onOpen() }, dragDelayMs)
    }
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', clear)
    window.addEventListener('blur', clear)
    return () => { clear(); window.removeEventListener('pointermove', onPointerMove); window.removeEventListener('pointerdown', onPointerDown); window.removeEventListener('dragover', onDragOver); window.removeEventListener('dragleave', clear); window.removeEventListener('blur', clear) }
  }, [delayMs, dragDelayMs, edge, enabled, onOpen, open])
}
