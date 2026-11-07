import { createLogger } from '@/core/logging'
import { useCallback } from 'react'
import { toDisplaySrc } from '@/platform/desktopApi'
import { coerceImageEditSessionData, type ImageEditSessionData } from '@/core/imageEdit'
import { loadEditState } from '@/utils/editStatePersistence'
import type { GenerationTask, GeneratorOptions, MediaType } from '../types'
import { prepareGenerationContinuation } from '@/core/services/generationContinuations'
import { registry } from '@/core/ModelRegistry'
import { isRecord, isStringArray } from '../utils/typeGuards'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.useTaskReplay')

export interface UseTaskReplayParams {
  handleGenerate: (input: string, model: string, type: MediaType, options?: DynamicValue) => Promise<void>
  imageEditStatesRef: React.MutableRefObject<Map<string, ImageEditSessionData>>
}

export interface UseTaskReplayReturn {
  handleRegenerate: (task: GenerationTask) => Promise<void>
  handleReedit: (task: GenerationTask) => void
  handleContinue: (task: GenerationTask, continuationId: string) => void
}

function cloneOptions(options?: GeneratorOptions): GeneratorOptions {
  return { ...(options ?? {}) }
}

/** 恢复明确的 V3 受管会话引用。 */
function restoreEditStates(
  states: DynamicValue,
  images: string[],
  imageEditStatesRef: React.MutableRefObject<Map<string, ImageEditSessionData>>
): void {
  if (!isRecord(states)) return
  for (const [key, value] of Object.entries(states)) {
    const index = Number.parseInt(key, 10)
    if (Number.isFinite(index) && images[index]) {
      imageEditStatesRef.current.set(images[index], coerceImageEditSessionData(value, images[index]))
      continue
    }
    if (typeof key === 'string' && images.includes(key)) {
      imageEditStatesRef.current.set(key, coerceImageEditSessionData(value, key))
    }
  }
}

async function restoreEditStatesFromFile(
  editStateFile: string,
  images: string[],
  imageEditStatesRef: React.MutableRefObject<Map<string, ImageEditSessionData>>
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

  // 续接：参数齐全的（草稿转正片）直接走再次生成的同一路径提交；要补写的（续写、做成视频）带进输入区。
  const handleContinue = useCallback((task: GenerationTask, continuationId: string): void => {
    const prepared = prepareGenerationContinuation(task.model, task.options, continuationId)
    const target = prepared ? registry.getModel(prepared.targetModelId) : undefined
    if (!prepared || !target) {
      logger.warn('[Workspace] 结果已不能续接', { taskId: task.id, continuationId })
      return
    }
    if (prepared.submit === 'direct') {
      // 续接靠平台引用，不重新上传源结果的素材。
      void handleRegenerate({
        ...task, model: prepared.targetModelId, type: target.meta.type as MediaType, options: prepared.params,
        images: [], videos: [], uploadedFilePaths: [], uploadedVideoFilePaths: [], uploadedAudioFilePaths: [],
      })
      return
    }
    window.dispatchEvent(new CustomEvent('reedit-content', { detail: {
      prompt: task.prompt,
      // 清掉输入区里原有的参考素材：续接靠平台引用，目标模型常常不收素材。
      images: [],
      uploadedFilePaths: [],
      clearVideos: true,
      model: prepared.targetModelId,
      provider: target.meta.provider,
      options: prepared.params,
    } }))
  }, [handleRegenerate])

  return { handleRegenerate, handleReedit, handleContinue }
}
