import { createLogger } from '@/core/logging'
import { useCallback, useEffect, useRef, useState } from 'react'
import { GenerationService } from '@/core/services/GenerationService'
import { toAudioDisplayUrl } from '@/utils/audioPreview'
import { getMediaDimensions, getMediaDurationFormatted } from '@/utils/mediaDimensions'
import type { ImageEditSession } from '@/core/imageEdit'
import type { MediaType, GenerationTask, GeneratorOptions, ToastNotification } from '../types'
import { splitMulti } from '../utils/multiFile'
import { resolveProgressSettleDelayMs } from '../utils/progressAnimation'
import { isRecord, isStringArray } from '../utils/typeGuards'
import { extractServerTaskIdFromErrorMessage, extractServerTaskIdFromMetadata } from '../utils/taskServerId'
import { normalizeMediaResultForDesktop } from '../utils/mediaResult'
import { continuePollingTask } from './continuePollingTask'
import { voiceLibraryService } from '@/services/voiceLibrary/VoiceLibraryService'
import { taskQueueManager } from '@/services/taskQueue'
import {
  asMutableRecord,
  isMinimaxVoiceCloneMode,
  normalizeNonEmptyString,
  toVideoDisplayUrl,
} from '../application/generationTaskUtils'
import {
  createVisibleGenerationTask,
  registerVisibleGenerationTaskHandler,
  type VisibleGenerationTaskInput,
} from '../application/visibleGenerationTaskCommand'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.useTaskGeneration')

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
  imageEditStatesRef: React.MutableRefObject<Map<string, ImageEditSession>>
  setUploadedImagesRef: React.MutableRefObject<React.Dispatch<React.SetStateAction<string[]>> | null>
  setUploadedFilePathsRef: React.MutableRefObject<React.Dispatch<React.SetStateAction<string[]>> | null>
}

export interface UseTaskGenerationReturn {
  isGenerating: boolean
  handleGenerate: (input: string, model: string, type: MediaType, options?: DynamicValue) => Promise<void>
  handleContinuePolling: (task: GenerationTask) => Promise<void>
}

function getUserMessage(error: DynamicValue): string {
  if (error instanceof Error) return error.message
  return String(error)
}

function maybeToUserMessage(error: DynamicValue): string {
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

function extractVoiceIdFromMetadata(metadata: DynamicValue): string | undefined {
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
  metadata: DynamicValue
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
  const tasksRef = useRef(tasks)

  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  const generateWithService = useCallback(async (
    modelId: string,
    input: string,
    options: GeneratorOptions,
    onProgress?: GenerationProgressCallback
  ): Promise<DynamicValue> => {
    const generationService = GenerationService.getInstance()
    const params: DynamicValueMap = {
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
      if (task.uploadedAudioFilePaths) options.uploadedAudioFilePaths = task.uploadedAudioFilePaths
      if (task.images) options.images = task.images
      if (task.uploadedVideoFilePaths && task.uploadedVideoFilePaths.length > 0) {
        const videoUrls = task.uploadedVideoFilePaths.map(toVideoDisplayUrl)
        if (!isStringArray(options.videos) || options.videos.length === 0) {
          options.videos = videoUrls
        }
        if (typeof options.video !== 'string' || options.video.trim().length === 0) {
          options.video = videoUrls[0]
        }
        const mutableOptions = options as DynamicValueMap
        mutableOptions.uploadedVideos = options.videos

      }
      if (task.uploadedAudioFilePaths && task.uploadedAudioFilePaths.length > 0) {
        const audioUrls = task.uploadedAudioFilePaths.map((p) => toAudioDisplayUrl(p))
        options.audios = await Promise.all(audioUrls)
        const mutableOptions = options as DynamicValueMap
        mutableOptions.uploadedAudios = options.audios
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
      const resultObj: DynamicValueMap = isRecord(result) ? result : {}
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

  const runCreateVisibleTask = useCallback((input: VisibleGenerationTaskInput): Promise<string | null> => (
    createVisibleGenerationTask(input, {
      appendTask: (task) => setTasks((previous) => [...previous, task]),
      updateTask,
      executeTask,
      setGenerating: setIsGenerating,
      notify,
      messages,
      imageEditStates: imageEditStatesRef.current,
      setUploadedImages: (images) => setUploadedImagesRef.current?.(images),
      setUploadedFilePaths: (paths) => setUploadedFilePathsRef.current?.(paths),
    })
  ), [
    executeTask,
    imageEditStatesRef,
    messages,
    notify,
    setTasks,
    setUploadedFilePathsRef,
    setUploadedImagesRef,
    updateTask,
  ])

  useEffect(() => registerVisibleGenerationTaskHandler({
    create: runCreateVisibleTask,
    get: (taskId) => {
      const task = tasksRef.current.find((item) => item.id === taskId)
      if (!task) return null
      return {
        taskId: task.id,
        status: task.status,
        progress: task.progress ?? 0,
        modelId: task.model,
        mediaType: task.type,
        resultAvailable: Boolean(task.result),
        errorCode: task.error ? 'GENERATION_FAILED' : null,
      }
    },
    cancel: async (taskId, reason) => {
      const task = tasksRef.current.find((item) => item.id === taskId)
      if (!task) throw new Error('TASK_NOT_FOUND')
      if (task.status === 'success' || task.status === 'error') throw new Error('TASK_NOT_CANCELLABLE')
      if (taskQueueManager.isQueued(taskId)) {
        taskQueueManager.removeFromQueue(taskId)
      } else {
        await GenerationService.getInstance().cancelTask(task.serverTaskId ?? task.id)
      }
      updateTask(taskId, { status: 'error', error: reason })
      return { taskId, status: 'cancelled' }
    },
  }), [runCreateVisibleTask, updateTask])

  const handleGenerate = useCallback(async (
    input: string,
    model: string,
    type: MediaType,
    options?: DynamicValue
  ): Promise<void> => {
    await runCreateVisibleTask({ input, model, type, options })
  }, [runCreateVisibleTask])

  return { isGenerating, handleGenerate, handleContinuePolling }
}
