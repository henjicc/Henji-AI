import { createLogger } from '@/core/logging'
import { registry } from '@/core/ModelRegistry'
import type { ImageEditSession } from '@/core/imageEdit'
import { taskQueueManager } from '@/services/taskQueue'
import { saveEditState } from '@/utils/editStatePersistence'
import {
  dataUrlToBlob,
  ensureCompressedJpegBytesWithPica,
  isDesktop,
  saveBase64ToUploads,
  saveBytesToUploads,
  saveUploadAudio,
  saveUploadVideo,
} from '@/utils/save'
import { toAudioDisplayUrl } from '@/utils/audioPreview'
import { logRequestParams, shouldSkipRequest } from '@/utils/testMode'

import type { GenerationTask, GeneratorOptions, MediaType, ToastNotification } from '../types'
import { isRecord, isStringArray } from '../utils/typeGuards'
import {
  asGeneratorOptions,
  asMutableRecord,
  isFileValue,
  isLikelyVideoSource,
  isMinimaxVoiceCloneMode,
  normalizeNonEmptyString,
  summarizeMediaSources,
  toVideoDisplayUrl,
} from './generationTaskUtils'

const logger = createLogger('workspaces.GenerationWorkspace.application.visibleGenerationTask')

export interface VisibleGenerationTaskInput {
  input: string
  model: string
  type: MediaType
  options?: DynamicValue
}

export interface VisibleGenerationTaskMessages {
  testModeIntercepted: string
  missingInput: string
}

export interface VisibleGenerationTaskDependencies {
  appendTask: (task: GenerationTask) => void
  updateTask: (taskId: string, updates: Partial<GenerationTask>) => void
  executeTask: (taskId: string, task: GenerationTask) => Promise<void>
  setGenerating: (isGenerating: boolean) => void
  notify: (message: string, type?: ToastNotification['type']) => void
  messages: VisibleGenerationTaskMessages
  imageEditStates: Map<string, ImageEditSession>
  setUploadedImages?: (images: string[]) => void
  setUploadedFilePaths?: (paths: string[]) => void
}

export type VisibleGenerationTaskHandler = (input: VisibleGenerationTaskInput) => Promise<string | null>

export interface VisibleGenerationTaskSummary {
  taskId: string
  status: GenerationTask['status']
  progress: number
  modelId: string
  mediaType: MediaType
  resultAvailable: boolean
  errorCode: string | null
  errorMessage: string | null
}

export interface VisibleGenerationTaskHandlers {
  create: VisibleGenerationTaskHandler
  get: (taskId: string) => VisibleGenerationTaskSummary | null
  cancel: (taskId: string, reason: string) => Promise<Record<string, unknown>>
}

let registeredHandlers: VisibleGenerationTaskHandlers | null = null
const changeListeners = new Set<() => void>()

function emitVisibleGenerationTaskChange(): void {
  for (const listener of changeListeners) listener()
}

function createTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function registerVisibleGenerationTaskHandler(handlers: VisibleGenerationTaskHandlers): () => void {
  registeredHandlers = handlers
  emitVisibleGenerationTaskChange()
  return () => {
    if (registeredHandlers === handlers) {
      registeredHandlers = null
      emitVisibleGenerationTaskChange()
    }
  }
}

export function subscribeVisibleGenerationTaskChanges(listener: () => void): () => void {
  changeListeners.add(listener)
  return () => changeListeners.delete(listener)
}

export function isVisibleGenerationTaskHandlerReady(): boolean {
  return registeredHandlers !== null
}

export async function runVisibleGenerationTaskCommand(input: VisibleGenerationTaskInput): Promise<string | null> {
  if (!registeredHandlers) throw new Error('可见生成任务命令尚未就绪')
  return registeredHandlers.create(input)
}

export function getVisibleGenerationTask(taskId: string): VisibleGenerationTaskSummary | null {
  if (!registeredHandlers) throw new Error('可见生成任务命令尚未就绪')
  return registeredHandlers.get(taskId)
}

export async function cancelVisibleGenerationTask(taskId: string, reason: string): Promise<Record<string, unknown>> {
  if (!registeredHandlers) throw new Error('可见生成任务命令尚未就绪')
  return await registeredHandlers.cancel(taskId, reason)
}

export async function createVisibleGenerationTask(
  input: VisibleGenerationTaskInput,
  dependencies: VisibleGenerationTaskDependencies
): Promise<string | null> {
  const { model, type } = input
  const prompt = input.input
  const options: GeneratorOptions = asGeneratorOptions(input.options)

  if (isStringArray(options.images) && options.images.length > 0) {
    const images = [...options.images]
    const uploadedFilePaths = isStringArray(options.uploadedFilePaths)
      ? [...options.uploadedFilePaths]
      : new Array(images.length).fill('')
    let changed = false

    for (let index = 0; index < images.length; index += 1) {
      const image = images[index]
      if (!image.startsWith('data:')) continue
      try {
        const blob = await dataUrlToBlob(image)
        const jpegBytes = await ensureCompressedJpegBytesWithPica(blob)
        const saved = await saveBytesToUploads(jpegBytes, 'image/jpeg')
        const session = dependencies.imageEditStates.get(image)
        if (session) {
          let sourceUrl = session.sourceUrl
          if (sourceUrl.startsWith('data:')) {
            sourceUrl = (await saveBase64ToUploads(sourceUrl)).displaySrc
          }
          dependencies.imageEditStates.delete(image)
          dependencies.imageEditStates.set(saved.displaySrc, { ...session, sourceUrl })
        }
        images[index] = saved.displaySrc
        uploadedFilePaths[index] = saved.fullPath
        changed = true
      } catch (error) {
        logger.error('延迟保存图片失败', error, { event: 'visible_generation.image_persist.failed', modelId: model })
      }
    }

    if (changed) {
      options.images = images
      options.uploadedFilePaths = uploadedFilePaths
      dependencies.setUploadedImages?.(images)
      dependencies.setUploadedFilePaths?.(uploadedFilePaths)
    }
  }

  const uploadedVideoFilePaths = isStringArray(options.uploadedVideoFilePaths) ? [...options.uploadedVideoFilePaths] : []
  const uploadedAudioFilePaths = isStringArray(options.uploadedAudioFilePaths) ? [...options.uploadedAudioFilePaths] : []
  if (isFileValue(options.video) && uploadedVideoFilePaths.length === 0) {
    try {
      uploadedVideoFilePaths.push((await saveUploadVideo(options.video, 'persist')).fullPath)
    } catch (error) {
      logger.error('持久化上传视频失败', error, { event: 'visible_generation.video_persist.failed', modelId: model })
      dependencies.notify('视频保存失败，请重试上传后再生成', 'error')
      return null
    }
  }

  if (uploadedVideoFilePaths.length > 0) {
    const urls = uploadedVideoFilePaths.map(toVideoDisplayUrl)
    options.uploadedVideoFilePaths = uploadedVideoFilePaths
    options.videos = urls
    ;(options as DynamicValueMap).uploadedVideos = urls
    options.video = urls[0]
  }
  if (uploadedAudioFilePaths.length > 0) {
    const urls = await Promise.all(uploadedAudioFilePaths.map(toAudioDisplayUrl))
    options.uploadedAudioFilePaths = uploadedAudioFilePaths
    options.audios = urls
    ;(options as DynamicValueMap).uploadedAudios = urls
  }

  const sanitizedVideos = isStringArray(options.videos) ? options.videos.filter(isLikelyVideoSource) : []
  if (sanitizedVideos.length > 0) {
    options.videos = sanitizedVideos
    ;(options as DynamicValueMap).uploadedVideos = sanitizedVideos
    if (typeof options.video !== 'string' || options.video.trim().length === 0) options.video = sanitizedVideos[0]
  } else {
    delete options.videos
    delete (options as DynamicValueMap).uploadedVideos
    if (typeof options.video === 'string' && !isLikelyVideoSource(options.video)) delete options.video
  }

  if (!isStringArray(options.audios) || options.audios.length === 0) {
    delete options.audios
    delete (options as DynamicValueMap).uploadedAudios
  } else {
    options.audios = options.audios.filter((item) => typeof item === 'string' && item.trim().length > 0)
    ;(options as DynamicValueMap).uploadedAudios = options.audios
  }

  if (isMinimaxVoiceCloneMode(options)) {
    const cloneAudioInput = asMutableRecord(options.minimaxCloneAudioInput)
    if (isFileValue(cloneAudioInput.cloneAudioFile)) {
      try {
        options.minimaxCloneAudioFilePath = (await saveUploadAudio(cloneAudioInput.cloneAudioFile, 'persist')).fullPath
      } catch (error) {
        logger.error('持久化复刻音频失败', error, { event: 'visible_generation.clone_audio_persist.failed', modelId: model })
        dependencies.notify('复刻音频保存失败，请重新上传后再试', 'error')
        return null
      }
    }
    delete cloneAudioInput.cloneAudioFile
    options.minimaxCloneAudioInput = cloneAudioInput

    const cloneSettings = asMutableRecord(options.minimaxCloneSettings)
    delete cloneSettings.cloneAudioUrl
    if (isFileValue(cloneSettings.promptAudioFile)) {
      try {
        options.minimaxClonePromptAudioFilePath = (await saveUploadAudio(cloneSettings.promptAudioFile, 'persist')).fullPath
      } catch (error) {
        logger.error('持久化示例音频失败', error, { event: 'visible_generation.prompt_audio_persist.failed', modelId: model })
        dependencies.notify('示例音频保存失败，请重新上传后再试', 'error')
        return null
      }
    }
    delete cloneSettings.promptAudioFile
    delete cloneSettings.promptAudioUrl
    const cloneAudioPath = normalizeNonEmptyString(options.minimaxCloneAudioFilePath)
    if (!cloneAudioPath) {
      dependencies.notify('音色克隆模式需要上传复刻音频文件', 'error')
      return null
    }
    options.minimaxCloneAudioFilePath = cloneAudioPath
    const promptAudioPath = normalizeNonEmptyString(options.minimaxClonePromptAudioFilePath)
    if (promptAudioPath) options.minimaxClonePromptAudioFilePath = promptAudioPath
    else delete options.minimaxClonePromptAudioFilePath
    options.minimaxCloneSettings = cloneSettings
  }

  const hasAnyInput = prompt.trim().length > 0
    || (isStringArray(options.images) && options.images.length > 0)
    || (isStringArray(options.videos) && options.videos.length > 0)
  if (!hasAnyInput) {
    dependencies.notify(dependencies.messages.missingInput, 'error')
    return null
  }
  if (shouldSkipRequest()) {
    logRequestParams({ input: prompt, model, type, options, timestamp: new Date().toISOString() })
    dependencies.notify(dependencies.messages.testModeIntercepted, 'success')
    return null
  }

  const info: DynamicValue = registry.getModelInfo(model)
  const providerId = isRecord(info) && typeof info.provider === 'string' ? info.provider : undefined
  const taskVideoPaths = isStringArray(options.uploadedVideoFilePaths) ? options.uploadedVideoFilePaths : undefined
  const taskAudioPaths = isStringArray(options.uploadedAudioFilePaths) ? options.uploadedAudioFilePaths : undefined
  const videoUrls = taskVideoPaths?.length ? taskVideoPaths.map(toVideoDisplayUrl) : (isStringArray(options.videos) ? options.videos : undefined)

  if (model === 'ppio-wan-2.5-preview') {
    logger.info('Wan 2.5 Preview 请求媒体输入', {
      event: 'visible_generation.media_input.debug',
      modelId: model,
      images: summarizeMediaSources(options.images),
      uploadedFilePaths: summarizeMediaSources(options.uploadedFilePaths),
      videos: summarizeMediaSources(options.videos),
      uploadedVideoFilePaths: summarizeMediaSources(options.uploadedVideoFilePaths),
    })
  }

  const taskId = createTaskId()
  const imageEditStates = (isStringArray(options.images) ? options.images : []).reduce<Record<string, ImageEditSession>>((acc, url, index) => {
    const state = dependencies.imageEditStates.get(url)
    if (state) acc[String(index)] = state
    return acc
  }, {})
  if (Object.keys(imageEditStates).length > 0) {
    if (isDesktop()) {
      try {
        options.editStateFile = await saveEditState(taskId, imageEditStates)
        delete options.imageEditStates
      } catch (error) {
        logger.error('保存编辑状态文件失败', error, { event: 'visible_generation.edit_state.failed', taskId, modelId: model })
        options.imageEditStates = imageEditStates
      }
    } else {
      options.imageEditStates = imageEditStates
    }
  }

  const task: GenerationTask = {
    id: taskId,
    createdAt: new Date(),
    type,
    prompt,
    model,
    provider: providerId,
    status: 'pending',
    progress: 0,
    images: isStringArray(options.images) ? options.images : undefined,
    videos: videoUrls,
    uploadedFilePaths: isStringArray(options.uploadedFilePaths) ? options.uploadedFilePaths : undefined,
    uploadedVideoFilePaths: taskVideoPaths,
    uploadedAudioFilePaths: taskAudioPaths,
    options,
  }
  dependencies.appendTask(task)
  emitVisibleGenerationTaskChange()
  logger.info('可见生成任务已创建', { event: 'visible_generation.task.created', taskId, modelId: model, providerId, mediaType: type })

  const started = taskQueueManager.enqueue({
    id: taskId,
    providerId,
    execute: () => dependencies.executeTask(taskId, task),
    onStart: () => {
      dependencies.setGenerating(true)
      dependencies.updateTask(taskId, { status: 'generating' })
    },
    onComplete: () => dependencies.setGenerating(taskQueueManager.getRunningCount() > 0),
    onError: () => dependencies.setGenerating(taskQueueManager.getRunningCount() > 0),
  })
  if (!started) dependencies.updateTask(taskId, { status: 'queued' })
  return taskId
}
