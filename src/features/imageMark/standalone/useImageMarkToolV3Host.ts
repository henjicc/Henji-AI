import { getOrCreateImageEditPersistenceQueueV3, readImageEditDocumentInstanceV3 } from '@/features/imageEdit/v3/application/imageEditDocumentInstances'
import { flushImageEditHostPersistenceV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOperations'
import type { ImageEditPersistenceHostV3 } from '@/features/imageEdit/v3/application/imageEditPersistenceOwner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  ImageEditorV3CommandRepository,
  loadImageEditorV3Document,
} from '@/commands/imageEditorV3'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import type { ImageEditCommandHistorySnapshotV3 } from '@/core/imageEdit/v3/commandHistoryCodec'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import type {
  ImageEditDocumentReferenceV3,
  ImageEditPersistenceSnapshotV3,
} from '@/core/imageEdit/v3/serviceContracts'
import { createLogger } from '@/core/logging'
import { useNotification } from '@/contexts/NotificationContext'
import type { OpenImageDocument } from '@/features/imageEdit/documents/imageDocumentRuntime'
import {
  createImageEditorV3ResourceByteSizes,
  reconcileImageEditorV3ResourceDescriptors,
} from '@/features/imageEdit/v3/application/imageEditorResourceDescriptorsV3'
import type { ImageEditorV3ResourceDescriptor } from '@/platform/contracts/imageEditorV3'
import type { ImageEditorV3PackageThumbnailSnapshot } from '@/features/imageEdit/v3/editor/types'
import {
  type ImageEditPersistenceV3Queue,
  type ImageEditPersistenceV3Status,
} from '@/features/imageEdit/v3/application/imageEditPersistenceQueue'
import {
  createImageMarkToolV3RequestId,
  useImageMarkToolV3Actions,
  type ImageMarkToolV3ActionsController,
} from './useImageMarkToolV3Actions'

const logger = createLogger('features.imageMark.v3_host')

export interface ImageMarkToolV3HostProps {
  /** 正在编辑的图片文档（3.5）：编辑器从它的工作副本载入，保存与写回由文档会话负责。 */
  document: OpenImageDocument
  /** 文档名（文件名），导出图片时作建议文件名。 */
  sourceName: string
  /** Present when the image came from a video-edit program frame. */
  videoEditReturn?: string
  onBack?: () => void
  onOpenFile: () => void | Promise<void>
  onPasteFromClipboard: () => void | Promise<void>
  onCreateBlank: () => void
  onSave: () => Promise<void>
  onSaveAs: () => Promise<void>
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
  /** 底层原图的受管媒体地址（单图层直显用）。 */
  sourceImageUrl: string
  persistenceHost: ImageEditPersistenceHostV3
  persistenceStatus: ImageEditPersistenceV3Status | null
  retryBootstrap: () => void
  flushPending: () => Promise<ImageEditDocumentReferenceV3>
  handleDocumentChange: (document: ImageEditDocumentV3) => void
  handlePersistenceChange: (snapshot: ImageEditPersistenceSnapshotV3) => void
  handlePackageThumbnailChange: (thumbnail: ImageEditorV3PackageThumbnailSnapshot) => void
}

export function useImageMarkToolV3Host(
  props: ImageMarkToolV3HostProps,
): ImageMarkToolV3HostController {
  const { document: openDocument, sourceName } = props
  const { t } = useTranslation('ui')
  const { showNotification } = useNotification()
  const repository = useMemo(() => new ImageEditorV3CommandRepository(), [])
  const [bootstrap, setBootstrap] = useState<ImageMarkV3BootstrapState>({ kind: 'loading' })
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
  const [persistenceStatus, setPersistenceStatus] = useState<ImageEditPersistenceV3Status | null>(null)
  const [sourceImageUrl, setSourceImageUrl] = useState(() => openDocument.working().sourceUrl ?? '')
  const mountedRef = useRef(true)
  const persistenceSnapshotRef = useRef<ImageEditPersistenceSnapshotV3 | null>(null)
  const persistenceRef = useRef<ImageEditPersistenceV3Queue | null>(null)
  const persistenceHost = useMemo<ImageEditPersistenceHostV3>(() => ({ getQueue: () => persistenceRef.current }), [])
  const packageThumbnailRef = useRef<ImageEditorV3PackageThumbnailSnapshot | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const reportPersistenceStatus = useCallback((status: ImageEditPersistenceV3Status): void => {
    if (!mountedRef.current) return
    setPersistenceStatus(status)
    if (status.kind === 'failed') showNotification(t('imageEditor.v3.host.notifications.autosaveFailed'), 'error')
  }, [showNotification, t])

  const observedDocumentId = bootstrap.kind === 'ready' ? bootstrap.document.id : null
  useEffect(() => observedDocumentId ? persistenceRef.current?.subscribe(reportPersistenceStatus) : undefined, [observedDocumentId, reportPersistenceStatus])

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setBootstrap({ kind: 'loading' })
    setPersistenceStatus(null)
    persistenceRef.current = null
    persistenceSnapshotRef.current = null
    packageThumbnailRef.current = null

    void (async () => {
      // StrictMode 会同步执行一次 setup → cleanup → setup：推迟到微任务，第一轮 cleanup 先失效。
      await Promise.resolve()
      if (!active) return
      const working = openDocument.working()
      const documentId = working.documentRef.slice('image-edit-v3:'.length)
      try {
        logger.info('图片编辑 V3 工具箱宿主开始载入图片文档', {
          event: 'image_editor_v3.toolbox.bootstrap.start',
          context: { documentId },
        })
        let document: ImageEditDocumentV3
        let initialPersistence: ImageEditPersistenceSnapshotV3
        let initialReference: ImageEditDocumentReferenceV3
        let resourceDescriptors: ImageEditorV3ResourceDescriptor[]
        // 切到别处再回来时，文档实例可能还在内存里（有尚未落盘的修改）：优先接回它。
        const current = readImageEditDocumentInstanceV3(documentId)
        if (current) {
          document = current.document
          initialPersistence = current.persistence
          initialReference = current.reference
          resourceDescriptors = current.resourceDescriptors
        } else {
          const snapshot = await loadImageEditorV3Document({
            requestId: createImageMarkToolV3RequestId('document-load'),
            documentRef: working.documentRef,
          }, controller.signal)
          if (!snapshot || snapshot.document.id !== documentId || snapshot.revision !== snapshot.document.revision) {
            throw new Error('图片文档的工作副本不存在或不一致')
          }
          document = snapshot.document
          const history = new ImageEditCommandHistoryV3()
          if (snapshot.history) history.restore(document, snapshot.history)
          else history.clear(document)
          initialPersistence = {
            document,
            history: history.createSnapshot(),
            retainedResources: history.getRetainedResources(),
          }
          initialReference = { documentId, revision: snapshot.revision, previewRef: snapshot.previewRef }
          resourceDescriptors = reconcileImageEditorV3ResourceDescriptors(
            document,
            snapshot.resources,
            initialPersistence.retainedResources,
          )
        }
        if (!active) return
        const queue = getOrCreateImageEditPersistenceQueueV3({
          repository,
          initialReference,
          initialHistory: initialPersistence.history,
        })
        persistenceRef.current = queue
        persistenceSnapshotRef.current = initialPersistence
        setSourceImageUrl(working.sourceUrl ?? '')
        setPersistenceStatus({ kind: 'idle', reference: initialReference })
        setBootstrap({
          kind: 'ready',
          document,
          history: initialPersistence.history,
          resourceByteSizes: createImageEditorV3ResourceByteSizes(resourceDescriptors),
          resourceDescriptors,
        })
        logger.info('图片编辑 V3 工具箱宿主准备完成', {
          event: 'image_editor_v3.toolbox.bootstrap.completed',
          context: { documentId, revision: initialReference.revision },
        })
      } catch (error) {
        if (!active || (error instanceof Error && error.name === 'AbortError')) return
        logger.error('图片编辑 V3 工具箱宿主初始化失败', error, {
          event: 'image_editor_v3.toolbox.bootstrap.failed',
          context: { documentId, errorName: error instanceof Error ? error.name : 'UnknownError' },
        })
        setBootstrap({ kind: 'failed' })
      }
    })()

    return () => {
      active = false
      controller.abort()
    }
  }, [bootstrapAttempt, openDocument, repository])

  const flushPending = useCallback(async (): Promise<ImageEditDocumentReferenceV3> => {
    const queue = persistenceRef.current
    const snapshot = persistenceSnapshotRef.current
    if (!queue || !snapshot) throw new Error('图片编辑文档尚未准备完成')
    return flushImageEditHostPersistenceV3(queue, snapshot)
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

  // 接到文档会话上：会话保存 = 编辑器落盘到工作副本；写回时带上当前缩略图；
  // 冲突后“重新载入”换了工作副本时重新载入编辑器。
  useEffect(() => {
    openDocument.setShown(true)
    const detach = openDocument.attachEditor({
      flush: async () => {
        if (!persistenceRef.current || !persistenceSnapshotRef.current) return
        await flushPending()
      },
      thumbnail: getPackageThumbnail,
      beforeReload: async () => {
        if (mountedRef.current) setBootstrap({ kind: 'loading' })
        persistenceRef.current = null
        persistenceSnapshotRef.current = null
      },
    })
    const unsubscribe = openDocument.persistence.onWorkingReplaced(() => {
      if (mountedRef.current) setBootstrapAttempt((value) => value + 1)
    })
    return () => {
      unsubscribe()
      detach()
      openDocument.setShown(false)
    }
  }, [flushPending, getPackageThumbnail, openDocument])

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
  }, [])

  const handlePackageThumbnailChange = useCallback((
    thumbnail: ImageEditorV3PackageThumbnailSnapshot,
  ): void => {
    packageThumbnailRef.current = thumbnail
  }, [])

  const actions = useImageMarkToolV3Actions({
    document: bootstrap.kind === 'ready' ? bootstrap.document : null,
    sourceName,
    flushPending,
  })

  return {
    bootstrap,
    sourceImageUrl,
    persistenceHost,
    persistenceStatus,
    ...actions,
    retryBootstrap: () => setBootstrapAttempt((value) => value + 1),
    flushPending,
    handleDocumentChange,
    handlePersistenceChange,
    handlePackageThumbnailChange,
  }
}
