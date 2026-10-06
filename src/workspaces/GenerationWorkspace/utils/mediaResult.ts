import { createLogger } from '@/core/logging'
import type { GenerationTask } from '../types'
import { toDisplaySrc } from '@/platform/desktopApi'
import { isDesktop, saveAudioFromUrl, saveImageFromUrl, saveVideoFromUrl } from '@/utils/save'

const logger = createLogger('workspaces.GenerationWorkspace.utils.mediaResult')

/** 一次生成的全部结果，按输出顺序：显示地址与本地文件一一对应（本地文件可能为空数组）。 */
export interface NormalizedMediaResult {
  urls: string[]
  filePaths: string[]
}

/** 本地结果文件 → 渲染层显示地址（按顺序）。 */
export function toDisplayUrlsFromFilePaths(filePaths: readonly string[]): string[] {
  return filePaths.map((filePath) => toDisplaySrc(filePath.replace(/\\/g, '/')))
}

const SAVE_BY_TYPE: Record<GenerationTask['type'], (url: string) => Promise<{ fullPath: string }>> = {
  image: saveImageFromUrl,
  video: saveVideoFromUrl,
  audio: saveAudioFromUrl,
}

export async function normalizeMediaResultForDesktop(
  task: GenerationTask,
  media: NormalizedMediaResult,
  logPrefix: string
): Promise<NormalizedMediaResult> {
  if (!isDesktop()) return { urls: [...media.urls], filePaths: [...media.filePaths] }

  if (media.filePaths.length > 0) {
    return { urls: toDisplayUrlsFromFilePaths(media.filePaths), filePaths: [...media.filePaths] }
  }

  if (media.urls.length === 0) return { urls: [], filePaths: [] }

  try {
    const save = SAVE_BY_TYPE[task.type]
    const filePaths: string[] = []
    for (const url of media.urls) {
      const { fullPath } = await save(url)
      filePaths.push(fullPath)
    }
    return { urls: toDisplayUrlsFromFilePaths(filePaths), filePaths }
  } catch (error) {
    logger.error(logPrefix, error)
    return { urls: [...media.urls], filePaths: [] }
  }
}
