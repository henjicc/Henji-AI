import { ingestImageEditorV3Source, ImageEditorV3CommandRepository, loadImageEditorV3Document } from '@/commands/imageEditorV3'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'
import { parseImageEditDocumentV3 } from '@/core/imageEdit/v3/documentCodec'
import { ImageEditCommandHistoryV3 } from '@/core/imageEdit/v3/commandHistory'
import { imageEditOutputSizeV3 } from '@/core/imageEdit/v3/outputGeometry'
import { createImageMarkV3ColorMode, prepareImageEditSourceLocatorV3 } from '@/features/imageEdit/v3/application/imageEditSourceV3'
import { materializeImageEditSnapshotV3 } from '../v3/application/imageEditMaterializationV3'
import { persistImageSource } from '@/commands/image'
import { inspectAsset } from '@/commands/assetLibrary'
import {
  createMarkId,
} from '@/core/imageEdit'
import { createLogger } from '@/core/logging'
import { addMediaReferenceToLibrary } from '@/features/assets/services/assetCollectionService'

import { buildImageEditDocumentFromControlOperations } from './imageEditDocumentBuilder'
import {
  deleteStoredImageEditPreview,
  getStoredImageEditPreview,
  resetImageEditSessionRegistryForTests,
  storeImageEditPreview,
} from './imageEditSessionRegistry'

const logger = createLogger('features.imageEdit.application')

// 同一份预览的准备与提交共用合成结果；弱引用不延长已淘汰预览的生命周期。
const renderedPreviews = new WeakMap<object, { signature: string; source: Promise<string> }>()

/** 将编辑结果交给其他功能，不收藏、不删除预览，也不覆盖原图。 */
export async function materializeImageEditPreview(previewRef: string): Promise<string> {
  const preview = getStoredImageEditPreview(previewRef)
  if (!preview) throw new Error('NOT_FOUND:编辑预览已失效，请重新读取或创建预览。')
  const signature = JSON.stringify([preview.source, preview.document])
  const cached = renderedPreviews.get(preview)
  if (cached?.signature === signature) return cached.source
  const document = structuredClone(preview.document)
  const pending = (async () => {
    logger.info('编辑结果准备开始', { event: 'image_edit.preview.materialize.start', previewRef })
    try {
      const snapshot = await loadImageEditorV3Document({ requestId: `preview-export:${document.id}:${document.revision}`, documentRef: `image-edit-v3:${document.id}` })
      if (!snapshot || snapshot.documentRef !== `image-edit-v3:${document.id}` || snapshot.document.id !== document.id || snapshot.document.revision !== document.revision || snapshot.revision !== document.revision) throw new Error('预览文档与权威快照不一致')
      const rendered = await materializeImageEditSnapshotV3(snapshot, 'edited.png')
      const filePath = await persistImageSource(rendered.raster.mediaUrl)
      logger.info('编辑结果准备完成', { event: 'image_edit.preview.materialize.completed', previewRef })
      return filePath
    } catch (error) {
      logger.error('编辑结果准备失败', error, { event: 'image_edit.preview.materialize.failed', previewRef })
      if (renderedPreviews.get(preview)?.signature === signature) renderedPreviews.delete(preview)
      throw error
    }
  })()
  renderedPreviews.set(preview, { signature, source: pending })
  return pending
}

export async function createImageEditPreview(input: {
  sourceRef: string
  source: string
  operations: Record<string, unknown>[]
  existingDocument?: unknown
}): Promise<Record<string, unknown>> {
  logger.info('图片编辑预览开始', {
    event: 'image_edit.preview.create.start',
    sourceRef: input.sourceRef,
    operationCount: input.operations.length,
  })
  try {
    let initial: ImageEditDocumentV3
    if (input.existingDocument !== undefined) {
      initial = { ...parseImageEditDocumentV3(input.existingDocument), id: createMarkId(), revision: 0 }
    } else {
      const managed = await ingestImageEditorV3Source({ requestId: `preview-source:${createMarkId()}`, source: await prepareImageEditSourceLocatorV3(input.source) })
      initial = createImageEditDocumentV3({ width: managed.metadata.width, height: managed.metadata.height, sourceResourceId: managed.resource.resourceRef, color: createImageMarkV3ColorMode(managed.metadata) })
    }
    const document = buildImageEditDocumentFromControlOperations(input.operations, initial.geometry, initial)
    const history = new ImageEditCommandHistoryV3()
    history.clear(document)
    await new ImageEditorV3CommandRepository().save(document, { expectedRevision: 0, previewRef: null, history: history.createSnapshot() })
    const info = imageEditOutputSizeV3(document.geometry)
    const createdAt = Date.now()
    const previewRef = `image-edit-preview:${createMarkId()}`
    storeImageEditPreview({
      previewRef,
      sourceRef: input.sourceRef,
      source: input.source,
      document,
      width: info.width,
      height: info.height,
      revision: createdAt,
      createdAt,
    })
    logger.info('图片编辑预览完成', {
      event: 'image_edit.preview.create.completed',
      sourceRef: input.sourceRef,
      previewRef,
      operationCount: input.operations.length,
    })
    return {
      previewRef,
      sourceRef: input.sourceRef,
      operationCount: input.operations.length,
      hasEffect: document.revision > 0,
      width: info.width,
      height: info.height,
      document,
    }
  } catch (error) {
    logger.error('图片编辑预览失败', error, {
      event: 'image_edit.preview.create.failed',
      sourceRef: input.sourceRef,
    })
    throw error
  }
}

export async function commitImageEdit(previewRef: string, displayName?: string): Promise<Record<string, unknown>> {
  logger.info('图片编辑提交开始', { event: 'image_edit.preview.commit.start', previewRef })
  try {
    const preview = getStoredImageEditPreview(previewRef)
    if (!preview) throw new Error('NOT_FOUND')
    const filePath = await materializeImageEditPreview(previewRef)
    const asset = await addMediaReferenceToLibrary({
      filePath,
      mediaType: 'image',
      source: 'canvas',
      displayName: displayName?.trim() || `编辑图片-${Date.now()}`,
    })
    // 创建已经发生：核实失败仍保留素材引用，不能把它伪装成零执行并重复创建。
    let verified = false
    try {
      const persisted = await inspectAsset(asset.id)
      verified = persisted.id === asset.id && persisted.filePath === asset.filePath
        && persisted.mediaType === 'image' && persisted.inspectionStatus === 'ready'
    } catch (error) {
      logger.warn('编辑素材已创建，回读核实未完成', { event: 'image_edit.preview.commit.verification_failed', assetId: asset.id, error })
    }
    deleteStoredImageEditPreview(previewRef)
    logger.info('图片编辑提交完成', {
      event: 'image_edit.preview.commit.completed',
      previewRef,
      assetId: asset.id,
    })
    return { previewRef, assetId: asset.id, status: 'committed', resultRefs: [{ kind: 'asset', id: asset.id }],
      verification: { verified, condition: '编辑图片已从正式素材存储回读并确认媒体可用', target: { kind: 'asset', id: asset.id } } }
  } catch (error) {
    logger.error('图片编辑提交失败', error, {
      event: 'image_edit.preview.commit.failed',
      previewRef,
    })
    throw error
  }
}

export function resetImageEditApplicationStateForTests(): void {
  resetImageEditSessionRegistryForTests()
}
