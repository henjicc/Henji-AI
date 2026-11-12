

import { createLogger } from '@/core/logging/index'

import { databaseService } from '@/services/database/index'

import { getModelDisplayName } from '@/utils/modelHelpers'
import { readStoredResultUrls } from '@/features/generation/domain/storedResultUrls'
import { matchesGenerationHistoryFilter, toGenerationHistoryTimestamp, type GenerationHistoryFilterCriteria, type GenerationHistorySubject } from '@/features/generation/domain/generationHistoryFilter'

const logger = createLogger('features.generation.history')

type HistoryRecord = Awaited<ReturnType<typeof databaseService.getHistory>>[number]


function publicHistoryRecord(record: Awaited<ReturnType<typeof databaseService.getHistory>>[number]): Record<string, unknown> {
  const hasResult = Boolean(record.resultPaths.length > 0 || readStoredResultUrls(record.params).length > 0)
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
    origin: record.params.__canvasGeneration ? 'canvas' : 'generation',
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
  origin?: 'generation' | 'canvas' | 'all'
  limit: number
}): Promise<{ records: Record<string, unknown>[] }> {
  logger.debug('generation_history.list.start', {
    event: 'assistant.generation_history.list.start',
    mediaType: input.mediaType,
    status: input.status,
    limit: input.limit,
  })
  try {
    const criteria: GenerationHistoryFilterCriteria = {
      keyword: input.keyword,
      providerId: input.providerId,
      modelId: input.modelId,
      // mediaType 已经在数据库查询里按类型过滤过，谓词这层不必再判一次。
      timePreset: input.timePreset,
      startDate: input.startDate,
      endDate: input.endDate,
    }
    const origin = input.origin ?? 'all'
    // success/completed 与 error/failed 是同义终态，一起交给数据库查。
    const statuses: HistoryRecord['status'][] | undefined = input.status === 'success' || input.status === 'completed'
      ? ['success', 'completed']
      : input.status === 'error' || input.status === 'failed' ? ['error', 'failed'] : undefined
    const query = { type: input.mediaType, providerId: input.providerId, modelId: input.modelId, statuses }
    // 关键词（含模型显示名）、时间段与来源数据库层不支持，只能读出后在内存里筛：按时间从新到旧逐页读，
    // 凑够条数或读完为止，更早的匹配记录也查得到。
    const needsPostFilter = Boolean(input.keyword || input.timePreset || input.startDate || input.endDate || origin !== 'all')
    const now = Date.now()
    const selectedRecords: HistoryRecord[] = []
    // 翻页期间有新记录写入时整体后移，上一页末尾的记录会再出现一次。
    const seen = new Set<string>()
    const pageSize = needsPostFilter ? Math.max(200, input.limit * 4) : input.limit
    for (let offset = 0; selectedRecords.length < input.limit; offset += pageSize) {
      const page = await databaseService.getHistory({ ...query, limit: pageSize, offset })
      // 与界面共用同一个谓词：用户能筛出来的，助手也筛得出来，且条数一致。
      for (const record of page) {
        if (selectedRecords.length >= input.limit) break
        if (seen.has(record.id)) continue
        seen.add(record.id)
        if (needsPostFilter && (
          (origin !== 'all' && (origin === 'canvas') !== Boolean(record.params.__canvasGeneration))
          || !matchesGenerationHistoryFilter(toFilterSubject(record), criteria, now))) continue
        selectedRecords.push(record)
      }
      if (page.length < pageSize) break
    }
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
