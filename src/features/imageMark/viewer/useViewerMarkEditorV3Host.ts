import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  createImageEditorV3RequestId,
  loadImageEditorV3Document,
} from '@/commands/imageEditorV3'
import {
  isImageEditSessionReferenceV3,
  type ImageEditSessionData,
  type ImageEditSessionReferenceV3,
  type ImageMarkSession,
} from '@/core/imageEdit'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type {
  ImageEditDocumentReferenceV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts'
import { createLogger } from '@/core/logging'
import { useNotification } from '@/contexts/NotificationContext'
import {
  ImageEditorReadinessErrorV3,
  type ImageEditorCapabilityReadinessV3,
} from '@/features/imageEdit/v3/application/imageEditorHostProfiles'
import { reconcileImageEditorV3ResourceDescriptors } from '@/features/imageEdit/v3/application/imageEditorResourceDescriptorsV3'
import { resolveImageEditorReadinessReasonV3 } from '@/features/imageEdit/v3/editor/readinessPresentationV3'
import type { ImageEditorV3DocumentRef } from '@/platform/contracts/imageEditorV3'
import {
  ImageMarkV3PersistenceQueue,
  type ImageMarkV3PersistenceStatus,
} from '../standalone/imageMarkV3Persistence'
import {
  createViewerMarkEditorV3Repository,
  createViewerMarkEditorV3SessionReference,
  prepareViewerMarkEditorV3Session,
  ViewerMarkEditorV3SessionError,
  type ViewerMarkEditorV3SessionErrorKey,
  type ViewerMarkEditorV3PreparedSession,
} from './viewerMarkEditorV3Session'
import {
  isViewerMarkV3MaterializationAbort,
  materializeViewerMarkV3Raster,
  resolveViewerMarkV3MaterializationReadiness,
} from './viewerMarkEditorV3Materialization'

const logger = createLogger('features.imageMark.viewer_v3_host')
const AUTOSAVE_DELAY_MS = 500

export interface ViewerMarkEditorV3HostProps {
  imageUrl: string
  session?: ImageEditSessionData | ImageMarkSession
  onClose: () => void
  onSave: (mediaUrl: string, session: ImageEditSessionReferenceV3) => void
  onSessionChange?: (session: ImageEditSessionReferenceV3) => void
}

export interface ViewerMarkV3MaterializationState {
  completed: number
  total: number
  cancelling: boolean
}

export type ViewerMarkEditorV3BootstrapState =
  | { kind: 'loading' }
  | {
      kind: 'failed'
      readiness?: ImageEditorCapabilityReadinessV3
      messageKey?: ViewerMarkEditorV3SessionErrorKey
      message?: string
    }
  | {
      kind: 'ready'
      sourceUrl: string
      document: ImageEditDocumentV3
      history: ViewerMarkEditorV3PreparedSession['history']
      resourceDescriptors: ViewerMarkEditorV3PreparedSession['resourceDescriptors']
    }

export interface ViewerMarkEditorV3HostController {
  bootstrap: ViewerMarkEditorV3BootstrapState
  persistenceStatus: ImageMarkV3PersistenceStatus | null
  materialization: ViewerMarkV3MaterializationState | null
  busy: boolean
  outputReadiness: ImageEditorCapabilityReadinessV3
  retryBootstrap: () => void
  handleDocumentChange: (document: ImageEditDocumentV3) => void
  handlePersistenceChange: (snapshot: ImageEditPersistenceSnapshotV3) => void
  materialize: () => Promise<void>
  cancelMaterialization: () => void
  finish: () => Promise<void>
}

function toDocumentRef(documentId: string): ImageEditorV3DocumentRef {
  return `image-edit-v3:${documentId}` as ImageEditorV3DocumentRef
}

export function useViewerMarkEditorV3Host(
  props: ViewerMarkEditorV3HostProps,
): ViewerMarkEditorV3HostController {
  const { imageUrl, onClose } = props
  const { t } = useTranslation('ui')
  const { showNotification } = useNotification()
  const repository = useMemo(createViewerMarkEditorV3Repository, [])
  const initialSessionRef = useRef(props.session)
  const onSessionChangeRef = useRef(props.onSessionChange)
  const onSaveRef = useRef(props.onSave)
  onSessionChangeRef.current = props.onSessionChange
  onSaveRef.current = props.onSave
  const [bootstrap, setBootstrap] = useState<ViewerMarkEditorV3BootstrapState>({ kind: 'loading' })
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
  const [persistenceStatus, setPersistenceStatus] = useState<ImageMarkV3PersistenceStatus | null>(null)
  const [materialization, setMaterialization] = useState<ViewerMarkV3MaterializationState | null>(null)
  const [busy, setBusy] = useState(false)
  const mountedRef = useRef(true)
  const documentIdRef = useRef(createImageEditIdV3('viewer-document'))
  const sourceUrlRef = useRef(imageUrl)
  const persistenceSnapshotRef = useRef<ImageEditPersistenceSnapshotV3 | null>(null)
  const persistenceRef = useRef<ImageMarkV3PersistenceQueue | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const materializationAbortRef = useRef<AbortController | null>(null)

  const publishReference = useCallback((reference: ImageEditDocumentReferenceV3): void => {
    onSessionChangeRef.current?.(createViewerMarkEditorV3SessionReference(
      sourceUrlRef.current,
      reference,
    ))
  }, [])

  const reportPersistenceStatus = useCallback((status: ImageMarkV3PersistenceStatus): void => {
    if (!mountedRef.current) return
    setPersistenceStatus(status)
    if (status.kind === 'saving') {
      logger.debug('快速编辑文档开始保存', {
        event: 'image_editor_v3.viewer.persistence.start',
        context: { documentId: status.reference.documentId },
      })
      return
    }
    if (status.kind === 'idle') {
      publishReference(status.reference)
      logger.info('快速编辑文档保存完成', {
        event: 'image_editor_v3.viewer.persistence.completed',
        context: {
          documentId: status.reference.documentId,
          revision: status.reference.revision,
        },
      })
      return
    }
    logger.error('快速编辑文档保存失败', {
      event: 'image_editor_v3.viewer.persistence.failed',
      context: {
        documentId: status.reference.documentId,
        errorName: status.error instanceof Error ? status.error.name : 'UnknownError',
      },
    })
  }, [publishReference])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      materializationAbortRef.current?.abort()
    }
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setBootstrap({ kind: 'loading' })
    setPersistenceStatus(null)
    persistenceRef.current = null
    persistenceSnapshotRef.current = null
    logger.info('查看器快速编辑 V3 会话开始准备', {
      event: 'image_editor_v3.viewer.bootstrap.start',
      context: { hasManagedSession: isImageEditSessionReferenceV3(initialSessionRef.current) },
    })
    void prepareViewerMarkEditorV3Session({
      imageUrl,
      session: initialSessionRef.current,
      documentId: documentIdRef.current,
      repository,
      signal: controller.signal,
    }).then((prepared) => {
      if (!active) return
      sourceUrlRef.current = prepared.sourceUrl
      persistenceSnapshotRef.current = prepared.persistence
      persistenceRef.current = new ImageMarkV3PersistenceQueue({
        repository,
        initialReference: prepared.reference,
        initialHistory: prepared.history,
        onStatusChange: reportPersistenceStatus,
      })
      setPersistenceStatus({ kind: 'idle', reference: prepared.reference })
      setBootstrap({
        kind: 'ready',
        sourceUrl: prepared.sourceUrl,
        document: prepared.document,
        history: prepared.history,
        resourceDescriptors: prepared.resourceDescriptors,
      })
      publishReference(prepared.reference)
      logger.info('查看器快速编辑 V3 会话准备完成', {
        event: 'image_editor_v3.viewer.bootstrap.completed',
        context: {
          documentId: prepared.reference.documentId,
          revision: prepared.reference.revision,
        },
      })
    }).catch((error: unknown) => {
      if (!active || (error instanceof Error && error.name === 'AbortError')) return
      logger.error('查看器快速编辑 V3 会话准备失败', {
        event: 'image_editor_v3.viewer.bootstrap.failed',
        context: { errorName: error instanceof Error ? error.name : 'UnknownError' },
      })
      setBootstrap(error instanceof ImageEditorReadinessErrorV3
        ? { kind: 'failed', readiness: error.readiness }
        : error instanceof ViewerMarkEditorV3SessionError
          ? { kind: 'failed', messageKey: error.messageKey }
        : {
            kind: 'failed',
            message: error instanceof Error && error.message.trim()
              ? error.message
              : undefined,
          })
    })
    return () => {
      active = false
      controller.abort()
    }
  }, [bootstrapAttempt, imageUrl, publishReference, reportPersistenceStatus, repository])

  const flushPending = useCallback(async (): Promise<ImageEditDocumentReferenceV3> => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    const queue = persistenceRef.current
    const snapshot = persistenceSnapshotRef.current
    if (!queue || !snapshot) throw new Error('快速编辑文档尚未准备完成')
    queue.enqueue(snapshot)
    return queue.flush()
  }, [])

  useEffect(() => () => {
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    const queue = persistenceRef.current
    const snapshot = persistenceSnapshotRef.current
    if (!queue || !snapshot) return
    queue.enqueue(snapshot)
    void queue.flush().catch((error: unknown) => {
      logger.error('查看器快速编辑退出前保存失败', {
        event: 'image_editor_v3.viewer.unmount_save.failed',
        context: { errorName: error instanceof Error ? error.name : 'UnknownError' },
      })
    })
  }, [])

  const handleDocumentChange = useCallback((document: ImageEditDocumentV3): void => {
    setBootstrap((current) => current.kind === 'ready'
      ? { ...current, document }
      : current)
  }, [])

  const handlePersistenceChange = useCallback((snapshot: ImageEditPersistenceSnapshotV3): void => {
    persistenceSnapshotRef.current = snapshot
    setBootstrap((current) => current.kind === 'ready'
      ? {
          ...current,
          document: snapshot.document,
          history: snapshot.history,
          resourceDescriptors: reconcileImageEditorV3ResourceDescriptors(
            snapshot.document,
            current.resourceDescriptors,
            snapshot.retainedResources,
          ),
        }
      : current)
    persistenceRef.current?.enqueue(snapshot)
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      void flushPending().catch(() => {
        if (mountedRef.current) {
          showNotification(t('imageEditor.v3.viewer.notifications.autosaveFailed'), 'error')
        }
      })
    }, AUTOSAVE_DELAY_MS)
  }, [flushPending, showNotification, t])

  const outputReadiness = useMemo<ImageEditorCapabilityReadinessV3>(() => (
    bootstrap.kind === 'ready'
      ? resolveViewerMarkV3MaterializationReadiness(bootstrap.document, bootstrap.sourceUrl)
      : {
          state: 'disabled',
          reasonKey: 'imageEditor.v3.readiness.reasons.viewerDocumentNotReady',
        }
  ), [bootstrap])

  const materialize = useCallback(async (): Promise<void> => {
    if (busy || materializationAbortRef.current || bootstrap.kind !== 'ready') return
    if (outputReadiness.state !== 'ready') {
      const reason = resolveImageEditorReadinessReasonV3(outputReadiness, t)
      showNotification(reason
        ? t('imageEditor.v3.viewer.replaceUnavailableWithReason', { reason })
        : t('imageEditor.v3.viewer.replaceUnavailable'), 'error')
      return
    }
    const controller = new AbortController()
    materializationAbortRef.current = controller
    setBusy(true)
    setMaterialization({ completed: 0, total: 0, cancelling: false })
    logger.info('查看器快速编辑开始受管图片物化', {
      event: 'image_editor_v3.viewer.materialization.start',
    })
    try {
      const reference = await flushPending()
      if (controller.signal.aborted) throw controller.signal.reason ?? new DOMException('已取消', 'AbortError')
      const documentRef = toDocumentRef(reference.documentId)
      const snapshot = await loadImageEditorV3Document({
        requestId: createImageEditorV3RequestId('viewer-materialization-snapshot'),
        documentRef,
      }, controller.signal)
      if (
        !snapshot
        || snapshot.documentRef !== documentRef
        || snapshot.revision !== reference.revision
        || snapshot.document.id !== reference.documentId
      ) {
        throw new Error('保存后的快速编辑权威快照不可用，请重试')
      }
      const result = await materializeViewerMarkV3Raster({
        snapshot,
        sourceName: bootstrap.sourceUrl,
        signal: controller.signal,
        onProgress: ({ completed, total }) => {
          if (!mountedRef.current) return
          setMaterialization((current) => current ? { ...current, completed, total } : current)
        },
      })
      const nextReference: ImageEditDocumentReferenceV3 = {
        documentId: reference.documentId,
        revision: result.revision,
        previewRef: result.previewRef,
      }
      const nextSession: ImageEditSessionReferenceV3 = {
        kind: 'image-edit-v3',
        sourceUrl: result.mediaUrl,
        documentRef: result.documentRef,
        revision: result.revision,
        previewRef: result.previewRef,
      }
      sourceUrlRef.current = result.mediaUrl
      const persistence = persistenceSnapshotRef.current
      if (persistence) {
        persistenceRef.current = new ImageMarkV3PersistenceQueue({
          repository,
          initialReference: nextReference,
          initialHistory: persistence.history,
          onStatusChange: reportPersistenceStatus,
        })
      }
      setPersistenceStatus({ kind: 'idle', reference: nextReference })
      setBootstrap((current) => current.kind === 'ready'
        ? { ...current, sourceUrl: result.mediaUrl }
        : current)
      onSessionChangeRef.current?.(nextSession)
      onSaveRef.current(result.mediaUrl, nextSession)
      logger.info('查看器快速编辑受管图片物化完成', {
        event: 'image_editor_v3.viewer.materialization.completed',
        context: {
          documentId: reference.documentId,
          revision: result.revision,
          previewRef: result.previewRef,
        },
      })
    } catch (error: unknown) {
      if (controller.signal.aborted || isViewerMarkV3MaterializationAbort(error)) {
        logger.info('查看器快速编辑受管图片物化已取消', {
          event: 'image_editor_v3.viewer.materialization.cancelled',
        })
        if (mountedRef.current) {
          showNotification(t('imageEditor.v3.viewer.notifications.replaceCancelled'))
        }
      } else {
        logger.error('查看器快速编辑受管图片物化失败', error, {
          event: 'image_editor_v3.viewer.materialization.failed',
          context: { errorName: error instanceof Error ? error.name : 'UnknownError' },
        })
        if (mountedRef.current) {
          showNotification(t('imageEditor.v3.viewer.notifications.replaceFailed'), 'error')
        }
      }
    } finally {
      if (materializationAbortRef.current === controller) materializationAbortRef.current = null
      if (mountedRef.current) {
        setMaterialization(null)
        setBusy(false)
      }
    }
  }, [
    bootstrap,
    busy,
    flushPending,
    outputReadiness,
    reportPersistenceStatus,
    repository,
    showNotification,
    t,
  ])

  const cancelMaterialization = useCallback((): void => {
    const controller = materializationAbortRef.current
    if (!controller || controller.signal.aborted) return
    setMaterialization((current) => current ? { ...current, cancelling: true } : current)
    controller.abort()
  }, [])

  const finish = useCallback(async (): Promise<void> => {
    if (busy || bootstrap.kind !== 'ready') return
    setBusy(true)
    try {
      const reference = await flushPending()
      publishReference(reference)
      onClose()
    } catch (error: unknown) {
      logger.error('快速编辑完成前保存失败', {
        event: 'image_editor_v3.viewer.finish_save.failed',
        context: { errorName: error instanceof Error ? error.name : 'UnknownError' },
      })
      showNotification(t('imageEditor.v3.viewer.notifications.finishSaveFailed'), 'error')
    } finally {
      if (mountedRef.current) setBusy(false)
    }
  }, [bootstrap.kind, busy, flushPending, onClose, publishReference, showNotification, t])

  return {
    bootstrap,
    persistenceStatus,
    materialization,
    busy,
    outputReadiness,
    retryBootstrap: () => setBootstrapAttempt((value) => value + 1),
    handleDocumentChange,
    handlePersistenceChange,
    materialize,
    cancelMaterialization,
    finish,
  }
}
