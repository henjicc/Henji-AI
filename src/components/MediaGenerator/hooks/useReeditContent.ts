import { createLogger } from '@/core/logging'
import { useEffect, useState } from 'react'
import { readFile } from '@/platform/desktopApi'
import type { ModelState } from '../state/useModelState'
import type { UIState } from '../state/useUIState'
import type { PromptMediaBinding } from '@/core/inputs/promptDocument'
import { GENERATION_CONTINUATIONS_KEY } from '@/core/services/generationContinuations'

const logger = createLogger('components.MediaGenerator.hooks.useReeditContent')

interface ReEditEventDetail {
  prompt?: string
  promptDocument?: unknown
  promptMediaBindings?: PromptMediaBinding[]
  images?: string[]
  uploadedFilePaths?: string[]
  videos?: string[]
  uploadedVideoFilePaths?: string[]
  model?: string
  provider?: string
  options?: DynamicValueMap
  /** 清空输入区里已有的视频（续接不带源素材） */
  clearVideos?: boolean
}

function sanitizePresetOptions(options: DynamicValueMap): DynamicValueMap {
  const paramsToSet = { ...options }
  delete paramsToSet.images
  delete paramsToSet.uploadedFilePaths
  delete paramsToSet.videos
  delete paramsToSet.uploadedVideoFilePaths
  delete paramsToSet.uploadedImages
  delete paramsToSet.uploadedVideos
  delete paramsToSet.editStateFile
  delete paramsToSet.imageEditStates
  // 上一次结果的续接引用只属于那次结果；要续接时由结果卡片上的续接动作带进来。
  delete paramsToSet[GENERATION_CONTINUATIONS_KEY]
  return paramsToSet
}

export function useReeditContent(uiState: UIState, modelState: ModelState): void {
  const [pending, setPending] = useState<{ modelId: string; options: DynamicValueMap } | null>(null)
  const { setParams } = modelState
  // useModelParams 的模型切换 effect 已先重置参数，此处使用本次渲染的目标 schema 回填。
  useEffect(() => {
    if (!pending || uiState.selectedModel !== pending.modelId) return
    setParams(pending.options)
    setPending(null)
  }, [pending, uiState.selectedModel, setParams])
  useEffect(() => {
    const handleReedit = async (e: Event) => {
      const customEvent = e as CustomEvent<ReEditEventDetail>
      const {
        prompt,
        promptDocument,
        promptMediaBindings,
        images,
        uploadedFilePaths,
        videos,
        uploadedVideoFilePaths,
        model,
        provider,
        options,
        clearVideos
      } = customEvent.detail

      logger.info('[MediaGenerator] Handle re-edit:', { model, provider })
      setPending(options ? { modelId: model ?? uiState.selectedModel, options: sanitizePresetOptions(options) } : null)

      const hasImageCarrier = Boolean(promptMediaBindings?.length || images)
      const shouldLoadPromptCarrier = promptDocument !== undefined || (prompt !== undefined && hasImageCarrier)
      if (shouldLoadPromptCarrier) {
        uiState.loadPromptCarrier({
          document: promptDocument,
          legacyText: prompt ?? '',
          bindings: promptMediaBindings,
          legacyImages: images,
        })
      } else if (prompt !== undefined) {
        uiState.setInput(prompt)
      }
      if (provider) uiState.setSelectedProvider(provider)
      if (model) uiState.setSelectedModel(model)

      if (images && !shouldLoadPromptCarrier) uiState.setUploadedImages(images)
      if (uploadedFilePaths) uiState.setUploadedFilePaths(uploadedFilePaths)

      if (uploadedVideoFilePaths && Array.isArray(uploadedVideoFilePaths) && uploadedVideoFilePaths.length > 0) {
        logger.info('[MediaGenerator] Restoring videos from paths:', uploadedVideoFilePaths)
        try {
          const { generateVideoThumbnail } = await import('@/utils/videoProcessing')

          const restorePromises = uploadedVideoFilePaths.map(async (filePath: string, index: number) => {
            try {
              const bytes = await readFile(filePath)
              const blob = new Blob([bytes], { type: 'video/mp4' })
              const file = new File([blob], `video-restored-${index}.mp4`, { type: 'video/mp4' })
              const thumbnail = await generateVideoThumbnail(file, 1.0)
              logger.info('[MediaGenerator] 视频恢复成功:', { path: filePath, thumbnailLength: thumbnail.length })
              return { file, thumbnail, path: filePath }
            } catch (error) {
              logger.error('[MediaGenerator] 视频恢复失败:', { path: filePath, error })
              return null
            }
          })

          const results = await Promise.all(restorePromises)
          const validResults = results.filter((result): result is { file: File; thumbnail: string; path: string } => result !== null)

          if (validResults.length > 0) {
            uiState.setUploadedVideos(validResults.map(item => item.thumbnail))
            uiState.setUploadedVideoFiles(validResults.map(item => item.file))
            uiState.setUploadedVideoFilePaths(validResults.map(item => item.path))
          }
        } catch (error) {
          logger.error('[MediaGenerator] 批量恢复视频失败:', error)
        }
      } else if (clearVideos) {
        uiState.setUploadedVideos([])
        uiState.setUploadedVideoFiles([])
        uiState.setUploadedVideoFilePaths([])
      } else if (videos && Array.isArray(videos) && videos.length > 0) {
        logger.info('[MediaGenerator] Restoring videos from legacy videos array', {})
        uiState.setUploadedVideos(videos)
        uiState.setUploadedVideoFilePaths([])
        uiState.setUploadedVideoFiles([])
      }
    }

    window.addEventListener('reedit-content', handleReedit)
    return () => window.removeEventListener('reedit-content', handleReedit)
  }, [uiState])
}
