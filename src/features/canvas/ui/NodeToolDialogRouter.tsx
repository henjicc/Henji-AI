import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { UI_DIALOG_TRANSITION_MS } from '@/components/ui/motion'
import { createMultiLayerDocumentPersistenceConfirmation } from '@/features/canvas/application/multiLayerDocumentPersistenceConfirmation'
import { retainMultiLayerDocumentReferences } from '@/features/canvas/application/multiLayerDocumentLifecycleService'
import { isEditableLayerStackResultNode } from '@/features/canvas/domain/canvasNodeGuards'
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes'
import type { LayerStackResultNodeData } from '@/features/canvas/domain/canvasNodeData'
import {
  MultiLayerDocumentEditorDialog,
  type MultiLayerDocumentEditorCloseResult,
} from '@/features/canvas/imageEditV3/MultiLayerDocumentEditorDialog'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { NodeToolDialog } from './NodeToolDialog'

interface DisplayDocumentContext {
  projectId: string
  node: CanvasNode
  data: LayerStackResultNodeData
}

export function NodeToolDialogRouter(): JSX.Element {
  const activeToolDialog = useCanvasStore((state) => state.activeToolDialog)
  const currentProjectId = useProjectStore((state) => state.currentProjectId)
  const activeNode = useCanvasStore((state) => (
    activeToolDialog
      ? state.nodes.find((node) => node.id === activeToolDialog.nodeId) ?? null
      : null
  ))
  const activeDocumentNode = activeToolDialog?.toolType === 'edit'
    && isEditableLayerStackResultNode(activeNode)
    ? activeNode
    : null
  const activeDocumentContext = useMemo(() => (
    activeDocumentNode && currentProjectId
      ? { projectId: currentProjectId, node: activeDocumentNode, data: activeDocumentNode.data }
      : null
  ), [activeDocumentNode, currentProjectId])
  const [displayDocumentContext, setDisplayDocumentContext] = useState<DisplayDocumentContext | null>(
    activeDocumentContext,
  )
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (activeDocumentContext) {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
      setDisplayDocumentContext((current) => current ?? activeDocumentContext)
    }
  }, [activeDocumentContext])

  useEffect(() => () => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
  }, [])

  useEffect(() => {
    if (!displayDocumentContext?.data.imageEditSession) return undefined
    return retainMultiLayerDocumentReferences([
      displayDocumentContext.data.imageEditSession.documentRef,
    ])
  }, [displayDocumentContext])

  const handleDocumentDialogClosed = useCallback((): void => {
    if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    clearTimerRef.current = setTimeout(() => {
      clearTimerRef.current = null
      setDisplayDocumentContext(null)
    }, UI_DIALOG_TRANSITION_MS)
  }, [])

  const documentConfirmation = useMemo(() => displayDocumentContext?.data.imageEditSession
    ? createMultiLayerDocumentPersistenceConfirmation({ projectId: displayDocumentContext.projectId,
        nodeId: displayDocumentContext.node.id, documentRef: displayDocumentContext.data.imageEditSession.documentRef })
    : null, [displayDocumentContext])

  const handleDocumentCloseReady = useCallback(async (
    result: MultiLayerDocumentEditorCloseResult,
  ) => {
    const context = displayDocumentContext
    if (!context || context.node.id !== result.nodeId) {
      throw new Error('多图层文档关闭上下文已失效')
    }
    if (!documentConfirmation) throw new Error('图片文档保存宿主尚未就绪')
    return documentConfirmation.confirm(result.session)
  }, [displayDocumentContext, documentConfirmation])

  return (
    <>
      {!displayDocumentContext && <NodeToolDialog />}
      {displayDocumentContext && (
        <MultiLayerDocumentEditorDialog
          isOpen={Boolean(activeDocumentNode)}
          node={displayDocumentContext.node}
          onCloseReady={handleDocumentCloseReady}
          persistenceProjection={documentConfirmation?.projection}
          onCloseApproved={handleDocumentDialogClosed}
        />
      )}
    </>
  )
}
