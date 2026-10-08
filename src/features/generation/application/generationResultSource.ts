import { readImageInfo } from '@/commands/image'
import { createLogger } from '@/core/logging'
import { databaseService } from '@/services/database'
import { readStoredResultUrls } from '@/features/generation/domain/storedResultUrls'
import { generatedMediaName } from '@/core/documents/generatedMediaName'
const logger = createLogger('features.generation.result_source')
type HistoryRecord = Awaited<ReturnType<typeof databaseService.getHistory>>[number]
export interface GenerationResultMediaSelection { outputIndex: number; localOnly?: boolean }
export interface GenerationResultMedia { mediaType: 'image' | 'video' | 'audio'; source: string; name: string; prompt: string }
/** 持久历史是结果复用的真相源，不依赖生成页是否挂载或内存任务列表。 */
export async function readGenerationResultMedia(id: string, expectedType?: 'image' | 'video' | 'audio', selection?: GenerationResultMediaSelection): Promise<GenerationResultMedia | null> {
  const record = await databaseService.getHistoryById(id)
  if (!record) return null
  if (!['success', 'completed'].includes(record.status)) throw new Error('NOT_FOUND:生成结果尚未成功，请查询原任务状态。')
  if (expectedType && record.type !== expectedType) throw new Error(`INVALID_INPUT:媒体类型应为 ${expectedType}，实际为 ${record.type}。`)
  if (selection) {
    if (!Number.isSafeInteger(selection.outputIndex) || selection.outputIndex < 0) throw new Error('INVALID_INPUT:请选择已保存结果的有效序号。')
    const source = record.resultPaths[selection.outputIndex] ?? (!selection.localOnly ? readStoredResultUrls(record.params)[selection.outputIndex] : undefined)
    if (!source || selection.localOnly && !/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(source)) throw new Error('NOT_FOUND:所选结果尚未保存到本地，请先完成原结果保存。')
    return { mediaType: record.type, source, name: generatedMediaName(record.prompt), prompt: record.prompt ?? '' }
  }
  const source = record.type === 'image'
    ? (await resolveReadableGenerationImage(record)).source
    : record.resultPaths.at(-1) ?? readStoredResultUrls(record.params).at(-1) ?? null
  if (!source) throw new Error('NOT_FOUND:生成记录没有可引用的媒体。')
  return { mediaType: record.type, source, name: generatedMediaName(record.prompt), prompt: record.prompt ?? '' }
}

export async function resolveReadableGenerationImage(record: HistoryRecord): Promise<{
  source: string
  name: string
}> {
  const candidates = [
    record.resultPaths.at(-1) ?? null,
    readStoredResultUrls(record.params).at(-1) ?? null,
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

