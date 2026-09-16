

import { createLogger } from '@/core/logging/index'

import { databaseService } from '@/services/database/index'

import { getModelDisplayName } from '@/utils/modelHelpers'
import { matchesGenerationHistoryFilter, toGenerationHistoryTimestamp, type GenerationHistoryFilterCriteria, type GenerationHistorySubject } from '@/features/generation/domain/generationHistoryFilter'

const logger = createLogger('features.generation.history')

type HistoryRecord = Awaited<ReturnType<typeof databaseService.getHistory>>[number]

function getStoredResultUrl(record: HistoryRecord): string | null {
  const value = record.params['__resultUrl']
  return typeof value === 'string' && value.trim() ? value.trim() : null
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
