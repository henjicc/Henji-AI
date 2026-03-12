import type { GenerationTask } from '../types'
import { logError } from '@/utils/errorLogger'
import { convertFileSrc } from '@tauri-apps/api/core'
import { fileToBlobSrc, isDesktop, saveAudioFromUrl, saveImageFromUrl, saveVideoFromUrl } from '@/utils/save'
import { joinMulti, splitMulti } from './multiFile'

export interface NormalizedMediaResult {
  url: string | undefined
  filePath: string | undefined
}

function toTauriUrl(fullPath: string): string {
  return convertFileSrc(fullPath.replace(/\\/g, '/'))
}

export async function toDisplayUrlStringFromFilePath(
  filePath: string,
  type: GenerationTask['type']
): Promise<string> {
  const paths = splitMulti(filePath)
  if (type === 'video') {
    return joinMulti(paths.map((p) => toTauriUrl(p)))
  }
  const urls = await Promise.all(paths.map(async (p) => {
    try {
      return await fileToBlobSrc(p)
    } catch {
      return toTauriUrl(p)
    }
  }))
  return joinMulti(urls)
}

export async function normalizeMediaResultForDesktop(
  task: GenerationTask,
  media: NormalizedMediaResult,
  logPrefix: string
): Promise<NormalizedMediaResult> {
  const normalized: NormalizedMediaResult = { ...media }
  if (!isDesktop()) return normalized

  if (normalized.filePath) {
    normalized.url = await toDisplayUrlStringFromFilePath(normalized.filePath, task.type)
    return normalized
  }

  if (!normalized.url) return normalized

  try {
    if (task.type === 'image') {
      const urls = splitMulti(normalized.url)
      const paths: string[] = []
      for (const u of urls) {
        const { fullPath } = await saveImageFromUrl(u)
        paths.push(fullPath)
      }
      normalized.filePath = joinMulti(paths)
      normalized.url = await toDisplayUrlStringFromFilePath(normalized.filePath, task.type)
      return normalized
    }

    if (task.type === 'video') {
      const urls = splitMulti(normalized.url)
      const paths: string[] = []
      for (const u of urls) {
        const { fullPath } = await saveVideoFromUrl(u)
        paths.push(fullPath)
      }
      normalized.filePath = joinMulti(paths)
      normalized.url = await toDisplayUrlStringFromFilePath(normalized.filePath, task.type)
      return normalized
    }

    if (task.type === 'audio') {
      const { fullPath } = await saveAudioFromUrl(normalized.url)
      normalized.filePath = fullPath
      normalized.url = await toDisplayUrlStringFromFilePath(normalized.filePath, task.type)
    }
  } catch (error) {
    logError(logPrefix, error)
  }

  return normalized
}
