import type { ApplicationRef } from '@/core/application-control/applicationCapabilities'
import type { ImageEditDocument } from '@/core/imageEdit/index'
import { createLogger } from '@/core/logging/index'
import { inspectAsset } from '@/commands/assetLibrary'
import { readImageInfo } from '@/commands/image'
import { offerImageEditorHandoff } from '@/features/imageEdit/store/imageEditorHandoffStore'
import { databaseService } from '@/services/database/index'
import { resolveReadableGenerationImage } from '@/features/generation/application/generationResultSource'

import { createImageEditPreview } from '@/features/imageEdit/application/imageEditApplicationService'
import { getStoredImageEditPreview } from '@/features/imageEdit/application/imageEditSessionRegistry'
import type { CapabilityExecutionContext } from '@/features/application-control/capabilities/handlerTypes'
import { openApplicationSurface } from '@/features/navigation/application/surfaceCapabilityService'

const logger = createLogger('features.image_edit.source')

interface ResolvedImageSource {
  ref: ApplicationRef
  source: string
  name: string
  document?: ImageEditDocument
}

async function resolveImageSource(ref: ApplicationRef): Promise<ResolvedImageSource> {
  if (ref.kind === 'generation.result') {
    await databaseService.init()
    const record = await databaseService.getHistoryById(ref.id)
    if (
      !record
      || record.type !== 'image'
      || (record.status !== 'success' && record.status !== 'completed')
    ) {
      throw new Error('NOT_FOUND')
    }
    const resolved = await resolveReadableGenerationImage(record)
    return {
      ref,
      source: resolved.source,
      name: resolved.name,
    }
  }
  if (ref.kind === 'asset') {
    const asset = await inspectAsset(ref.id)
    if (asset.mediaType !== 'image') throw new Error('INVALID_INPUT')
    try {
      await readImageInfo(asset.filePath)
    } catch {
      throw new Error('NOT_FOUND')
    }
    return {
      ref,
      source: asset.filePath,
      name: asset.displayName || `素材-${asset.id.slice(0, 8)}.png`,
    }
  }
  if (ref.kind === 'image_edit.preview') {
    const preview = getStoredImageEditPreview(ref.id)
    if (!preview) throw new Error('NOT_FOUND')
    try {
      const info = await readImageInfo(preview.source)
      return {
        ref,
        source: preview.source,
        name: info.fileName || `图片编辑预览-${ref.id.slice(-8)}.${info.extension || 'png'}`,
        document: structuredClone(preview.document),
      }
    } catch {
      throw new Error('NOT_FOUND')
    }
  }
  throw new Error('INVALID_INPUT')
}

function openImageEditor(source: ResolvedImageSource, document?: ImageEditDocument): string {
  const sessionRef = `image-edit-session:${source.ref.kind}:${source.ref.id}`
  offerImageEditorHandoff({
    sessionRef,
    sourceUrl: source.source,
    sourceName: source.name,
    document,
  })
  return sessionRef
}

export async function openImageEditorWithSource(
  sourceRef: ApplicationRef,
  correlation: Pick<CapabilityExecutionContext, 'requestId' | 'taskId'> = {}
): Promise<Record<string, unknown>> {
  logger.debug('image_editor.open.start', {
    event: 'assistant.image_editor.open.start',
    sourceKind: sourceRef.kind,
    sourceId: sourceRef.id,
  })
  const source = await resolveImageSource(sourceRef)
  const sessionRef = openImageEditor(source, source.document)
  const surface = openApplicationSurface('tool.image_edit', correlation)
  logger.info('image_editor.open.completed', {
    event: 'assistant.image_editor.open.completed',
    sourceKind: sourceRef.kind,
    sourceId: sourceRef.id,
    sessionRef,
  })
  return {
    sourceRef,
    resultRefs: [{ kind: 'application.surface', id: 'tool.image_edit' }],
    ...surface,
  }
}

async function createImageEditPreviewForSource(
  input: {
    sourceRef: ApplicationRef
    operations: Record<string, unknown>[]
  }
): Promise<{ source: ResolvedImageSource; preview: Record<string, unknown> }> {
  logger.debug('image_editor.preview.start', {
    event: 'assistant.image_editor.preview.start',
    sourceKind: input.sourceRef.kind,
    sourceId: input.sourceRef.id,
    operationCount: input.operations.length,
  })
  const source = await resolveImageSource(input.sourceRef)
  const preview = await createImageEditPreview({
    sourceRef: `${input.sourceRef.kind}:${input.sourceRef.id}`,
    source: source.source,
    operations: input.operations,
    ...(source.document ? { existingDocument: source.document } : {}),
  })
  logger.info('image_editor.preview.completed', {
    event: 'assistant.image_editor.preview.completed',
    sourceKind: input.sourceRef.kind,
    sourceId: input.sourceRef.id,
    previewRef: preview.previewRef,
  })
  return { source, preview }
}

function imageEditPreviewResult(
  sourceRef: ApplicationRef,
  preview: Record<string, unknown>,
): Record<string, unknown> {
  const previewRef = String(preview.previewRef)
  return {
    previewRef,
    sourceRef,
    resultRefs: [{ kind: 'image_edit.preview', id: previewRef }],
    operationCount: preview.operationCount,
    hasEffect: preview.hasEffect,
    width: preview.width,
    height: preview.height,
  }
}

/** 创建不可变预览快照；后台能力不得顺带抢占用户当前界面。 */
export async function createImageEditPreviewFromRef(input: {
  sourceRef: ApplicationRef
  operations: Record<string, unknown>[]
}): Promise<Record<string, unknown>> {
  const { preview } = await createImageEditPreviewForSource(input)
  return imageEditPreviewResult(input.sourceRef, preview)
}
