import { createLogger } from '@/core/logging'
import { useCallback } from 'react'
import { toDisplaySrc as convertFileSrc } from '@/platform/desktopApi'
import type { ImageEditState } from '@/components/ImageEditor'
import { loadEditState } from '@/utils/editStatePersistence'
import type { GenerationTask, GeneratorOptions, MediaType } from '../types'
import { isRecord, isStringArray } from '../utils/typeGuards'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.useTaskReplay')

export interface UseTaskReplayParams {
  handleGenerate: (input: string, model: string, type: MediaType, options?: unknown) => Promise<void>
  imageEditStatesRef: React.MutableRefObject<Map<string, ImageEditState>>
}

export interface UseTaskReplayReturn {
  handleRegenerate: (task: GenerationTask) => Promise<void>
  handleReedit: (task: GenerationTask) => void
}

function cloneOptions(options?: GeneratorOptions): GeneratorOptions {
  return { ...(options ?? {}) }
}

async function restoreEditStatesFromFile(
  editStateFile: string,
  images: string[],
  imageEditStatesRef: React.MutableRefObject<Map<string, ImageEditState>>
): Promise<void> {
  try {
    const statesUnknown = await loadEditState(editStateFile)
    if (!statesUnknown || !isRecord(statesUnknown)) return

    for (const [key, value] of Object.entries(statesUnknown)) {
      const index = Number.parseInt(key, 10)
      if (Number.isFinite(index) && images[index]) {
        imageEditStatesRef.current.set(images[index], value as ImageEditState)
        continue
      }
      if (typeof key === 'string' && images.includes(key)) {
        imageEditStatesRef.current.set(key, value as ImageEditState)
      }
    }
  } catch (e) {
    logger.error('[Workspace] 从文件恢复编辑状态失败', e)
  }
}

function restoreEditStatesInline(
  inline: unknown,
  images: string[],
  imageEditStatesRef: React.MutableRefObject<Map<string, ImageEditState>>
): void {
  if (!isRecord(inline)) return
  for (const [key, value] of Object.entries(inline)) {
    const index = Number.parseInt(key, 10)
    if (Number.isFinite(index) && images[index]) {
      imageEditStatesRef.current.set(images[index], value as ImageEditState)
      continue
    }
    if (typeof key === 'string' && images.includes(key)) {
      imageEditStatesRef.current.set(key, value as ImageEditState)
    }
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
        options.images = uploadedFilePaths.map((p) => convertFileSrc(p))
      }
    }

    if (uploadedVideoFilePaths.length > 0) {
      options.uploadedVideoFilePaths = uploadedVideoFilePaths
      if (!('video' in options)) {
        options.video = convertFileSrc(uploadedVideoFilePaths[0])
      }
    }

    if (uploadedAudioFilePaths.length > 0) {
      options.uploadedAudioFilePaths = uploadedAudioFilePaths
      if (!isStringArray(options.audios) || options.audios.length === 0) {
        options.audios = uploadedAudioFilePaths.map((p) => convertFileSrc(p))
      }
    }

    const images = isStringArray(options.images) ? options.images : []

    if (typeof options.editStateFile === 'string' && options.editStateFile.trim().length > 0 && images.length > 0) {
      await restoreEditStatesFromFile(options.editStateFile, images, imageEditStatesRef)
      logger.info('[Workspace] 已从文件恢复编辑状态', { file: options.editStateFile, count: images.length })
    } else if (options.imageEditStates && images.length > 0) {
      restoreEditStatesInline(options.imageEditStates, images, imageEditStatesRef)
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


