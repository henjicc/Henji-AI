import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { UiButton, UiError, UiLoading } from '@/components/ui'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type {
  ImageEditDocumentReferenceV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts'
import { createLogger } from '@/core/logging'
import {
  createImageEditorV3ResourceByteSizes,
  reconcileImageEditorV3ResourceDescriptors,
} from '@/features/imageEdit/v3/application/imageEditorResourceDescriptorsV3'
import { ImageEditorV3 } from '@/features/imageEdit/v3/editor'
import {
  ImageMarkV3PersistenceQueue,
  type ImageMarkV3PersistenceStatus,
} from '@/features/imageMark/standalone/imageMarkV3Persistence'
import type { VisualToolEditorProps } from '../ui/tool-editors/types'
import {
  CANVAS_EDIT_V3_SESSION_OPTION,
  createCanvasEditV3Repository,
  createCanvasEditV3SessionReference,
  prepareCanvasEditV3Session,
  serializeCanvasEditV3SessionReference,
  type CanvasEditV3PreparedSession,
} from './canvasEditV3Session'

const logger = createLogger('features.canvas.image_edit_v3.host')
const AUTOSAVE_DELAY_MS = 500

type BootstrapState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | {
      kind: 'ready'
      document: ImageEditDocumentV3
      history: CanvasEditV3PreparedSession['history']
      resourceByteSizes: Readonly<Record<string, number>>
      resourceDescriptors: CanvasEditV3PreparedSession['resourceDescriptors']
    }

export function CanvasEditToolEditorV3Host({
  options,
  onOptionsChange,
  onExecutionReadyChange,
  sourceImageUrl,
}: VisualToolEditorProps): JSX.Element {
  const { t } = useTranslation()
  const repository = useMemo(createCanvasEditV3Repository, [])
  const initialOptionsRef = useRef<DynamicValueMap>(options)
  const onOptionsChangeRef = useRef(onOptionsChange)
  const onExecutionReadyChangeRef = useRef(onExecutionReadyChange)
  onOptionsChangeRef.current = onOptionsChange
  onExecutionReadyChangeRef.current = onExecutionReadyChange
  const [bootstrap, setBootstrap] = useState<BootstrapState>({ kind: 'loading' })
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const mountedRef = useRef(true)
  const persistenceRef = useRef<ImageMarkV3PersistenceQueue | null>(null)
  const persistenceSnapshotRef = useRef<ImageEditPersistenceSnapshotV3 | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const publishReference = useCallback((reference: ImageEditDocumentReferenceV3): void => {
    onOptionsChangeRef.current({
      [CANVAS_EDIT_V3_SESSION_OPTION]: serializeCanvasEditV3SessionReference(
        createCanvasEditV3SessionReference(sourceImageUrl, reference),
      ),
    })
  }, [sourceImageUrl])

  const isCurrentReference = useCallback((reference: ImageEditDocumentReferenceV3): boolean => {
    const current = persistenceSnapshotRef.current
    return Boolean(
      current
      && current.document.id === reference.documentId
      && current.document.revision === reference.revision,
    )
  }, [])

  const reportPersistenceStatus = useCallback((status: ImageMarkV3PersistenceStatus): void => {
    if (!mountedRef.current) return
    if (status.kind === 'saving') {
      setSaving(true)
      setSaveFailed(false)
      onExecutionReadyChangeRef.current?.(false)
      logger.debug('画布图片编辑文档开始保存', {
        event: 'canvas.image_edit_v3.persistence.start',
        context: { documentId: status.reference.documentId },
      })
      return
    }
    setSaving(false)
    if (status.kind === 'idle') {
      setSaveFailed(false)
      if (!isCurrentReference(status.reference)) {
        onExecutionReadyChangeRef.current?.(false)
        return
      }
      publishReference(status.reference)
      onExecutionReadyChangeRef.current?.(true)
      logger.info('画布图片编辑文档保存完成', {
        event: 'canvas.image_edit_v3.persistence.completed',
        context: {
          documentId: status.reference.documentId,
          revision: status.reference.revision,
        },
      })
      return
    }
    setSaveFailed(true)
    onExecutionReadyChangeRef.current?.(false)
    logger.error('画布图片编辑文档保存失败', status.error, {
      event: 'canvas.image_edit_v3.persistence.failed',
      context: {
        documentId: status.reference.documentId,
        errorName: status.error instanceof Error ? status.error.name : 'UnknownError',
      },
    })
  }, [isCurrentReference, publishReference])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      onExecutionReadyChangeRef.current?.(false)
    }
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setBootstrap({ kind: 'loading' })
    setSaving(false)
    setSaveFailed(false)
    persistenceRef.current = null
    persistenceSnapshotRef.current = null
    onExecutionReadyChangeRef.current?.(false)
    logger.info('画布图片编辑 V3 会话开始准备', {
      event: 'canvas.image_edit_v3.bootstrap.start',
    })
    void prepareCanvasEditV3Session({
      sourceImageUrl,
      toolOptions: initialOptionsRef.current,
      repository,
      signal: controller.signal,
    }).then((prepared) => {
      if (!active) return
      persistenceSnapshotRef.current = prepared.persistence
      persistenceRef.current = new ImageMarkV3PersistenceQueue({
        repository,
        initialReference: prepared.reference,
        initialHistory: prepared.history,
        onStatusChange: reportPersistenceStatus,
      })
      setBootstrap({
        kind: 'ready',
        document: prepared.document,
        history: prepared.history,
        resourceByteSizes: prepared.resourceByteSizes,
        resourceDescriptors: prepared.resourceDescriptors,
      })
      publishReference(prepared.reference)
      onExecutionReadyChangeRef.current?.(true)
      logger.info('画布图片编辑 V3 会话准备完成', {
        event: 'canvas.image_edit_v3.bootstrap.completed',
        context: {
          documentId: prepared.reference.documentId,
          revision: prepared.reference.revision,
        },
      })
    }).catch((error: unknown) => {
      if (!active || controller.signal.aborted) return
      setBootstrap({ kind: 'failed' })
      onExecutionReadyChangeRef.current?.(false)
      logger.error('画布图片编辑 V3 会话准备失败', error, {
        event: 'canvas.image_edit_v3.bootstrap.failed',
        context: { errorName: error instanceof Error ? error.name : 'UnknownError' },
      })
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [bootstrapAttempt, publishReference, reportPersistenceStatus, repository, sourceImageUrl])

  const flushPending = useCallback(async (): Promise<ImageEditDocumentReferenceV3> => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    const queue = persistenceRef.current
    const snapshot = persistenceSnapshotRef.current
    if (!queue || !snapshot) throw new Error('画布图片编辑文档尚未准备完成')
    queue.enqueue(snapshot)
    return queue.flush()
  }, [])

  useEffect(() => () => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
  }, [])

  const handleDocumentChange = useCallback((document: ImageEditDocumentV3): void => {
    setBootstrap((current) => current.kind === 'ready'
      ? { ...current, document }
      : current)
  }, [])

  const handlePersistenceChange = useCallback((snapshot: ImageEditPersistenceSnapshotV3): void => {
    persistenceSnapshotRef.current = snapshot
    setBootstrap((current) => {
      if (current.kind !== 'ready') return current
      const resourceDescriptors = reconcileImageEditorV3ResourceDescriptors(
        snapshot.document,
        current.resourceDescriptors,
        snapshot.retainedResources,
      )
      return {
        ...current,
        document: snapshot.document,
        history: snapshot.history,
        resourceByteSizes: createImageEditorV3ResourceByteSizes(resourceDescriptors),
        resourceDescriptors,
      }
    })
    onExecutionReadyChangeRef.current?.(false)
    setSaveFailed(false)
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      void flushPending().catch(() => undefined)
    }, AUTOSAVE_DELAY_MS)
  }, [flushPending])

  if (bootstrap.kind === 'loading') {
    return (
      <UiLoading
        className="h-[min(76vh,900px)]"
        message={t('toolDialog.imageEditorV3.loading')}
      />
    )
  }
  if (bootstrap.kind === 'failed') {
    return (
      <UiError
        className="h-[min(76vh,900px)]"
        title={t('toolDialog.imageEditorV3.openFailed')}
        message={t('toolDialog.imageEditorV3.openFailedDescription')}
        onRetry={() => setBootstrapAttempt((value) => value + 1)}
      />
    )
  }

  return (
    <ImageEditorV3
      sourceImageUrl={sourceImageUrl}
      document={bootstrap.document}
      historySnapshot={bootstrap.history}
      resourceByteSizes={bootstrap.resourceByteSizes}
      resourceDescriptors={bootstrap.resourceDescriptors}
      profileId="canvas-edit"
      onDocumentChange={handleDocumentChange}
      onPersistenceChange={handlePersistenceChange}
      toolbarActions={saving || saveFailed ? (
        saveFailed ? (
          <UiButton
            variant="plain"
            size="sm"
            onClick={() => { void flushPending().catch(() => undefined) }}
          >
            {t('toolDialog.imageEditorV3.retrySave')}
          </UiButton>
        ) : (
          <span role="status" className="text-xs text-text-muted">
            {t('toolDialog.imageEditorV3.saving')}
          </span>
        )
      ) : null}
      className="h-[min(76vh,900px)]"
    />
  )
}
