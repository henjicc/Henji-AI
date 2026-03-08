import { useEffect } from 'react'
import { logError, logInfo } from '@/utils/errorLogger'
import type { ModelState } from '../state/useModelState'
import type { UIState } from '../state/useUIState'

interface ReEditEventDetail {
  prompt?: string
  images?: string[]
  uploadedFilePaths?: string[]
  videos?: string[]
  uploadedVideoFilePaths?: string[]
  model?: string
  provider?: string
  options?: Record<string, unknown>
}

function sanitizePresetOptions(options: Record<string, unknown>): Record<string, unknown> {
  const paramsToSet = { ...options }
  delete paramsToSet.images
  delete paramsToSet.uploadedFilePaths
  delete paramsToSet.videos
  delete paramsToSet.uploadedVideoFilePaths
  delete paramsToSet.uploadedImages
  delete paramsToSet.uploadedVideos
  delete paramsToSet.editStateFile
  delete paramsToSet.imageEditStates
  return paramsToSet
}

export function useReeditContent(uiState: UIState, modelState: ModelState): void {
  useEffect(() => {
    const handleReedit = async (e: Event) => {
      const customEvent = e as CustomEvent<ReEditEventDetail>
      const {
        prompt,
        images,
        uploadedFilePaths,
        videos,
        uploadedVideoFilePaths,
        model,
        provider,
        options
      } = customEvent.detail

      logInfo('[MediaGenerator] Handle re-edit:', { model, provider })

      if (prompt !== undefined) uiState.setInput(prompt)
      if (provider) uiState.setSelectedProvider(provider)
      if (model) uiState.setSelectedModel(model)

      if (images) uiState.setUploadedImages(images)
      if (uploadedFilePaths) uiState.setUploadedFilePaths(uploadedFilePaths)

      if (uploadedVideoFilePaths && Array.isArray(uploadedVideoFilePaths) && uploadedVideoFilePaths.length > 0) {
        logInfo('[MediaGenerator] Restoring videos from paths:', uploadedVideoFilePaths)
        try {
          const { readFile } = await import('@tauri-apps/plugin-fs')
          const { generateVideoThumbnail } = await import('@/utils/videoProcessing')

          const restorePromises = uploadedVideoFilePaths.map(async (filePath: string, index: number) => {
            try {
              const bytes = await readFile(filePath)
              const blob = new Blob([bytes], { type: 'video/mp4' })
              const file = new File([blob], `video-restored-${index}.mp4`, { type: 'video/mp4' })
              const thumbnail = await generateVideoThumbnail(file, 1.0)
              logInfo('[MediaGenerator] 视频恢复成功:', { path: filePath, thumbnailLength: thumbnail.length })
              return { file, thumbnail, path: filePath }
            } catch (error) {
              logError('[MediaGenerator] 视频恢复失败:', { path: filePath, error })
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
          logError('[MediaGenerator] 批量恢复视频失败:', error)
        }
      } else if (videos && Array.isArray(videos) && videos.length > 0) {
        logInfo('[MediaGenerator] Restoring videos from legacy videos array', {})
        uiState.setUploadedVideos(videos)
        uiState.setUploadedVideoFilePaths([])
        uiState.setUploadedVideoFiles([])
      }

      window.setTimeout(() => {
        if (!options) return
        const sanitizedOptions = sanitizePresetOptions(options)
        logInfo('[MediaGenerator] Restore params:', sanitizedOptions)
        modelState.setParams(sanitizedOptions)
      }, 100)
    }

    window.addEventListener('reedit-content', handleReedit)
    return () => window.removeEventListener('reedit-content', handleReedit)
  }, [modelState, uiState])
}
