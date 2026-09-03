import { useCallback, useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiIconButton, UiModal } from '@/components/ui'
import { registerApplicationCloseGuard } from '@/core/applicationLifecycle/applicationCloseGuards'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import { createLogger } from '@/core/logging'
import { openMultiLayerDocumentForEditing } from '@/features/canvas/application/multiLayerDocumentNodeGenerationAdapter'
import { canvasEventBus } from '@/features/canvas/application/canvasServices'
import type { CanvasNode } from '@/features/canvas/domain/canvasNodes'
import { isEditableLayerStackResultNode } from '@/features/canvas/domain/canvasNodeGuards'
import { parseMultiLayerDocumentNodeState } from '@/features/canvas/domain/multiLayerDocumentNode'
import { imageEditToolPlugin } from '@/features/canvas/tools/builtInTools'
import {
  CanvasEditToolEditorV3Host,
  type CanvasEditToolEditorV3Lifecycle,
} from './CanvasEditToolEditorV3Host'

const logger = createLogger('features.canvas.multi_layer_document_editor')

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
        ) : closeFailed ? (
          <UiButton variant="plain" size="sm" onClick={requestCloseFromUi}>
            {t('toolDialog.imageEditorV3.closeFailedRetry')}
          </UiButton>
        ) : null}
      />
    </UiModal>
  )
}
