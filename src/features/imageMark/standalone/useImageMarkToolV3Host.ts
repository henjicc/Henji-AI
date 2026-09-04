import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ImageEditorV3CommandRepository,
  ingestImageEditorV3Source,
  loadImageEditorV3Document,
} from '@/commands/imageEditorV3'
import type { ImageEditDocument } from '@/core/imageEdit'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'
import { createImageEditIdV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type { ImageEditSessionReferenceV3 } from '@/core/imageEdit/v3/sessionReference'
import { migrateImageEditDocumentV2ToV3 } from '@/core/imageEdit/v3/legacyMigration'
import type {
  ImageEditDocumentReferenceV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts'
import { createLogger } from '@/core/logging'
import { useNotification } from '@/contexts/NotificationContext'
import {
  createImageEditorV3ResourceByteSizes,
  reconcileImageEditorV3ResourceDescriptors,
} from '@/features/imageEdit/v3/application/imageEditorResourceDescriptorsV3'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorV3PackageThumbnailSnapshot } from '@/features/imageEdit/v3/editor/types'
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
  /** 工具箱切走再返回时只凭稳定引用恢复，不重新导入来源。 */
  initialSession?: ImageEditSessionReferenceV3
  onSessionReferenceChange?: (session: ImageEditSessionReferenceV3) => void
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
      resourceDescriptors: ImageEditorV3ResourceDescriptor[]
    }

export type { ImageMarkV3RasterExportUiState } from './useImageMarkToolV3Actions'

export interface ImageMarkToolV3HostController extends ImageMarkToolV3ActionsController {
  bootstrap: ImageMarkV3BootstrapState
  persistenceStatus: ImageMarkV3PersistenceStatus | null
  retryBootstrap: () => void
  flushPending: () => Promise<ImageEditDocumentReferenceV3>
  handleDocumentChange: (document: ImageEditDocumentV3) => void
  handlePersistenceChange: (snapshot: ImageEditPersistenceSnapshotV3) => void
  handlePackageThumbnailChange: (thumbnail: ImageEditorV3PackageThumbnailSnapshot) => void
}

export function useImageMarkToolV3Host(
  props: ImageMarkToolV3HostProps,
): ImageMarkToolV3HostController {
  const {
    sourceImageUrl,
    sourceName,
    sourceSessionKey,
    initialDocument,
    initialSession,
  } = props
  const { t } = useTranslation('ui')
  const { showNotification } = useNotification()
  const repository = useMemo(() => new ImageEditorV3CommandRepository(), [])
  const [bootstrap, setBootstrap] = useState<ImageMarkV3BootstrapState>({ kind: 'loading' })
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
  const [persistenceStatus, setPersistenceStatus] = useState<ImageMarkV3PersistenceStatus | null>(null)
  const latestSessionRef = useRef<ImageEditSessionReferenceV3 | null>(initialSession ?? null)
  const latestSessionSourceKeyRef = useRef(sourceSessionKey)
  if (latestSessionSourceKeyRef.current !== sourceSessionKey) {
    latestSessionSourceKeyRef.current = sourceSessionKey
    latestSessionRef.current = initialSession ?? null
  }
  const mountedRef = useRef(true)
  const onSessionReferenceChangeRef = useRef(props.onSessionReferenceChange)
  onSessionReferenceChangeRef.current = props.onSessionReferenceChange
  const sessionSourceUrlRef = useRef(initialSession?.sourceUrl ?? sourceImageUrl)
  const documentIdRef = useRef(createImageEditIdV3('document'))
  const persistenceSnapshotRef = useRef<ImageEditPersistenceSnapshotV3 | null>(null)
  const persistenceRef = useRef<ImageMarkV3PersistenceQueue | null>(null)
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const packageThumbnailRef = useRef<ImageEditorV3PackageThumbnailSnapshot | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const reportPersistenceStatus = useCallback((status: ImageMarkV3PersistenceStatus): void => {
    if (!mountedRef.current) return
    setPersistenceStatus(status)
    if (status.kind === 'idle') {
      const session: ImageEditSessionReferenceV3 = {
        kind: 'image-edit-v3',
        sourceUrl: sessionSourceUrlRef.current,
        documentRef: `image-edit-v3:${status.reference.documentId}`,
        revision: status.reference.revision,
        previewRef: status.reference.previewRef as ImageEditSessionReferenceV3['previewRef'],
      }
      latestSessionRef.current = session
      onSessionReferenceChangeRef.current?.(session)
    }
  }, [])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setBootstrap({ kind: 'loading' })
    setPersistenceStatus(null)
    persistenceRef.current = null
    persistenceSnapshotRef.current = null
    packageThumbnailRef.current = null

    void (async () => {
      // StrictMode 会同步执行一次 setup → cleanup → setup。把真正的文件导入推迟到
      // 微任务，第一轮 cleanup 就能在 IPC 发出前将其标记为失效，避免两个导入请求
      // 撞上主进程的单并发门禁并把正常 PNG 误判为打开失败。
      await Promise.resolve()
      if (!active) return
      let sourceKind = 'unsupported'
      try {
        const sessionToRestore = bootstrapAttempt > 0 ? latestSessionRef.current : initialSession
        sourceKind = sessionToRestore ? 'managed-session' : 'unsupported'
        logger.info('图片编辑 V3 工具箱宿主开始导入图片', {
          event: 'image_editor_v3.toolbox.bootstrap.start',
          context: { sourceKind, sourceSessionKey },
        })
        let document: ImageEditDocumentV3
        let initialPersistence: ImageEditPersistenceSnapshotV3
        let initialReference: ImageEditDocumentReferenceV3
        let resourceDescriptors: ImageEditorV3ResourceDescriptor[]
        if (sessionToRestore) {
          const snapshot = await loadImageEditorV3Document({
            requestId: createImageMarkToolV3RequestId('session-restore'),
            documentRef: sessionToRestore.documentRef,
          }, controller.signal)
          const documentId = sessionToRestore.documentRef.slice('image-edit-v3:'.length)
          if (!snapshot
            || snapshot.documentRef !== sessionToRestore.documentRef
            || snapshot.document.id !== documentId
            || snapshot.revision !== sessionToRestore.revision
            || snapshot.document.revision !== sessionToRestore.revision
            || snapshot.previewRef !== sessionToRestore.previewRef) {
            throw new Error('图片编辑 V3 工具箱会话与权威快照不一致')
          }
          document = snapshot.document
          documentIdRef.current = document.id
          const history = new ImageEditCommandHistoryV3()
          if (snapshot.history) history.restore(document, snapshot.history)
          else history.clear(document)
          initialPersistence = {
            document,
            history: history.createSnapshot(),
            retainedResources: history.getRetainedResources(),
          }
          initialReference = {
            documentId: document.id,
            revision: snapshot.revision,
            previewRef: snapshot.previewRef,
          }
          resourceDescriptors = reconcileImageEditorV3ResourceDescriptors(
            document,
            snapshot.resources,
            initialPersistence.retainedResources,
          )
          sessionSourceUrlRef.current = sessionToRestore.sourceUrl
        } else {
          const source = resolveImageMarkV3SourceLocator(sourceImageUrl)
          sourceKind = source.kind
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
          document = {
            ...migrated,
            color: createImageMarkV3ColorMode(managed.metadata),
          }
          const history = new ImageEditCommandHistoryV3()
          history.clear(document)
          initialPersistence = {
            document,
            history: history.createSnapshot(),
            retainedResources: [],
          }
          initialReference = await repository.save(document, {
            expectedRevision: 0,
            previewRef: null,
            history: initialPersistence.history,
            signal: controller.signal,
          })
          resourceDescriptors = [managed.resource]
          sessionSourceUrlRef.current = managed.mediaUrl
        }
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
          resourceByteSizes: createImageEditorV3ResourceByteSizes(resourceDescriptors),
          resourceDescriptors,
        })
        reportPersistenceStatus({ kind: 'idle', reference: initialReference })
        logger.info('图片编辑 V3 工具箱宿主准备完成', {
          event: 'image_editor_v3.toolbox.bootstrap.completed',
          context: { documentId: document.id, revision: initialReference.revision },
        })
      } catch (error) {
        if (!active || (error instanceof Error && error.name === 'AbortError')) return
        logger.error('图片编辑 V3 工具箱宿主初始化失败', error, {
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
    initialSession,
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
      logger.error('图片编辑 V3 工具箱宿主离开前保存失败', error, {
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
      const resourceDescriptors = reconcileImageEditorV3ResourceDescriptors(
        snapshot.document,
        current.kind === 'ready' ? current.resourceDescriptors : [],
        snapshot.retainedResources,
      )
      return {
        kind: 'ready',
        document: snapshot.document,
        history: snapshot.history,
        resourceByteSizes: createImageEditorV3ResourceByteSizes(resourceDescriptors),
        resourceDescriptors,
      }
    })
    persistenceRef.current?.enqueue(snapshot)
    if (autosaveTimerRef.current) clearTimeout(autosaveTimerRef.current)
    autosaveTimerRef.current = setTimeout(() => {
      autosaveTimerRef.current = null
      void flushPending().catch((error: unknown) => {
        logger.error('图片编辑 V3 工具箱宿主自动保存失败', error, {
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
    packageThumbnailRef.current = null
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
      resourceDescriptors: opened.resourceDescriptors,
    })
    reportPersistenceStatus({ kind: 'idle', reference: opened.reference })
  }, [reportPersistenceStatus, repository])

  const handlePackageThumbnailChange = useCallback((
    thumbnail: ImageEditorV3PackageThumbnailSnapshot,
  ): void => {
    packageThumbnailRef.current = thumbnail
  }, [])

  const getPackageThumbnail = useCallback(() => {
    const thumbnail = packageThumbnailRef.current
    const current = persistenceSnapshotRef.current?.document
    if (!thumbnail
      || !current
      || thumbnail.documentId !== current.id
      || thumbnail.revision !== current.revision) return null
    return {
      bytes: thumbnail.bytes.slice(0),
      mediaType: thumbnail.mediaType,
      extension: thumbnail.extension,
    }
  }, [])

  const actions = useImageMarkToolV3Actions({
    document: bootstrap.kind === 'ready' ? bootstrap.document : null,
    sourceName,
    flushPending,
    onPackageOpened: handlePackageOpened,
    getPackageThumbnail,
  })

  return {
    bootstrap,
    persistenceStatus,
    ...actions,
    retryBootstrap: () => setBootstrapAttempt((value) => value + 1),
    flushPending,
    handleDocumentChange,
    handlePersistenceChange,
    handlePackageThumbnailChange,
  }
}
