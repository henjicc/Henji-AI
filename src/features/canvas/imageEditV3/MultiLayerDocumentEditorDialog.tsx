import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiIconButton, UiModal } from '@/components/ui'
import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { createLogger } from '@/core/logging'
import {
  exportMultiLayerDocumentTargetToCanvas,
  openMultiLayerDocumentForEditing,
  registerMultiLayerDocumentExportSession,
} from '@/features/canvas/application/multiLayerDocumentNodeGenerationAdapter'
import { canvasEventBus } from '@/features/canvas/application/canvasServices'
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { isEditableLayerStackResultNode } from '@/features/canvas/domain/canvasNodeGuards'
import { parseMultiLayerDocumentNodeState } from '@/features/canvas/domain/multiLayerDocumentNode'
import { imageEditToolPlugin } from '@/features/canvas/tools/builtInTools'
import { useImageEditorInteractionStoreV3 } from '@/features/imageEdit/v3/store/imageEditorInteractionStoreV3'
import { useImageEditorSessionStoreV3 } from '@/features/imageEdit/v3/store/imageEditorSessionStoreV3'
import { useProjectStore } from '@/stores/projectStore'
import {
  CanvasEditToolEditorV3Host,
  type CanvasEditToolEditorV3Lifecycle,
} from './CanvasEditToolEditorV3Host'
import { resolveMultiLayerDocumentExportSelection } from './multiLayerDocumentExportSelection'

const logger = createLogger('features.canvas.multi_layer_document_editor')
const EMPTY_LAYER_IDS: readonly string[] = []

export interface MultiLayerDocumentEditorCloseResult {
  nodeId: string
  session: ImageEditSessionReferenceV3
}

export type MultiLayerDocumentEditorCloseContinuation = (
  result: MultiLayerDocumentEditorCloseResult,
) => Promise<void>

interface MultiLayerDocumentEditorDialogProps {
  isOpen: boolean
  node: CanvasNode
  onCloseReady?: MultiLayerDocumentEditorCloseContinuation
  onCloseApproved?: () => void
}

export function MultiLayerDocumentEditorDialog({
  isOpen,
  node,
  onCloseReady = async () => undefined,
  onCloseApproved,
}: MultiLayerDocumentEditorDialogProps): JSX.Element | null {
  const { t } = useTranslation()
  const lifecycleRef = useRef<CanvasEditToolEditorV3Lifecycle | null>(null)
  const closePromiseRef = useRef<Promise<void> | null>(null)
  const mountedRef = useRef(true)
  const [bootstrapKind, setBootstrapKind] = useState<'loading' | 'failed' | 'ready'>('loading')
  const [closing, setClosing] = useState(false)
  const [closeFailed, setCloseFailed] = useState(false)
  const [closeApproved, setCloseApproved] = useState(false)
  const [editorContext, setEditorContext] = useState<{
    sessionId: string
    document: ImageEditDocumentV3
  } | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportFailed, setExportFailed] = useState(false)
  const currentProjectId = useProjectStore((state) => state.currentProjectId)
  const selectedLayerIds = useImageEditorSessionStoreV3((state) => (
    editorContext ? state.sessions[editorContext.sessionId]?.selectedLayerIds ?? EMPTY_LAYER_IDS : EMPTY_LAYER_IDS
  ))
  const annotationSelection = useImageEditorInteractionStoreV3((state) => (
    editorContext ? state.annotationSelectionBySession[editorContext.sessionId] ?? null : null
  ))
  const exportSelection = useMemo(() => editorContext
    ? resolveMultiLayerDocumentExportSelection({
        document: editorContext.document,
        selectedLayerIds,
        annotationSelection,
      })
    : { ready: false as const, reason: '编辑器仍在准备，请稍候' }, [annotationSelection, editorContext, selectedLayerIds])

  const requestClose = useCallback((): Promise<void> => {
    if (closePromiseRef.current) return closePromiseRef.current
    const operation = (async () => {
      if (mountedRef.current) {
        setClosing(true)
        setCloseFailed(false)
      }
      logger.info('多图层图片文档编辑器开始关闭', {
        event: 'canvas.multi_layer_document_editor.close.start',
        context: { nodeId: node.id, bootstrapKind },
      })
      try {
        if (bootstrapKind === 'ready') {
          const lifecycle = lifecycleRef.current
          if (!lifecycle) throw new Error(t('toolDialog.imageEditorV3.stillOpening'))
          const session = await lifecycle.flushPending()
          await onCloseReady({ nodeId: node.id, session })
        }
        if (mountedRef.current) setCloseApproved(true)
        onCloseApproved?.()
        canvasEventBus.publish('tool-dialog/close', undefined)
        logger.info('多图层图片文档编辑器关闭完成', {
          event: 'canvas.multi_layer_document_editor.close.completed',
          context: { nodeId: node.id, bootstrapKind },
        })
      } catch (error) {
        if (mountedRef.current) {
          setClosing(false)
          setCloseFailed(true)
        }
        logger.error('多图层图片文档编辑器关闭失败', error, {
          event: 'canvas.multi_layer_document_editor.close.failed',
          context: {
            nodeId: node.id,
            bootstrapKind,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
        })
        throw error
      }
    })()
    closePromiseRef.current = operation.finally(() => {
      closePromiseRef.current = null
    })
    return closePromiseRef.current
  }, [bootstrapKind, node.id, onCloseApproved, onCloseReady, t])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  useEffect(() => registerApplicationCloseGuard(requestClose), [requestClose])

  useEffect(() => registerMultiLayerDocumentExportSession(node.id, async () => {
    const lifecycle = lifecycleRef.current
    if (!lifecycle) throw new Error(t('toolDialog.imageEditorV3.stillOpening'))
    return await lifecycle.flushPending()
  }), [node.id, t])

  useEffect(() => {
    if (isOpen) {
      setCloseApproved(false)
      return
    }
    if (!closeApproved) void requestClose().catch(() => undefined)
  }, [closeApproved, isOpen, requestClose])

  if (!isEditableLayerStackResultNode(node)) return null
  const documentState = parseMultiLayerDocumentNodeState(node.data)
  if (documentState.kind !== 'editable-v3') return null

  const requestCloseFromUi = (): void => {
    void requestClose().catch(() => undefined)
  }

  const exportToCanvas = (): void => {
    if (exporting || !exportSelection.ready || !currentProjectId) return
    setExporting(true)
    setExportFailed(false)
    void exportMultiLayerDocumentTargetToCanvas({
      projectRef: { kind: 'canvas.project', id: currentProjectId },
      sourceNodeRef: { kind: 'canvas.node', id: node.id },
      targetRef: exportSelection.targetRef,
    }).catch((error) => {
      setExportFailed(true)
      logger.error('多图层图片文档目标导出失败', error, {
        event: 'canvas.multi_layer_document_editor.export_target.failed',
        context: { nodeId: node.id, targetKind: exportSelection.targetRef.kind },
      })
    }).finally(() => setExporting(false))
  }

  const exportUnavailableReason = !currentProjectId
    ? '当前没有打开的画布项目'
    : exportSelection.ready ? undefined : exportSelection.reason
  const exportButton = (
    <UiButton
      variant="plain"
      size="sm"
      disabled={exporting || Boolean(exportUnavailableReason)}
      title={exportUnavailableReason ?? t('toolDialog.imageEditorV3.exportToCanvas')}
      onClick={exportToCanvas}
    >
      <Download className="h-4 w-4" />
      {exporting
        ? t('toolDialog.imageEditorV3.exportingToCanvas')
        : exportFailed
          ? t('toolDialog.imageEditorV3.exportToCanvasFailed')
          : t('toolDialog.imageEditorV3.exportToCanvas')}
    </UiButton>
  )

  return (
    <UiModal
      isOpen={isOpen || !closeApproved}
      title={t('toolDialog.imageEditorV3.documentTitle')}
      ariaLabel={t('toolDialog.imageEditorV3.documentTitle')}
      hideHeader={bootstrapKind === 'ready'}
      onClose={requestCloseFromUi}
      size="workspace"
      contentClassName="p-0"
    >
      <CanvasEditToolEditorV3Host
        key={`${node.id}:${documentState.session.documentRef}`}
        plugin={imageEditToolPlugin}
        options={{}}
        sourceImageUrl={documentState.imageUrl}
        onOptionsChange={() => undefined}
        beforePrepare={(signal) => openMultiLayerDocumentForEditing({
          nodeId: node.id,
          data: node.data,
          signal,
        })}
        onLifecycleChange={(lifecycle) => {
          lifecycleRef.current = lifecycle
        }}
        onBootstrapKindChange={setBootstrapKind}
        onEditorContextChange={setEditorContext}
        interactionDisabled={closing}
        toolbarLeading={(
          <UiIconButton
            className="h-8 w-8 shrink-0"
            showBorder={false}
            appearance="hover-only"
            aria-label={t('toolDialog.imageEditorV3.close')}
            title={t('toolDialog.imageEditorV3.close')}
            disabled={closing}
            onClick={requestCloseFromUi}
          >
            <X className="h-4 w-4" />
          </UiIconButton>
        )}
        toolbarActions={closing ? (
          <span role="status" className="text-xs text-text-muted">
            {t('toolDialog.imageEditorV3.closing')}
          </span>
        ) : (
          <>
            {exportButton}
            {closeFailed ? (
              <UiButton variant="plain" size="sm" onClick={requestCloseFromUi}>
                {t('toolDialog.imageEditorV3.closeFailedRetry')}
              </UiButton>
            ) : null}
          </>
        )}
      />
    </UiModal>
  )
}
