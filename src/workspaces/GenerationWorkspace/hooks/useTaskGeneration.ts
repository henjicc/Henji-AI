import { createLogger } from '@/core/logging'
import { useCallback, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { GenerationService } from '@/core/services/GenerationService'
import { registry } from '@/core/ModelRegistry'
import { taskQueueManager } from '@/services/taskQueue'
import {
  dataUrlToBlob,
  ensureCompressedJpegBytesWithPica,
  isDesktop,
  saveUploadAudio,
  saveBytesToUploads,
  saveBase64ToUploads,
  saveUploadVideo,
} from '@/utils/save'
import { getMediaDimensions, getMediaDurationFormatted } from '@/utils/mediaDimensions'
import { logRequestParams, shouldSkipRequest } from '@/utils/testMode'
import type { ImageEditState } from '@/components/ImageEditor'
import { saveEditState } from '@/utils/editStatePersistence'
import type { MediaType, GenerationTask, GeneratorOptions, ToastNotification } from '../types'
import { splitMulti } from '../utils/multiFile'
import { resolveProgressSettleDelayMs } from '../utils/progressAnimation'
import { isRecord, isStringArray } from '../utils/typeGuards'
import { extractServerTaskIdFromErrorMessage, extractServerTaskIdFromMetadata } from '../utils/taskServerId'
import { normalizeMediaResultForDesktop } from '../utils/mediaResult'
import { continuePollingTask } from './continuePollingTask'
import { voiceLibraryService } from '@/services/voiceLibrary/VoiceLibraryService'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.useTaskGeneration')

type GenerationProgressCallback = NonNullable<Parameters<GenerationService['generate']>[2]>
type GenerationProgressStatus = Parameters<GenerationProgressCallback>[0]

export interface UseTaskGenerationMessages {
  testModeIntercepted: string
  missingInput: string
  genericGenerateFailed: string
}

export interface UseTaskGenerationParams {
  setTasks: React.Dispatch<React.SetStateAction<GenerationTask[]>>
  updateTask: (taskId: string, updates: Partial<GenerationTask>) => void
  updateProgress: (taskId: string, progress: number) => void
  notify: (message: string, type?: ToastNotification['type']) => void
  messages: UseTaskGenerationMessages
  imageEditStatesRef: React.MutableRefObject<Map<string, ImageEditState>>
  setUploadedImagesRef: React.MutableRefObject<React.Dispatch<React.SetStateAction<string[]>> | null>
  setUploadedFilePathsRef: React.MutableRefObject<React.Dispatch<React.SetStateAction<string[]>> | null>
}

export interface UseTaskGenerationReturn {
  isGenerating: boolean
  handleGenerate: (input: string, model: string, type: MediaType, options?: unknown) => Promise<void>
  handleContinuePolling: (task: GenerationTask) => Promise<void>
}

function createTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

function getUserMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function maybeToUserMessage(error: unknown): string {
  if (!isRecord(error)) return getUserMessage(error)
  const toUserMessage = error['toUserMessage']
  if (typeof toUserMessage === 'function') {
    try {
      return String(toUserMessage.call(error))
    } catch {
      return getUserMessage(error)
    }
  }
  return getUserMessage(error)
}

function asGeneratorOptions(value: unknown): GeneratorOptions {
  return isRecord(value) ? (value as GeneratorOptions) : {}
}

function classifyMediaSourceKind(source: string): string {
  const trimmed = source.trim()
  if (!trimmed) return 'empty'
  if (trimmed.startsWith('data:')) return 'data-url'
  if (trimmed.startsWith('blob:')) return 'blob-url'
  if (trimmed.startsWith('asset://localhost/')) return 'asset-url'
  if (trimmed.startsWith('tauri://localhost/')) return 'tauri-url'
  if (trimmed.startsWith('http://asset.localhost/') || trimmed.startsWith('https://asset.localhost/')) {
    return 'asset-http-url'
  }
  if (trimmed.startsWith('http://tauri.localhost/') || trimmed.startsWith('https://tauri.localhost/')) {
    return 'tauri-http-url'
  }
  if (trimmed.startsWith('file://')) return 'file-url'
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return 'remote-url'
  if (/^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(trimmed)) return 'local-path'
  return 'other'
}

function summarizeMediaSources(values: unknown): Array<Record<string, unknown>> {
  if (!isStringArray(values)) {
    return []
  }

  return values.map((value, index) => ({
    index,
    kind: classifyMediaSourceKind(value),
    length: value.length,
    preview: value.startsWith('data:')
      ? value.slice(0, 48)
      : value.slice(0, 140),
  }))
}

function isFileValue(value: unknown): value is File {
  return typeof File !== 'undefined' && value instanceof File
}

function toVideoDisplayUrl(path: string): string {
  return convertFileSrc(path.replace(/\\/g, '/'))
}

function isLikelyVideoSource(value: string): boolean {
  const source = value.trim()
  if (!source) return false
  if (source.startsWith('data:video/')) return true
  if (source.startsWith('blob:')) return true
  if (source.startsWith('asset://localhost/')) return true
  if (source.startsWith('tauri://localhost/')) return true
  if (source.startsWith('file://')) return true
  if (source.startsWith('http://') || source.startsWith('https://')) return true
  return /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(source)
}

function normalizeNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function isMinimaxVoiceCloneMode(options: GeneratorOptions): boolean {
  return options.minimaxMode === 'voice-clone'
}

function asMutableRecord(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return { ...value }
  }
  return {}
}

function extractVoiceIdFromMetadata(metadata: unknown): string | undefined {
  if (!isRecord(metadata)) {
    return undefined
  }
  const direct = normalizeNonEmptyString(metadata.voice_id)
  if (direct) {
    return direct
  }
  if (isRecord(metadata.data)) {
    const nested = normalizeNonEmptyString(metadata.data.voice_id)
    if (nested) {
      return nested
    }
  }
  if (isRecord(metadata.task) && isRecord(metadata.task.output)) {
    const nested = normalizeNonEmptyString(metadata.task.output.voice_id)
    if (nested) {
      return nested
    }
  }
  return undefined
}

async function persistClonedVoiceIfNeeded(
  task: GenerationTask,
  options: GeneratorOptions,
  metadata: unknown
): Promise<void> {
  if (task.provider !== 'ppio' || !isMinimaxVoiceCloneMode(options)) {
    return
  }
  const voiceId = extractVoiceIdFromMetadata(metadata)
  if (!voiceId) {
    return
  }
  const cloneSettings = asMutableRecord(options.minimaxCloneSettings)
  const voiceName = normalizeNonEmptyString(options.minimaxCloneVoiceName)
    ?? normalizeNonEmptyString(cloneSettings.voiceName)
    ?? `克隆音色-${voiceId.slice(-6)}`
  const description = normalizeNonEmptyString(cloneSettings.promptText)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  await voiceLibraryService.upsertVoice({
    voiceId,
    voiceName,
    description,
    providerId: 'ppio',
    modelId: task.model,
    expiresAt,
  })
}

export function useTaskGeneration({
  setTasks,
  updateTask,
  updateProgress,
  notify,
  messages,
  imageEditStatesRef,
  setUploadedImagesRef,
  setUploadedFilePathsRef,
}: UseTaskGenerationParams): UseTaskGenerationReturn {
  const [isGenerating, setIsGenerating] = useState(false)
  const lastProgressRef = useRef<Record<string, number>>({})

  const generateWithService = useCallback(async (
    modelId: string,
    input: string,
    options: GeneratorOptions,
    onProgress?: GenerationProgressCallback
  ): Promise<unknown> => {
    const generationService = GenerationService.getInstance()
    const params: Record<string, unknown> = {
      prompt: input,
      text: input,
      ...options,
    }

    try {
      return await generationService.generate(modelId, params, onProgress)
    } catch (error) {
      throw new Error(maybeToUserMessage(error))
    }
  }, [])

  const executeTask = useCallback(async (taskId: string, task: GenerationTask): Promise<void> => {
    try {
      const options: GeneratorOptions = { ...(task.options ?? {}) }
      if (task.uploadedFilePaths) options.uploadedFilePaths = task.uploadedFilePaths
      if (task.uploadedVideoFilePaths) options.uploadedVideoFilePaths = task.uploadedVideoFilePaths
      if (task.images) options.images = task.images
      if (task.uploadedVideoFilePaths && task.uploadedVideoFilePaths.length > 0) {
        const videoUrls = task.uploadedVideoFilePaths.map(toVideoDisplayUrl)
        if (!isStringArray(options.videos) || options.videos.length === 0) {
          options.videos = videoUrls
        }
        if (typeof options.video !== 'string' || options.video.trim().length === 0) {
          options.video = videoUrls[0]
        }
        ;(options as Record<string, unknown>).uploadedVideos = options.videos

      }

      updateTask(taskId, { status: 'generating' })

      lastProgressRef.current[taskId] = 0
      const handleProgress: GenerationProgressCallback = (status: GenerationProgressStatus) => {
        if (status.progress === undefined) return
        const prev = lastProgressRef.current[taskId] ?? 0
        const next = Math.max(prev, status.progress)
        lastProgressRef.current[taskId] = next
        updateProgress(taskId, next)
      }

      const result = await generateWithService(task.model, task.prompt, options, handleProgress)
      const resultObj: Record<string, unknown> = isRecord(result) ? result : {}
      const metadata = resultObj['metadata']
      const serverTaskId = extractServerTaskIdFromMetadata(metadata)
        ?? (typeof resultObj['taskId'] === 'string' ? resultObj['taskId'] : undefined)
      if (serverTaskId) {
        updateTask(taskId, { serverTaskId })
      }
      logger.info('[Workspace] 生成响应', { model: task.model, taskId: serverTaskId, metadata })
      try {
        await persistClonedVoiceIfNeeded(task, options, metadata)
      } catch (error) {
        logger.warn('[Workspace] 保存克隆音色失败', error)
      }

      if (resultObj['status'] === 'pending') {
        if (!serverTaskId) {
          throw new Error(messages.genericGenerateFailed)
        }

        await continuePollingTask({
          task: {
            ...task,
            status: 'generating',
            serverTaskId,
            progress: lastProgressRef.current[taskId] ?? task.progress,
            options,
          },
          genericGenerateFailed: messages.genericGenerateFailed,
          notify,
          updateTask,
          updateProgress,
          toUserMessage: maybeToUserMessage,
        })
        return
      }

      const normalized = await normalizeMediaResultForDesktop(
        task,
        {
          url: typeof resultObj['url'] === 'string' ? resultObj['url'] : undefined,
          filePath: typeof resultObj['filePath'] === 'string' ? resultObj['filePath'] : undefined,
        },
        '[Workspace] 本地保存失败，回退在线地址'
      )
      const { url, filePath } = normalized

      if (!url) {
        logger.error('[Workspace] 生成响应缺少 URL', { model: task.model, result: resultObj })
        throw new Error(messages.genericGenerateFailed)
      }

      const firstCheck = filePath ? splitMulti(filePath)[0] : splitMulti(url)[0]
      const [dimensions, duration] = await Promise.all([
        getMediaDimensions(firstCheck, task.type),
        getMediaDurationFormatted(firstCheck, task.type),
      ])

      const progressBeforeComplete = lastProgressRef.current[taskId] ?? 0
      updateProgress(taskId, 100)
      await new Promise((r) => setTimeout(r, resolveProgressSettleDelayMs(progressBeforeComplete)))

      updateTask(taskId, {
        status: 'success',
        progress: 100,
        dimensions: dimensions ?? undefined,
        duration: duration ?? undefined,
        result: {
          id: taskId,
          type: task.type,
          url,
          filePath,
          prompt: task.prompt,
          createdAt: new Date(),
        },
      })
    } catch (error) {
      logger.error('[Workspace] 生成失败', error)
      const errorMessage = maybeToUserMessage(error) || messages.genericGenerateFailed
      const serverTaskIdFromError = extractServerTaskIdFromErrorMessage(errorMessage)
      updateTask(taskId, {
        status: 'error',
        error: errorMessage,
        ...(serverTaskIdFromError ? { serverTaskId: serverTaskIdFromError } : {}),
      })
    } finally {
      delete lastProgressRef.current[taskId]
    }
  }, [generateWithService, messages.genericGenerateFailed, notify, updateProgress, updateTask])

  const handleContinuePolling = useCallback(async (task: GenerationTask): Promise<void> => {
    await continuePollingTask({
      task,
      genericGenerateFailed: messages.genericGenerateFailed,
      notify,
      updateTask,
      updateProgress,
      toUserMessage: maybeToUserMessage,
    })
  }, [messages.genericGenerateFailed, notify, updateProgress, updateTask])

  const handleGenerate = useCallback(async (
    input: string,
    model: string,
    type: MediaType,
    optionsRaw?: unknown
  ): Promise<void> => {
    const options = asGeneratorOptions(optionsRaw)

    // 生成前处理 Base64 图片：落盘 + 压缩，避免历史记录膨胀
    if (isStringArray(options.images) && options.images.length > 0) {
      const images = [...options.images]
      const uploadedFilePaths = isStringArray(options.uploadedFilePaths)
        ? [...options.uploadedFilePaths]
        : new Array(images.length).fill('')

      let changed = false
      for (let i = 0; i < images.length; i++) {
        const img = images[i]
        if (!img.startsWith('data:')) continue

        try {
          const blob = await dataUrlToBlob(img)
          const jpegBytes = await ensureCompressedJpegBytesWithPica(blob)
          const saved = await saveBytesToUploads(jpegBytes, 'image/jpeg')

          const editState = imageEditStatesRef.current.get(img)
          if (editState) {
            let originalSrc = editState.originalSrc
            if (originalSrc.startsWith('data:')) {
              const savedOrg = await saveBase64ToUploads(originalSrc)
              originalSrc = savedOrg.displaySrc
            }

            const nextState: ImageEditState = {
              ...editState,
              imageId: saved.relativePath,
              originalSrc,
            }

            imageEditStatesRef.current.delete(img)
            imageEditStatesRef.current.set(saved.displaySrc, nextState)
          }

          images[i] = saved.displaySrc
          uploadedFilePaths[i] = saved.fullPath
          changed = true
        } catch (e) {
          logger.error('[Workspace] 延迟保存图片失败', e)
        }
      }

      if (changed) {
        options.images = images
        options.uploadedFilePaths = uploadedFilePaths
        setUploadedImagesRef.current?.(images)
        setUploadedFilePathsRef.current?.(uploadedFilePaths)
      }
    }

    // 生成前处理上传视频：持久化到 uploads，避免请求/历史记录中使用缩略图 data URL
    const uploadedVideoFilePaths = isStringArray(options.uploadedVideoFilePaths)
      ? [...options.uploadedVideoFilePaths]
      : []
    const inlineVideo = options.video

    if (isFileValue(inlineVideo) && uploadedVideoFilePaths.length === 0) {
      try {
        const savedVideo = await saveUploadVideo(inlineVideo, 'persist')
        uploadedVideoFilePaths.push(savedVideo.fullPath)
      } catch (error) {
        logger.error('[Workspace] 持久化上传视频失败', error)
        notify('视频保存失败，请重试上传后再生成', 'error')
        return
      }
    }

    if (uploadedVideoFilePaths.length > 0) {
      const videoSourceUrls = uploadedVideoFilePaths.map(toVideoDisplayUrl)
      options.uploadedVideoFilePaths = uploadedVideoFilePaths
      options.videos = videoSourceUrls
      ;(options as Record<string, unknown>).uploadedVideos = videoSourceUrls
      options.video = videoSourceUrls[0]
    }

    const sanitizedVideos = isStringArray(options.videos)
      ? options.videos.filter(isLikelyVideoSource)
      : []
    if (sanitizedVideos.length > 0) {
      options.videos = sanitizedVideos
      ;(options as Record<string, unknown>).uploadedVideos = sanitizedVideos
      if (typeof options.video !== 'string' || options.video.trim().length === 0) {
        options.video = sanitizedVideos[0]
      }
    } else {
      delete options.videos
      delete (options as Record<string, unknown>).uploadedVideos
      if (typeof options.video === 'string' && !isLikelyVideoSource(options.video)) {
        delete options.video
      }
    }

    if (isMinimaxVoiceCloneMode(options)) {
      const cloneAudioInput = asMutableRecord(options.minimaxCloneAudioInput)
      const cloneAudioFile = cloneAudioInput.cloneAudioFile
      if (isFileValue(cloneAudioFile)) {
        try {
          const savedAudio = await saveUploadAudio(cloneAudioFile, 'persist')
          options.minimaxCloneAudioFilePath = savedAudio.fullPath
        } catch (error) {
          logger.error('[Workspace] 持久化复刻音频失败', error)
          notify('复刻音频保存失败，请重新上传后再试', 'error')
          return
        }
      }
      delete cloneAudioInput.cloneAudioFile
      options.minimaxCloneAudioInput = cloneAudioInput

      const cloneSettings = asMutableRecord(options.minimaxCloneSettings)
      delete cloneSettings.cloneAudioUrl

      const promptAudioFile = cloneSettings.promptAudioFile
      if (isFileValue(promptAudioFile)) {
        try {
          const savedPromptAudio = await saveUploadAudio(promptAudioFile, 'persist')
          options.minimaxClonePromptAudioFilePath = savedPromptAudio.fullPath
        } catch (error) {
          logger.error('[Workspace] 持久化示例音频失败', error)
          notify('示例音频保存失败，请重新上传后再试', 'error')
          return
        }
      }
      delete cloneSettings.promptAudioFile
      delete cloneSettings.promptAudioUrl

      const cloneAudioPath = normalizeNonEmptyString(options.minimaxCloneAudioFilePath)
      if (!cloneAudioPath) {
        notify('音色克隆模式需要上传复刻音频文件', 'error')
        return
      }
      options.minimaxCloneAudioFilePath = cloneAudioPath

      const promptAudioPath = normalizeNonEmptyString(options.minimaxClonePromptAudioFilePath)
      if (promptAudioPath) {
        options.minimaxClonePromptAudioFilePath = promptAudioPath
      } else {
        delete options.minimaxClonePromptAudioFilePath
      }

      options.minimaxCloneSettings = cloneSettings
    }

    const hasAnyInput =
      input.trim().length > 0 ||
      (isStringArray(options.images) && options.images.length > 0) ||
      (isStringArray(options.videos) && options.videos.length > 0)
    if (!hasAnyInput) {
      notify(messages.missingInput, 'error')
      return
    }

    if (shouldSkipRequest()) {
      logRequestParams({ input, model, type, options, timestamp: new Date().toISOString() })
      notify(messages.testModeIntercepted, 'success')
      return
    }

    // 供应商信息（用于历史）
    const info: unknown = registry.getModelInfo(model)
    const providerId = isRecord(info) && typeof info['provider'] === 'string' ? info['provider'] : undefined

    // 视频缩略图：优先使用视频文件 URL，避免 <video> 无法渲染 base64 缩略图第一帧
    const taskUploadedVideoFilePaths = isStringArray(options.uploadedVideoFilePaths) ? options.uploadedVideoFilePaths : undefined
    const uploadedVideos = isStringArray(options.videos) ? options.videos : undefined
    const videoUrls = taskUploadedVideoFilePaths?.length
      ? taskUploadedVideoFilePaths.map(toVideoDisplayUrl)
      : uploadedVideos

    if (model === 'ppio-wan-2.5-preview') {
      logger.info('[Workspace] Wan 2.5 Preview 请求媒体输入', {
        model,
        images: summarizeMediaSources(options.images),
        uploadedFilePaths: summarizeMediaSources(options.uploadedFilePaths),
        videos: summarizeMediaSources(options.videos),
        uploadedVideoFilePaths: summarizeMediaSources(options.uploadedVideoFilePaths),
      })
    }

    const taskId = createTaskId()

    const imagesForState = isStringArray(options.images) ? options.images : []
    const imageEditStates = imagesForState.reduce<Record<string, ImageEditState>>((acc, url, index) => {
      const state = imageEditStatesRef.current.get(url)
      if (state) {
        acc[String(index)] = state
      }
      return acc
    }, {})

    if (Object.keys(imageEditStates).length > 0) {
      if (isDesktop()) {
        try {
          const editStateFile = await saveEditState(taskId, imageEditStates)
          options.editStateFile = editStateFile
          delete options.imageEditStates
          logger.info('[Workspace] 已保存编辑状态到文件', { file: editStateFile })
        } catch (error) {
          logger.error('[Workspace] 保存编辑状态文件失败', error)
          options.imageEditStates = imageEditStates
        }
      } else {
        options.imageEditStates = imageEditStates
      }
    }
    const newTask: GenerationTask = {
      id: taskId,
      createdAt: new Date(),
      type,
      prompt: input,
      model,
      provider: providerId,
      status: 'pending',
      progress: 0,
      images: isStringArray(options.images) ? options.images : undefined,
      videos: videoUrls,
      uploadedFilePaths: isStringArray(options.uploadedFilePaths) ? options.uploadedFilePaths : undefined,
      uploadedVideoFilePaths: taskUploadedVideoFilePaths,
      options,
    }

    // enqueue 前先入列表，保证 UI 立即可见（最新在底部）
    setTasks((prev) => [...prev, newTask])

    const started = taskQueueManager.enqueue({
      id: taskId,
      execute: async () => {
        await executeTask(taskId, newTask)
      },
      onStart: () => {
        setIsGenerating(true)
        updateTask(taskId, { status: 'generating' })
      },
      onComplete: () => {
        setIsGenerating(taskQueueManager.getRunningCount() > 0)
      },
      onError: () => {
        setIsGenerating(taskQueueManager.getRunningCount() > 0)
      },
    })

    if (!started) {
      updateTask(taskId, { status: 'queued' })
    }
  }, [
    executeTask,
    imageEditStatesRef,
    messages.missingInput,
    messages.testModeIntercepted,
    notify,
    setTasks,
    setUploadedFilePathsRef,
    setUploadedImagesRef,
    updateTask,
  ])

  return { isGenerating, handleGenerate, handleContinuePolling }
}
