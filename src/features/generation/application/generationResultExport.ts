import { registry } from '@/core/ModelRegistry'
import { createLogger } from '@/core/logging'
import { databaseService } from '@/services/database'
import { basename, copyFile, dirname, exists, join, readDir, writeZip } from '@/platform/desktopApi'
import { resolveModelName } from '@/utils/modelHelpers'
import { createExportNameAllocator, generationExportBaseName } from '../domain/generationExportName'

const logger = createLogger('features.generation.result_export')

/** 一条生成记录里的一个结果。 */
export interface GenerationResultSelection {
  recordId: string
  outputIndex: number
}

export type GenerationExportDestination =
  | { mode: 'folder'; directory: string }
  | { mode: 'zip'; path: string }

export interface GenerationExportFailure extends GenerationResultSelection {
  reason: string
}

export interface GenerationExportReport {
  destination: GenerationExportDestination
  /** 文件夹：每个写出文件的完整路径；ZIP：包内条目名。 */
  savedFiles: string[]
  failed: GenerationExportFailure[]
}

const FALLBACK_EXTENSION = { image: 'png', video: 'mp4', audio: 'mp3' } as const

function extensionOf(filePath: string): string {
  return filePath.split(/[\\/]/).pop()?.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? ''
}

function isLocalAbsolutePath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(value)
}

function modelName(modelId: string): string {
  const model = registry.getModel(modelId)
  return model ? resolveModelName(model) : modelId
}

interface ResolvedResult extends GenerationResultSelection {
  source: string
  baseName: string
  extension: string
}

/** 按记录读历史真相源；没有落到本地的结果（只剩远程地址、文件被移走）记为失败，不去网络下载。 */
async function resolveResults(results: readonly GenerationResultSelection[]): Promise<{ resolved: ResolvedResult[]; failed: GenerationExportFailure[] }> {
  const resolved: ResolvedResult[] = []
  const failed: GenerationExportFailure[] = []
  const records = new Map<string, Awaited<ReturnType<typeof databaseService.getHistoryById>>>()
  for (const result of results) {
    if (!records.has(result.recordId)) records.set(result.recordId, await databaseService.getHistoryById(result.recordId))
    const record = records.get(result.recordId)
    const source = record?.resultPaths[result.outputIndex]
    if (!record || !source || !isLocalAbsolutePath(source)) {
      failed.push({ ...result, reason: record ? '这个结果没有保存在本机' : '找不到这条生成记录' })
      continue
    }
    if (!await exists(source)) {
      failed.push({ ...result, reason: '结果文件已被移动或删除' })
      continue
    }
    resolved.push({
      ...result,
      source,
      extension: extensionOf(source) || FALLBACK_EXTENSION[record.type],
      baseName: generationExportBaseName({
        createdAt: new Date(record.createdAt),
        modelName: modelName(record.modelId),
        prompt: record.prompt,
        outputIndex: result.outputIndex,
        outputCount: record.resultPaths.length,
      }),
    })
  }
  return { resolved, failed }
}

async function existingNames(directory: string): Promise<string[]> {
  try {
    return (await readDir(directory)).map(entry => entry.name)
  } catch {
    // 目录还不存在：复制时会一并建好
    return []
  }
}

/**
 * 把选中的生成结果放进一个文件夹，或打成一个 ZIP。文件按“日期_模型_提示词开头_序号”命名，
 * 与已有文件（包括同名 ZIP）重名时顺延编号，不覆盖。找不到、没存到本机的结果逐个记为失败，其余照常导出；
 * ZIP 写出途中出错则整个包不生成，目标位置保持原样。报告里的 destination 是实际写出的位置。
 */
export async function exportGenerationResults(results: readonly GenerationResultSelection[], destination: GenerationExportDestination): Promise<GenerationExportReport> {
  // 相对路径会落到程序当前目录（开发时就是仓库根目录），导出目标必须是完整的本机路径
  if (!isLocalAbsolutePath(destination.mode === 'folder' ? destination.directory : destination.path)) {
    throw new Error('INVALID_INPUT:导出位置要写完整的本机路径')
  }
  logger.info('生成结果导出开始', { event: 'generation.result_export.start', mode: destination.mode, count: results.length })
  try {
    const { resolved, failed } = await resolveResults(results)
    const savedFiles: string[] = []
    let written = destination
    if (destination.mode === 'folder') {
      const allocate = createExportNameAllocator(await existingNames(destination.directory))
      for (const result of resolved) {
        try {
          const target = await join(destination.directory, allocate(result.baseName, result.extension))
          await copyFile(result.source, target)
          savedFiles.push(target)
        } catch (error) {
          failed.push({ recordId: result.recordId, outputIndex: result.outputIndex, reason: error instanceof Error ? error.message : String(error) })
        }
      }
    } else if (resolved.length > 0) {
      const allocate = createExportNameAllocator([])
      const entries = resolved.map(result => ({ source: result.source, name: allocate(result.baseName, result.extension) }))
      // 同名包已存在时另起“名称 (2).zip”，从不覆盖已有文件
      const directory = await dirname(destination.path)
      const zipName = createExportNameAllocator(await existingNames(directory))(basename(destination.path, '.zip').replace(/\.zip$/i, ''), 'zip')
      const zipPath = await join(directory, zipName)
      await writeZip(zipPath, entries)
      savedFiles.push(...entries.map(entry => entry.name))
      written = { mode: 'zip', path: zipPath }
    }
    logger.info('生成结果导出完成', { event: 'generation.result_export.completed', mode: destination.mode, saved: savedFiles.length, failed: failed.length })
    return { destination: written, savedFiles, failed }
  } catch (error) {
    logger.error('生成结果导出失败', { event: 'generation.result_export.failed', mode: destination.mode, count: results.length, error })
    throw error
  }
}
