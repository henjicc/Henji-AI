import { useCallback, useRef, useState } from 'react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { GenerationService } from '@/core/services/GenerationService'
import { registry } from '@/core/ModelRegistry'
import { taskQueueManager } from '@/services/taskQueue'
import { logError, logInfo } from '@/utils/errorLogger'
import {
  dataUrlToBlob,
  ensureCompressedJpegBytesWithPica,
  fileToBlobSrc,
  isDesktop,
  saveAudioFromUrl,
  saveBytesToUploads,
  saveImageFromUrl,
  saveBase64ToUploads,
} from '@/utils/save'
import { getMediaDimensions, getMediaDurationFormatted } from '@/utils/mediaDimensions'
import { logRequestParams, shouldSkipRequest } from '@/utils/testMode'
import type { ImageEditState } from '@/components/ImageEditor'
import type { MediaType, GenerationTask, GeneratorOptions, ToastNotification } from '../types'
import { joinMulti, splitMulti } from '../utils/multiFile'
import { isRecord, isStringArray } from '../utils/typeGuards'

type GenerationProgressCallback = NonNullable<Parameters<GenerationService['generate']>[2]>
type GenerationProgressStatus = Parameters<GenerationProgressCallback>[0]

export interface UseTaskGenerationMessages {
  testModeIntercepted: string
  missingInput: string
  genericGenerateFailed: string
}

export interface UseTaskGenerationParams {
  tasks: GenerationTask[]
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

export function useTaskGeneration({
  tasks,
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

      let url = typeof resultObj['url'] === 'string' ? resultObj['url'] : undefined
      let filePath = typeof resultObj['filePath'] === 'string' ? resultObj['filePath'] : undefined

      // 图片/音频：如果 Provider 未落盘，桌面端补一次本地保存
      if (isDesktop() && url && !filePath) {
        try {
          if (task.type === 'image') {
            const urls = splitMulti(url)
            const display: string[] = []
            const paths: string[] = []
            for (const u of urls) {
              const { fullPath } = await saveImageFromUrl(u)
              display.push(await fileToBlobSrc(fullPath))
              paths.push(fullPath)
            }
            url = joinMulti(display)
            filePath = joinMulti(paths)
          }

          if (task.type === 'audio') {
            const { fullPath } = await saveAudioFromUrl(url)
            url = await fileToBlobSrc(fullPath)
            filePath = fullPath
          }
        } catch (e) {
          logError('[Workspace] 本地保存失败，回退在线地址', e)
        }
      }

      if (!url) {
        throw new Error(messages.genericGenerateFailed)
      }

      const firstCheck = filePath ? splitMulti(filePath)[0] : splitMulti(url)[0]
      const [dimensions, duration] = await Promise.all([
        getMediaDimensions(firstCheck, task.type),
        getMediaDurationFormatted(firstCheck, task.type),
      ])

      updateProgress(taskId, 100)
      await new Promise((r) => setTimeout(r, 180))

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
      logError('[Workspace] 生成失败', error)
      updateTask(taskId, { status: 'error', error: maybeToUserMessage(error) || messages.genericGenerateFailed })
    } finally {
      delete lastProgressRef.current[taskId]
    }
  }, [generateWithService, messages.genericGenerateFailed, updateProgress, updateTask])

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
          logError('[Workspace] 延迟保存图片失败', e)
        }
      }

      if (changed) {
        options.images = images
        options.uploadedFilePaths = uploadedFilePaths
        setUploadedImagesRef.current?.(images)
        setUploadedFilePathsRef.current?.(uploadedFilePaths)
      }
    }

    const hasAnyInput = input.trim().length > 0 || (isStringArray(options.images) && options.images.length > 0)
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
    const uploadedVideoFilePaths = isStringArray(options.uploadedVideoFilePaths) ? options.uploadedVideoFilePaths : undefined
    const uploadedVideos = isStringArray(options.videos) ? options.videos : undefined
    const videoUrls = uploadedVideoFilePaths?.length
      ? uploadedVideoFilePaths.map((p) => convertFileSrc(p))
      : uploadedVideos

    const taskId = createTaskId()
    const newTask: GenerationTask = {
      id: taskId,
      type,
      prompt: input,
      model,
      provider: providerId,
      status: 'pending',
      progress: 0,
      images: isStringArray(options.images) ? options.images : undefined,
      videos: videoUrls,
      uploadedFilePaths: isStringArray(options.uploadedFilePaths) ? options.uploadedFilePaths : undefined,
      uploadedVideoFilePaths,
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

  return { isGenerating, handleGenerate }
}
