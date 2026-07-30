import type { ApplicationRef } from '@/core/assistant/applicationCapabilities'
import { parseImageEditDocument } from '@/core/imageEdit'
import { createLogger } from '@/core/logging'
import { inspectAsset } from '@/commands/assetLibrary'
import { offerImageEditorHandoff } from '@/features/imageEdit/store/imageEditorHandoffStore'
import { databaseService } from '@/services/database'
import { selectToolboxTool, switchWorkspace } from '@/stores/navigationStore'

import { createImageEditPreviewFromApplicationRef } from '../hostActions'

const logger = createLogger('features.assistant.generation_capabilities')

interface ResolvedImageSource {
  ref: ApplicationRef
  source: string
  name: string
}

function publicHistoryRecord(record: Awaited<ReturnType<typeof databaseService.getHistory>>[number]): Record<string, unknown> {
  const hasResult = Boolean(record.filePath)
    && (record.status === 'success' || record.status === 'completed')
  return {
    ref: {
      kind: 'generation.record',
      id: record.id,
      label: record.prompt?.trim().slice(0, 80) || `${record.type} 生成记录`,
    },
    resultRef: hasResult ? {
      kind: 'generation.result',
      id: record.id,
      label: `${record.type} 生成结果`,
    } : null,
    mediaType: record.type,
    status: record.status,
    providerId: record.providerId,
    modelId: record.modelId,
    prompt: record.prompt?.slice(0, 500) ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    hasResult,
  }
}

export async function listGenerationHistory(input: {
  mediaType?: 'image' | 'video' | 'audio'
  status?: 'success' | 'completed' | 'error' | 'failed'
  limit: number
}): Promise<{ records: Record<string, unknown>[] }> {
  logger.debug('generation_history.list.start', {
    event: 'assistant.generation_history.list.start',
    mediaType: input.mediaType,
    status: input.status,
    limit: input.limit,
  })
  try {
    await databaseService.init()
    const records = await databaseService.getHistory({
      type: input.mediaType,
      status: input.status,
      limit: input.limit,
    })
    logger.info('generation_history.list.completed', {
      event: 'assistant.generation_history.list.completed',
      count: records.length,
    })
    return { records: records.map(publicHistoryRecord) }
  } catch (error) {
    logger.error('generation_history.list.failed', error, {
      event: 'assistant.generation_history.list.failed',
    })
    throw error
  }
}

async function resolveImageSource(ref: ApplicationRef): Promise<ResolvedImageSource> {
  if (ref.kind === 'generation.result') {
    await databaseService.init()
    const record = await databaseService.getHistoryById(ref.id)
    if (
      !record
      || record.type !== 'image'
      || !record.filePath
      || (record.status !== 'success' && record.status !== 'completed')
    ) {
      throw new Error('NOT_FOUND')
    }
    return {
      ref,
      source: record.filePath,
      name: `生成图片-${record.id.slice(0, 8)}.png`,
    }
  }
  if (ref.kind === 'asset') {
    const asset = await inspectAsset(ref.id)
    if (asset.mediaType !== 'image') throw new Error('INVALID_INPUT')
    return {
      ref,
      source: asset.filePath,
      name: asset.displayName || `素材-${asset.id.slice(0, 8)}.png`,
    }
  }
  throw new Error('INVALID_INPUT')
}

function openImageEditor(source: ResolvedImageSource, document?: ReturnType<typeof parseImageEditDocument>): string {
  const sessionRef = `image-edit-session:${source.ref.kind}:${source.ref.id}`
  offerImageEditorHandoff({
    sessionRef,
    sourceUrl: source.source,
    sourceName: source.name,
    document,
  })
  switchWorkspace('tools')
  selectToolboxTool('imageMark')
  return sessionRef
}

export async function openImageEditorWithSource(
  sourceRef: ApplicationRef
): Promise<Record<string, unknown>> {
  logger.debug('image_editor.open.start', {
    event: 'assistant.image_editor.open.start',
    sourceKind: sourceRef.kind,
    sourceId: sourceRef.id,
  })
  const source = await resolveImageSource(sourceRef)
  const sessionRef = openImageEditor(source)
  logger.info('image_editor.open.completed', {
    event: 'assistant.image_editor.open.completed',
    sourceKind: sourceRef.kind,
    sourceId: sourceRef.id,
    sessionRef,
  })
  return {
    sourceRef,
    sessionRef,
    surfaceId: 'tool.image_edit',
  }
}

export async function createImageEditPreviewFromRef(input: {
  sourceRef: ApplicationRef
  operations: Record<string, unknown>[]
}): Promise<Record<string, unknown>> {
  logger.debug('image_editor.preview.start', {
    event: 'assistant.image_editor.preview.start',
    sourceKind: input.sourceRef.kind,
    sourceId: input.sourceRef.id,
    operationCount: input.operations.length,
  })
  const source = await resolveImageSource(input.sourceRef)
  const preview = await createImageEditPreviewFromApplicationRef(
    `${input.sourceRef.kind}:${input.sourceRef.id}`,
    source.source,
    input.operations
  )
  const document = parseImageEditDocument(preview.document)
  const sessionRef = openImageEditor(source, document)
  logger.info('image_editor.preview.completed', {
    event: 'assistant.image_editor.preview.completed',
    sourceKind: input.sourceRef.kind,
    sourceId: input.sourceRef.id,
    previewRef: preview.previewRef,
  })
  return {
    previewRef: preview.previewRef,
    sourceRef: input.sourceRef,
    sessionRef,
    operationCount: preview.operationCount,
    hasEffect: preview.hasEffect,
    width: preview.width,
    height: preview.height,
    surfaceId: 'tool.image_edit',
  }
}
