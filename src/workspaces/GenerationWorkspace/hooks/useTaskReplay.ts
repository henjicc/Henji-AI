import { createLogger } from '@/core/logging'
import { useCallback } from 'react'
import { toDisplaySrc } from '@/platform/desktopApi'
import { coerceImageEditSession, type ImageEditSession } from '@/core/imageEdit'
import { loadEditState } from '@/utils/editStatePersistence'
import type { GenerationTask, GeneratorOptions, MediaType } from '../types'
import { isRecord, isStringArray } from '../utils/typeGuards'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.useTaskReplay')

export interface UseTaskReplayParams {
  handleGenerate: (input: string, model: string, type: MediaType, options?: DynamicValue) => Promise<void>
  imageEditStatesRef: React.MutableRefObject<Map<string, ImageEditSession>>
}

export interface UseTaskReplayReturn {
  handleRegenerate: (task: GenerationTask) => Promise<void>
  handleReedit: (task: GenerationTask) => void
}

function cloneOptions(options?: GeneratorOptions): GeneratorOptions {
  return { ...(options ?? {}) }
}

/** 兼容旧 ImageEditState、ImageMarkSession 与 V2 ImageEditSession 落盘格式。 */
function restoreEditStates(
  states: DynamicValue,
  images: string[],
  imageEditStatesRef: React.MutableRefObject<Map<string, ImageEditSession>>
): void {
  if (!isRecord(states)) return
  for (const [key, value] of Object.entries(states)) {
    const index = Number.parseInt(key, 10)
    if (Number.isFinite(index) && images[index]) {
      imageEditStatesRef.current.set(images[index], coerceImageEditSession(value, images[index]))
      continue
    }
    if (typeof key === 'string' && images.includes(key)) {
      imageEditStatesRef.current.set(key, coerceImageEditSession(value, key))
    }
  }
}

async function restoreEditStatesFromFile(
  editStateFile: string,
  images: string[],
  imageEditStatesRef: React.MutableRefObject<Map<string, ImageEditSession>>
): Promise<void> {
  try {
    const statesUnknown = await loadEditState(editStateFile)
    if (!statesUnknown) return
    restoreEditStates(statesUnknown, images, imageEditStatesRef)
  } catch (e) {
    logger.error('[Workspace] 从文件恢复编辑状态失败', e)
  }
}

export function useTaskReplay({ handleGenerate, imageEditStatesRef }: UseTaskReplayParams): UseTaskReplayReturn {
  const handleRegenerate = useCallback(async (task: GenerationTask): Promise<void> => {
    const options = cloneOptions(task.options)

    const uploadedFilePaths = task.uploadedFilePaths?.filter((p) => p && p.trim().length > 0) ?? []
    const uploadedVideoFilePaths = task.uploadedVideoFilePaths?.filter((p) => p && p.trim().length > 0) ?? []
    const uploadedAudioFilePaths = task.uploadedAudioFilePaths?.filter((p) => p && p.trim().length > 0) ?? []

    if (uploadedFilePaths.length > 0) {
      options.uploadedFilePaths = uploadedFilePaths
      if (!isStringArray(options.images) || options.images.length === 0) {
        options.images = uploadedFilePaths.map((p) => toDisplaySrc(p))
      }
    }

    if (uploadedVideoFilePaths.length > 0) {
      options.uploadedVideoFilePaths = uploadedVideoFilePaths
      if (!('video' in options)) {
        options.video = toDisplaySrc(uploadedVideoFilePaths[0])
      }
    }

    if (uploadedAudioFilePaths.length > 0) {
      options.uploadedAudioFilePaths = uploadedAudioFilePaths
      if (!isStringArray(options.audios) || options.audios.length === 0) {
        options.audios = uploadedAudioFilePaths.map((p) => toDisplaySrc(p))
      }
    }

    const images = isStringArray(options.images) ? options.images : []

    if (typeof options.editStateFile === 'string' && options.editStateFile.trim().length > 0 && images.length > 0) {
      await restoreEditStatesFromFile(options.editStateFile, images, imageEditStatesRef)
      logger.info('[Workspace] 已从文件恢复编辑状态', { file: options.editStateFile, count: images.length })
    } else if (options.imageEditStates && images.length > 0) {
      restoreEditStates(options.imageEditStates, images, imageEditStatesRef)
    }

    await handleGenerate(task.prompt, task.model, task.type, options)
  }, [handleGenerate, imageEditStatesRef])

  const handleReedit = useCallback((task: GenerationTask): void => {
    const detail = {
      prompt: task.prompt,
      images: task.images,
      uploadedFilePaths: task.uploadedFilePaths,
      uploadedVideoFilePaths: task.uploadedVideoFilePaths,
      uploadedAudioFilePaths: task.uploadedAudioFilePaths,
      model: task.model,
      provider: task.provider,
      options: task.options,
    }

    window.dispatchEvent(new CustomEvent('reedit-content', { detail }))
  }, [])

  return { handleRegenerate, handleReedit }
}
