import { useCallback, useEffect, useRef, useState } from 'react'

import { UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion'
import { isEditableLayerStackResultNode } from '@/features/canvas/domain/canvasNodeGuards'
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { MultiLayerDocumentEditorDialog } from '@/features/canvas/imageEditV3/MultiLayerDocumentEditorDialog'
import { useCanvasStore } from '@/stores/canvasStore'
import { NodeToolDialog } from './NodeToolDialog'

export function NodeToolDialogRouter(): JSX.Element {
  const activeToolDialog = useCanvasStore((state) => state.activeToolDialog)
  const activeNode = useCanvasStore((state) => (
    activeToolDialog
      ? state.nodes.find((node) => node.id === activeToolDialog.nodeId) ?? null
      : null
  ))
  const activeDocumentNode = activeToolDialog?.toolType === 'edit'
    && isEditableLayerStackResultNode(activeNode)
    ? activeNode
    : null
  const [displayDocumentNode, setDisplayDocumentNode] = useState<CanvasNode | null>(activeDocumentNode)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (activeDocumentNode) {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
      setDisplayDocumentNode(activeDocumentNode)
    }
  }, [activeDocumentNode])

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
  }, [])

  const handleDocumentDialogClosed = useCallback((): void => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    clearTimerRef.current = setTimeout(() => {
      clearTimerRef.current = null
      setDisplayDocumentNode(null)
    }, UI_DIALOG_TRANSITION_MS)
  }, [])

  return (
    <>
      {!displayDocumentNode && <NodeToolDialog />}
      {displayDocumentNode && (
        <MultiLayerDocumentEditorDialog
          isOpen={Boolean(activeDocumentNode)}
          node={displayDocumentNode}
          onCloseApproved={handleDocumentDialogClosed}
        />
      )}
    </>
  )
}
