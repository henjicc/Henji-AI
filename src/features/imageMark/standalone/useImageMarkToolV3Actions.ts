import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  loadImageEditorV3Document,
  openImageEditorV3Package,
  saveImageEditorV3PackageAs,
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
import type { ImageEditorCapabilityReadinessV3 } from '@/features/imageEdit/v3/application/imageEditorHostProfiles'
import { resolveImageEditorReadinessReasonV3 } from '@/features/imageEdit/v3/editor/readinessPresentationV3'
import type {
  ImageEditorV3DocumentRef,
  ImageEditorV3RasterExportFormat,
  ImageEditorV3ResourceDescriptor,
} from '@/platform/contracts/imageEditorV3'
import {
  exportImageMarkV3Raster,
  imageMarkV3RasterExportExtension,
  isImageMarkV3RasterExportAbort,
  listImageMarkV3RasterExportFormats,
  resolveImageMarkV3RasterExportFailureReason,
  resolveImageMarkV3RasterExportReadiness,
  type ImageMarkV3RasterExportProgress,
} from './imageMarkV3RasterExport'

const logger = createLogger('features.imageMark.v3_host')

export interface ImageMarkV3RasterExportUiState extends ImageMarkV3RasterExportProgress {
  cancelling: boolean
}

export interface ImageMarkV3RasterExportOption {
  format: ImageEditorV3RasterExportFormat
  readiness: ImageEditorCapabilityReadinessV3
}

export interface OpenedImageMarkV3Package {
  document: ImageEditDocumentV3
  history: ImageEditCommandHistorySnapshotV3
  persistence: ImageEditPersistenceSnapshotV3
  reference: ImageEditDocumentReferenceV3
  resourceByteSizes: Record<string, number>
  resourceDescriptors: ImageEditorV3ResourceDescriptor[]
}

interface ImageMarkToolV3ActionsOptions {
  document: ImageEditDocumentV3 | null
  sourceName: string
  flushPending: () => Promise<ImageEditDocumentReferenceV3>
  onPackageOpened: (opened: OpenedImageMarkV3Package) => void
}

export interface ImageMarkToolV3ActionsController {
  isHostBusy: boolean
  rasterExport: ImageMarkV3RasterExportUiState | null
  rasterExportOptions: readonly ImageMarkV3RasterExportOption[]
  rasterExportReadiness: ImageEditorCapabilityReadinessV3
  runAfterSave: (action: () => void | Promise<void>) => Promise<void>
  handleOpenPackage: () => Promise<void>
  handleSavePackage: () => Promise<void>
  handleRasterExport: (format: ImageEditorV3RasterExportFormat) => Promise<void>
  handleCancelRasterExport: () => void
}

export function createImageMarkToolV3RequestId(operation: string): string {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `image-editor-v3:toolbox:${operation}:${suffix}`
}

function toDocumentRef(documentId: string): ImageEditorV3DocumentRef {
  return `image-edit-v3:${documentId}`
}

function sourceStem(sourceName: string, fallback: string): string {
  return sourceName.replace(/\.[^.]+$/, '').trim() || fallback
}

export function useImageMarkToolV3Actions({
  document,
  sourceName,
  flushPending,
  onPackageOpened,
}: ImageMarkToolV3ActionsOptions): ImageMarkToolV3ActionsController {
  const { t } = useTranslation('ui')
  const { showNotification } = useNotification()
  const [isHostBusy, setIsHostBusy] = useState(false)
  const [rasterExport, setRasterExport] = useState<ImageMarkV3RasterExportUiState | null>(null)
  const mountedRef = useRef(true)
  const rasterExportAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      rasterExportAbortRef.current?.abort()
    }
  }, [])

  const runAfterSave = useCallback(async (action: () => void | Promise<void>): Promise<void> => {
    if (isHostBusy) return
    setIsHostBusy(true)
    try {
      await flushPending()
      await action()
    } catch (error) {
      logger.error('图片编辑 V3 切换图片前保存失败', {
        event: 'image_editor_v3.toolbox.source_replace.failed',
        context: { errorName: error instanceof Error ? error.name : 'UnknownError' },
      })
      showNotification(t('imageEditor.v3.host.notifications.saveBeforeReplaceFailed'), 'error')
    } finally {
      if (mountedRef.current) setIsHostBusy(false)
    }
  }, [flushPending, isHostBusy, showNotification, t])

  const handleOpenPackage = useCallback(async (): Promise<void> => {
    await runAfterSave(async () => {
      const result = await openImageEditorV3Package({
        requestId: createImageMarkToolV3RequestId('package-open'),
      })
      if (result.status !== 'completed') return
      const { snapshot, resources } = result.value
      const historyState = new ImageEditCommandHistoryV3()
      if (snapshot.history) historyState.restore(snapshot.document, snapshot.history)
      else historyState.clear(snapshot.document)
      const history = historyState.createSnapshot()
      const persistence: ImageEditPersistenceSnapshotV3 = {
        document: snapshot.document,
        history,
        retainedResources: historyState.getRetainedResources(),
      }
      const reference: ImageEditDocumentReferenceV3 = {
        documentId: snapshot.document.id,
        revision: snapshot.revision,
        previewRef: snapshot.previewRef,
      }
      onPackageOpened({
        document: snapshot.document,
        history,
        persistence,
        reference,
        resourceByteSizes: Object.fromEntries(
          resources.map((resource) => [resource.resourceRef, resource.byteLength]),
        ),
        resourceDescriptors: snapshot.resources,
      })
      logger.info('图片编辑 V3 可编辑文件已打开', {
        event: 'image_editor_v3.toolbox.package_open.completed',
        context: { documentId: snapshot.document.id, revision: snapshot.revision },
      })
    })
  }, [onPackageOpened, runAfterSave])

  const handleSavePackage = useCallback(async (): Promise<void> => {
    if (isHostBusy) return
    setIsHostBusy(true)
    try {
      const reference = await flushPending()
      const result = await saveImageEditorV3PackageAs({
        requestId: createImageMarkToolV3RequestId('package-save'),
        documentRef: toDocumentRef(reference.documentId),
        revision: reference.revision,
        suggestedName: t('imageEditor.v3.host.fileNames.editable', {
          stem: sourceStem(sourceName, t('imageEditor.v3.host.fileNames.fallbackStem')),
        }),
      })
      if (result.status === 'completed') {
        showNotification(t('imageEditor.v3.host.notifications.packageSaved'))
      }
    } catch (error) {
      logger.error('图片编辑 V3 可编辑文件保存失败', {
        event: 'image_editor_v3.toolbox.package_save.failed',
        context: { errorName: error instanceof Error ? error.name : 'UnknownError' },
      })
      showNotification(t('imageEditor.v3.host.notifications.packageSaveFailed'), 'error')
    } finally {
      if (mountedRef.current) setIsHostBusy(false)
    }
  }, [flushPending, isHostBusy, showNotification, sourceName, t])

  const rasterExportOptions = useMemo<readonly ImageMarkV3RasterExportOption[]>(() => (
    document
      ? listImageMarkV3RasterExportFormats(document).map((format) => ({
          format,
          readiness: resolveImageMarkV3RasterExportReadiness(document, sourceName, format),
        }))
      : []
  ), [document, sourceName])

  const rasterExportReadiness = useMemo<ImageEditorCapabilityReadinessV3>(() => {
    if (!document) {
      return {
        state: 'disabled',
        reasonKey: 'imageEditor.v3.readiness.reasons.exportDocumentNotReady',
      }
    }
    if (rasterExportOptions.some(({ readiness }) => readiness.state === 'ready')) {
      return { state: 'ready' }
    }
    return rasterExportOptions[0]?.readiness
      ?? resolveImageMarkV3RasterExportReadiness(document, sourceName)
  }, [document, rasterExportOptions, sourceName])

  const handleRasterExport = useCallback(async (
    format: ImageEditorV3RasterExportFormat,
  ): Promise<void> => {
    if (isHostBusy || rasterExportAbortRef.current) return
    const option = rasterExportOptions.find((candidate) => candidate.format === format)
    const readiness = option?.readiness ?? {
      state: 'disabled' as const,
      reasonKey: 'imageEditor.v3.readiness.reasons.exportBitDepth' as const,
    }
    if (readiness.state !== 'ready') {
      showNotification(
        resolveImageEditorReadinessReasonV3(readiness, t)
          ?? t('imageEditor.v3.host.export.defaultUnavailable'),
        'error',
      )
      return
    }
    const controller = new AbortController()
    rasterExportAbortRef.current = controller
    setIsHostBusy(true)
    setRasterExport({ completed: 0, total: 0, cancelling: false })
    try {
      const reference = await flushPending()
      if (controller.signal.aborted) {
        const error = new Error('图片栅格导出已取消')
        error.name = 'AbortError'
        throw error
      }
      const documentRef = toDocumentRef(reference.documentId)
      const snapshot = await loadImageEditorV3Document({
        requestId: createImageMarkToolV3RequestId('raster-export-snapshot'),
        documentRef,
      }, controller.signal)
      if (
        !snapshot
        || snapshot.documentRef !== documentRef
        || snapshot.revision !== reference.revision
        || snapshot.document.id !== reference.documentId
      ) throw new Error(t('imageEditor.v3.host.export.snapshotUnavailable'))
      const result = await exportImageMarkV3Raster({
        snapshot,
        sourceName,
        format,
        suggestedName: t('imageEditor.v3.host.fileNames.edited', {
          stem: sourceStem(sourceName, t('imageEditor.v3.host.fileNames.fallbackStem')),
          extension: imageMarkV3RasterExportExtension(format),
        }),
        signal: controller.signal,
        onProgress: ({ completed, total }) => {
          if (!mountedRef.current) return
          setRasterExport((current) => current ? { ...current, completed, total } : current)
        },
      })
      if (mountedRef.current) {
        showNotification(result.status === 'completed'
          ? t('imageEditor.v3.host.notifications.exportCompleted')
          : t('imageEditor.v3.host.notifications.exportCancelled'))
      }
    } catch (error) {
      if (controller.signal.aborted || isImageMarkV3RasterExportAbort(error)) {
        if (mountedRef.current) {
          showNotification(t('imageEditor.v3.host.notifications.exportCancelled'))
        }
      } else {
        logger.error('图片编辑 V3 栅格图片导出失败', error, {
          event: 'image_editor_v3.toolbox.raster_export.failed',
          context: {
            errorName: error instanceof Error ? error.name : 'UnknownError',
            format,
          },
        })
        if (mountedRef.current) {
          const failureReason = resolveImageMarkV3RasterExportFailureReason(error)
          const reason = resolveImageEditorReadinessReasonV3(failureReason, t)
            ?? t('imageEditor.v3.host.export.unknownError')
          showNotification(t('imageEditor.v3.host.notifications.exportFailed', { reason }), 'error')
        }
      }
    } finally {
      if (rasterExportAbortRef.current === controller) rasterExportAbortRef.current = null
      if (mountedRef.current) {
        setRasterExport(null)
        setIsHostBusy(false)
      }
    }
  }, [
    flushPending,
    isHostBusy,
    rasterExportOptions,
    showNotification,
    sourceName,
    t,
  ])

  const handleCancelRasterExport = useCallback((): void => {
    const controller = rasterExportAbortRef.current
    if (!controller || controller.signal.aborted) return
    setRasterExport((current) => current ? { ...current, cancelling: true } : current)
    controller.abort()
  }, [])

  return {
    isHostBusy,
    rasterExport,
    rasterExportOptions,
    rasterExportReadiness,
    runAfterSave,
    handleOpenPackage,
    handleSavePackage,
    handleRasterExport,
    handleCancelRasterExport,
  }
}
