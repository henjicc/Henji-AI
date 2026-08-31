import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ImageEditorV3CommandRepository,
  ingestImageEditorV3Source,
} from '@/commands/imageEditorV3'
import type { ImageEditDocument } from '@/core/imageEdit'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { migrateImageEditDocumentV2ToV3 } from '@/core/imageEdit/v3/legacyMigration'
import type {
  ImageEditDocumentReferenceV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts'
import { createLogger } from '@/core/logging'
import { useNotification } from '@/contexts/NotificationContext'
import {
  ImageMarkV3PersistenceQueue,
  type ImageMarkV3PersistenceStatus,
} from './imageMarkV3Persistence'
import {
  createImageMarkToolV3RequestId,
  useImageMarkToolV3Actions,
  type ImageMarkToolV3ActionsController,
  type OpenedImageMarkV3Package,
} from './useImageMarkToolV3Actions'
import {
  createImageMarkV3ColorMode,
  resolveImageMarkV3SourceLocator,
} from './imageMarkV3Source'

const logger = createLogger('features.imageMark.v3_host')
const AUTOSAVE_DELAY_MS = 500

export interface ImageMarkToolV3HostProps {
  sourceImageUrl: string
  sourceName: string
  sourceSessionKey: number
  initialDocument: ImageEditDocument
  onBack?: () => void
  onOpenFile: () => void | Promise<void>
  onPasteFromClipboard: () => void | Promise<void>
  onCreateBlank: () => void
  onFallback: () => void
}

export type ImageMarkV3BootstrapState =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | {
      kind: 'ready'
      document: ImageEditDocumentV3
      history: ImageEditCommandHistorySnapshotV3
      resourceByteSizes: Record<string, number>
    }

export type { ImageMarkV3RasterExportUiState } from './useImageMarkToolV3Actions'

export interface ImageMarkToolV3HostController extends ImageMarkToolV3ActionsController {
  bootstrap: ImageMarkV3BootstrapState
  persistenceStatus: ImageMarkV3PersistenceStatus | null
  retryBootstrap: () => void
  flushPending: () => Promise<ImageEditDocumentReferenceV3>
  handleDocumentChange: (document: ImageEditDocumentV3) => void
  handlePersistenceChange: (snapshot: ImageEditPersistenceSnapshotV3) => void
}

export function useImageMarkToolV3Host(
  props: ImageMarkToolV3HostProps,
): ImageMarkToolV3HostController {
  const {
    sourceImageUrl,
    sourceName,
    sourceSessionKey,
    initialDocument,
  } = props
  const { t } = useTranslation('ui')
  const { showNotification } = useNotification()
  const repository = useMemo(() => new ImageEditorV3CommandRepository(), [])
  const [bootstrap, setBootstrap] = useState<ImageMarkV3BootstrapState>({ kind: 'loading' })
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
  const [persistenceStatus, setPersistenceStatus] = useState<ImageMarkV3PersistenceStatus | null>(null)
  const mountedRef = useRef(true)
  const documentIdRef = useRef(createImageEditIdV3('document'))
  const persistenceSnapshotRef = useRef<ImageEditPersistenceSnapshotV3 | null>(null)
  const persistenceRef = useRef<ImageMarkV3PersistenceQueue | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const reportPersistenceStatus = useCallback((status: ImageMarkV3PersistenceStatus): void => {
    if (mountedRef.current) setPersistenceStatus(status)
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setBootstrap({ kind: 'loading' })
    setPersistenceStatus(null)
    persistenceRef.current = null
    persistenceSnapshotRef.current = null

    void (async () => {
      let sourceKind = 'unsupported'
      try {
        const source = resolveImageMarkV3SourceLocator(sourceImageUrl)
        sourceKind = source.kind
        logger.info('图片编辑 V3 工具箱宿主开始导入图片', {
          event: 'image_editor_v3.toolbox.bootstrap.start',
          context: { sourceKind, sourceSessionKey },
        })
        const managed = await ingestImageEditorV3Source({
          requestId: createImageMarkToolV3RequestId('source-ingest'),
          source,
        }, controller.signal)
        let generatedLayerIndex = 0
        const migrated = migrateImageEditDocumentV2ToV3(initialDocument, {
          width: managed.metadata.width,
          height: managed.metadata.height,
          sourceResourceId: managed.resource.resourceRef,
          documentId: documentIdRef.current,
          idFactory: (prefix) => `${prefix}-${documentIdRef.current}-${generatedLayerIndex += 1}`,
        })
        const document: ImageEditDocumentV3 = {
          ...migrated,
          color: createImageMarkV3ColorMode(managed.metadata),
        }
        const initialHistory = new ImageEditCommandHistoryV3()
        initialHistory.clear(document)
        const initialPersistence: ImageEditPersistenceSnapshotV3 = {
          document,
          history: initialHistory.createSnapshot(),
          retainedResources: [],
        }
        const initialReference = await repository.save(document, {
          expectedRevision: 0,
          previewRef: null,
          history: initialPersistence.history,
          signal: controller.signal,
        })
        if (!active) return
        const queue = new ImageMarkV3PersistenceQueue({
          repository,
          initialReference,
          initialHistory: initialPersistence.history,
          onStatusChange: reportPersistenceStatus,
        })
        persistenceRef.current = queue
        persistenceSnapshotRef.current = initialPersistence
        setPersistenceStatus({ kind: 'idle', reference: initialReference })
        setBootstrap({
          kind: 'ready',
          document,
          history: initialPersistence.history,
          resourceByteSizes: { [managed.resource.resourceRef]: managed.resource.byteLength },
        })
        logger.info('图片编辑 V3 工具箱宿主准备完成', {
          event: 'image_editor_v3.toolbox.bootstrap.completed',
          context: { documentId: document.id, revision: initialReference.revision },
        })
      } catch (error) {
        if (!active || (error instanceof Error && error.name === 'AbortError')) return
        logger.error('图片编辑 V3 工具箱宿主初始化失败', {
          event: 'image_editor_v3.toolbox.bootstrap.failed',
          context: {
            sourceKind,
            sourceSessionKey,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
        })
        setBootstrap({ kind: 'failed' })
      }
    })()

    return () => {
      active = false
      controller.abort()
    }
  }, [
    bootstrapAttempt,
    initialDocument,
    reportPersistenceStatus,
    repository,
    sourceImageUrl,
    sourceSessionKey,
  ])

  const flushPending = useCallback(async (): Promise<ImageEditDocumentReferenceV3> => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current)
      autosaveTimerRef.current = null
    }
    const queue = persistenceRef.current
    const snapshot = persistenceSnapshotRef.current
    if (!queue || !snapshot) throw new Error('图片编辑文档尚未准备完成')
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
      logger.error('图片编辑 V3 工具箱宿主离开前保存失败', {
        event: 'image_editor_v3.toolbox.unmount_save.failed',
        context: {
          documentId: snapshot.document.id,
          revision: snapshot.document.revision,
          errorName: error instanceof Error ? error.name : 'UnknownError',
        },
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
    setBootstrap((current) => {
      const resourceByteSizes = current.kind === 'ready' ? { ...current.resourceByteSizes } : {}
      for (const resource of snapshot.retainedResources) {
        if (resource.byteSize !== null) resourceByteSizes[resource.resourceId] = resource.byteSize
      }
      return {
        kind: 'ready',
        document: snapshot.document,
        history: snapshot.history,
        resourceByteSizes,
      }
    })
    persistenceRef.current?.enqueue(snapshot)
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      void flushPending().catch((error: unknown) => {
        logger.error('图片编辑 V3 工具箱宿主自动保存失败', {
          event: 'image_editor_v3.toolbox.autosave.failed',
          context: {
            documentId: snapshot.document.id,
            revision: snapshot.document.revision,
            errorName: error instanceof Error ? error.name : 'UnknownError',
          },
        })
        if (mountedRef.current) {
          showNotification(t('imageEditor.v3.host.notifications.autosaveFailed'), 'error')
        }
      })
    }, AUTOSAVE_DELAY_MS)
  }, [flushPending, showNotification, t])

  const handlePackageOpened = useCallback((opened: OpenedImageMarkV3Package): void => {
    documentIdRef.current = opened.document.id
    persistenceSnapshotRef.current = opened.persistence
    persistenceRef.current = new ImageMarkV3PersistenceQueue({
      repository,
      initialReference: opened.reference,
      initialHistory: opened.history,
      onStatusChange: reportPersistenceStatus,
    })
    setPersistenceStatus({ kind: 'idle', reference: opened.reference })
    setBootstrap({
      kind: 'ready',
      document: opened.document,
      history: opened.history,
      resourceByteSizes: opened.resourceByteSizes,
    })
  }, [reportPersistenceStatus, repository])

  const actions = useImageMarkToolV3Actions({
    document: bootstrap.kind === 'ready' ? bootstrap.document : null,
    sourceName,
    flushPending,
    onPackageOpened: handlePackageOpened,
  })

  return {
    bootstrap,
    persistenceStatus,
    ...actions,
    retryBootstrap: () => setBootstrapAttempt((value) => value + 1),
    flushPending,
    handleDocumentChange,
    handlePersistenceChange,
  }
}
