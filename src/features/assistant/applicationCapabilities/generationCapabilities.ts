import type { ApplicationRef } from '@/core/assistant/applicationCapabilities'
import type { ImageEditDocument } from '@/core/imageEdit'
import { createLogger } from '@/core/logging'
import { inspectAsset } from '@/commands/assetLibrary'
import { readImageInfo } from '@/commands/image'
import { offerImageEditorHandoff } from '@/features/imageEdit/store/imageEditorHandoffStore'
import { databaseService } from '@/services/database'
import { convertPathString, getDataRoot } from '@/utils/dataPath'
import { getModelDisplayName } from '@/utils/modelHelpers'
import {
  matchesGenerationHistoryFilter,
  toGenerationHistoryTimestamp,
  type GenerationHistoryFilterCriteria,
  type GenerationHistorySubject,
} from '@/features/generation/domain/generationHistoryFilter'

import { createImageEditPreview } from '@/features/imageEdit/application/imageEditApplicationService'
import { getStoredImageEditPreview } from '@/features/imageEdit/application/imageEditSessionRegistry'
import type { CapabilityExecutionContext } from './handlerTypes'
import { openApplicationSurface } from './surfaceRegistry'

const logger = createLogger('features.assistant.generation_capabilities')

interface ResolvedImageSource {
  ref: ApplicationRef
  source: string
  name: string
  document?: ImageEditDocument
}

type HistoryRecord = Awaited<ReturnType<typeof databaseService.getHistory>>[number]

function getStoredResultUrl(record: HistoryRecord): string | null {
  const value = record.params['__resultUrl']
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function getLastSource(sourceList: string | null | undefined): string | null {
  if (!sourceList) return null
  const sources = sourceList
    .split('|||')
    .map((source) => source.trim())
    .filter(Boolean)
  return sources.length > 0 ? sources[sources.length - 1] : null
}

async function resolveReadableGenerationImage(record: HistoryRecord): Promise<{
  source: string
  name: string
}> {
  const dataRoot = await getDataRoot()
  const absolutePathList = record.filePath
    ? await convertPathString(record.filePath, dataRoot, false)
    : null
  const candidates = [
    getLastSource(absolutePathList),
    getLastSource(getStoredResultUrl(record)),
  ].filter((source, index, sources): source is string => (
    Boolean(source) && sources.indexOf(source) === index
  ))

  for (const source of candidates) {
    try {
      const info = await readImageInfo(source)
      return {
        source,
        name: info.fileName || `生成图片-${record.id.slice(0, 8)}.${info.extension || 'png'}`,
      }
    } catch {
      // 本地副本可能失效，但历史记录仍可能保留可读取的远程结果；继续尝试下一个候选。
    }
  }

  logger.warn('generation_history.image_source.unavailable', {
    event: 'assistant.generation_history.image_source.unavailable',
    historyId: record.id,
    candidateCount: candidates.length,
  })
  throw new Error('NOT_FOUND')
}

function publicHistoryRecord(record: Awaited<ReturnType<typeof databaseService.getHistory>>[number]): Record<string, unknown> {
  const hasResult = Boolean(record.filePath || getStoredResultUrl(record))
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

function toFilterSubject(record: HistoryRecord): GenerationHistorySubject {
  return {
    prompt: record.prompt ?? null,
    modelId: record.modelId,
    modelDisplayName: getModelDisplayName(record.modelId),
    providerId: record.providerId ?? null,
    errorText: null,
    mediaType: record.type,
    createdAt: toGenerationHistoryTimestamp(record.createdAt),
  }
}

export async function listGenerationHistory(input: {
  mediaType?: 'image' | 'video' | 'audio'
  status?: 'success' | 'completed' | 'error' | 'failed'
  keyword?: string
  providerId?: string
  modelId?: string
  timePreset?: GenerationHistoryFilterCriteria['timePreset']
  startDate?: string
  endDate?: string
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
    const criteria: GenerationHistoryFilterCriteria = {
      keyword: input.keyword,
      providerId: input.providerId,
      modelId: input.modelId,
      // mediaType 已经在数据库查询里按类型过滤过，谓词这层不必再判一次。
      timePreset: input.timePreset,
      startDate: input.startDate,
      endDate: input.endDate,
    }
    const needsPostFilter = Boolean(
      input.status || input.keyword || input.providerId || input.modelId || input.timePreset,
    )
    const records = await databaseService.getHistory({
      type: input.mediaType,
      // success/completed 与 error/failed 是同义终态，且关键词/时间等维度数据库层不支持。
      // 先按时间多读一些再在内存里归一过滤，避免模型加了筛选条件就漏掉真正最新的记录。
      limit: needsPostFilter ? Math.min(120, input.limit * 4) : input.limit,
    })
    const statusGroup = input.status === 'success' || input.status === 'completed'
      ? new Set(['success', 'completed'])
      : input.status === 'error' || input.status === 'failed'
        ? new Set(['error', 'failed'])
        : null
    // 与界面共用同一个谓词：用户能筛出来的，助手也筛得出来，且条数一致。
    const now = Date.now()
    const selectedRecords = needsPostFilter
      ? records
        .filter((record) => (statusGroup ? statusGroup.has(record.status) : true))
        .filter((record) => matchesGenerationHistoryFilter(toFilterSubject(record), criteria, now))
        .slice(0, input.limit)
      : records
    logger.info('generation_history.list.completed', {
      event: 'assistant.generation_history.list.completed',
      count: selectedRecords.length,
    })
    return { records: selectedRecords.map(publicHistoryRecord) }
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
