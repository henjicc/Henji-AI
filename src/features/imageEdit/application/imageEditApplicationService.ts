import { persistImageSource, readImageInfo } from '@/commands/image'
import {
  createMarkId,
  hasImageEditEffect,
  parseImageEditDocument,
} from '@/core/imageEdit'
import { createLogger } from '@/core/logging'
import { addMediaReferenceToLibrary } from '@/features/assets/services/assetCollectionService'
import { exportImageEditDocument } from '@/features/imageEdit/execution/browserImageEditExecution'

import { buildImageEditDocumentFromControlOperations } from './imageEditDocumentBuilder'
import {
  deleteStoredImageEditPreview,
  getStoredImageEditPreview,
  resetImageEditSessionRegistryForTests,
  storeImageEditPreview,
} from './imageEditSessionRegistry'

const logger = createLogger('features.imageEdit.application')

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
    const info = await readImageInfo(input.source)
    const document = buildImageEditDocumentFromControlOperations(
      input.operations,
      info,
      input.existingDocument === undefined
        ? undefined
        : parseImageEditDocument(input.existingDocument),
    )
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
      hasEffect: hasImageEditEffect(document),
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
    const rendered = await exportImageEditDocument(preview.source, preview.document)
    const filePath = await persistImageSource(rendered)
    const asset = await addMediaReferenceToLibrary({
      filePath,
      mediaType: 'image',
      source: 'canvas',
      displayName: displayName?.trim() || `编辑图片-${Date.now()}`,
    })
    deleteStoredImageEditPreview(previewRef)
    logger.info('图片编辑提交完成', {
      event: 'image_edit.preview.commit.completed',
      previewRef,
      assetId: asset.id,
    })
    return { previewRef, assetId: asset.id, status: 'committed' }
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
