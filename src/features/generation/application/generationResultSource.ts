import { readImageInfo } from '@/commands/image'
import { createLogger } from '@/core/logging'
import { databaseService } from '@/services/database'
import { convertPathString, getDataRoot } from '@/utils/dataPath'
const logger = createLogger('features.generation.result_source')
type HistoryRecord = Awaited<ReturnType<typeof databaseService.getHistory>>[number]
/** 持久历史是结果复用的真相源，不依赖生成页是否挂载或内存任务列表。 */
export async function readGenerationResultMedia(id: string, expectedType?: 'image' | 'video' | 'audio') {
  await databaseService.init()
  const record = await databaseService.getHistoryById(id)
  if (!record) return null
  if (!['success', 'completed'].includes(record.status)) throw new Error('NOT_FOUND:生成结果尚未成功，请查询原任务状态。')
  if (expectedType && record.type !== expectedType) throw new Error(`INVALID_INPUT:媒体类型应为 ${expectedType}，实际为 ${record.type}。`)
  const source = record.type === 'image'
    ? (await resolveReadableGenerationImage(record)).source
    : await convertPathString(getLastSource(record.filePath) ?? getLastSource(getStoredResultUrl(record)) ?? '', await getDataRoot(), false)
  if (!source) throw new Error('NOT_FOUND:生成记录没有可引用的媒体。')
  return { mediaType: record.type, source, name: record.prompt?.trim() || '生成结果' }
}
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

export async function resolveReadableGenerationImage(record: HistoryRecord): Promise<{
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

