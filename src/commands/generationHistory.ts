import { getPlatform } from '@/platform'
import type {
  GenerationHistoryInsertDto,
  GenerationHistoryQuery,
  GenerationHistoryRecordDto,
  GenerationHistoryUpdateDto,
} from '@/platform/contracts/localRecords'

/*
 * 生成记录命令（存储底座 2.3）：表归主进程仓库，渲染层只经这里访问。
 * 结果文件是绝对路径数组；位置写法的换算在主进程完成。
 */

export async function listGenerationHistory(query?: GenerationHistoryQuery): Promise<GenerationHistoryRecordDto[]> {
  return await getPlatform().generationHistory.list(query)
}

export async function getGenerationHistory(id: string): Promise<GenerationHistoryRecordDto | null> {
  return await getPlatform().generationHistory.get(id)
}

export async function countGenerationHistory(): Promise<number> {
  return await getPlatform().generationHistory.count()
}

export async function insertGenerationHistory(record: GenerationHistoryInsertDto): Promise<void> {
  await getPlatform().generationHistory.insert(record)
}

export async function insertGenerationHistoryRecords(records: GenerationHistoryInsertDto[]): Promise<void> {
  await getPlatform().generationHistory.insertMany(records)
}

export async function updateGenerationHistory(id: string, updates: GenerationHistoryUpdateDto): Promise<void> {
  await getPlatform().generationHistory.update(id, updates)
}

export async function deleteGenerationHistory(id: string): Promise<void> {
  await getPlatform().generationHistory.delete(id)
}

export async function deleteGenerationHistoryRecords(ids: string[]): Promise<number> {
  return await getPlatform().generationHistory.deleteMany(ids)
}

export async function clearGenerationHistory(olderThan?: string): Promise<number> {
  return await getPlatform().generationHistory.clear(olderThan)
}
