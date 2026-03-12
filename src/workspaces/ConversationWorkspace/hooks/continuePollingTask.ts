import { GenerationService } from '@/core/services/GenerationService'
import { logError, logInfo } from '@/utils/errorLogger'
import { getMediaDimensions, getMediaDurationFormatted } from '@/utils/mediaDimensions'
import type { GenerationTask } from '../types'
import { splitMulti } from '../utils/multiFile'
import { extractServerTaskIdFromErrorMessage, extractServerTaskIdFromMetadata } from '../utils/taskServerId'
import { normalizeMediaResultForDesktop } from '../utils/mediaResult'

export interface ContinuePollingTaskParams {
  task: GenerationTask
  genericGenerateFailed: string
  notify: (message: string, type?: 'success' | 'error') => void
  updateTask: (taskId: string, updates: Partial<GenerationTask>) => void
  updateProgress: (taskId: string, progress: number) => void
  toUserMessage: (error: unknown) => string
}

export async function continuePollingTask({
  task,
  genericGenerateFailed,
  notify,
  updateTask,
  updateProgress,
  toUserMessage,
}: ContinuePollingTaskParams): Promise<void> {
  const serverTaskId = task.serverTaskId
    ?? extractServerTaskIdFromErrorMessage(task.error ?? '')
    ?? extractServerTaskIdFromMetadata(task.result as unknown)

  if (!serverTaskId) {
    logError('[Workspace] 再次轮询失败：缺少有效任务ID', { taskId: task.id, model: task.model, error: task.error })
    notify(genericGenerateFailed, 'error')
    return
  }

  try {
    logInfo('[Workspace] 开始再次轮询', { taskId: task.id, model: task.model, serverTaskId })
    const options = { ...(task.options ?? {}) }
    if (task.uploadedFilePaths) options.uploadedFilePaths = task.uploadedFilePaths
    if (task.uploadedVideoFilePaths) options.uploadedVideoFilePaths = task.uploadedVideoFilePaths
    if (task.images) options.images = task.images

    updateTask(task.id, { status: 'generating', error: undefined, serverTaskId })
    updateProgress(task.id, Math.max(1, task.progress ?? 0))

    const generationService = GenerationService.getInstance()
    const result = await generationService.continuePolling(task.model, serverTaskId, {
      prompt: task.prompt,
      text: task.prompt,
      ...options,
    })
    const resultObj: Record<string, unknown> = {
      url: result.url,
      filePath: result.filePath,
      metadata: result.metadata,
    }
    logInfo('[Workspace] 继续轮询响应', { model: task.model, taskId: serverTaskId, metadata: resultObj['metadata'] })

    const normalized = await normalizeMediaResultForDesktop(
      task,
      {
        url: typeof resultObj['url'] === 'string' ? resultObj['url'] : undefined,
        filePath: typeof resultObj['filePath'] === 'string' ? resultObj['filePath'] : undefined,
      },
      '[Workspace] 继续轮询结果本地保存失败，回退在线地址'
    )
    const { url, filePath } = normalized

    if (!url) {
      logError('[Workspace] 继续轮询响应缺少 URL', { model: task.model, result: resultObj })
      throw new Error(genericGenerateFailed)
    }

    const firstCheck = filePath ? splitMulti(filePath)[0] : splitMulti(url)[0]
    const [dimensions, duration] = await Promise.all([
      getMediaDimensions(firstCheck, task.type),
      getMediaDurationFormatted(firstCheck, task.type),
    ])

    updateProgress(task.id, 100)
    await new Promise((r) => setTimeout(r, 180))
    updateTask(task.id, {
      status: 'success',
      progress: 100,
      dimensions: dimensions ?? undefined,
      duration: duration ?? undefined,
      serverTaskId,
      result: {
        id: task.id,
        type: task.type,
        url,
        filePath,
        prompt: task.prompt,
        createdAt: new Date(),
      },
    })
  } catch (error) {
    logError('[Workspace] 继续轮询失败', error)
    const errorMessage = toUserMessage(error) || genericGenerateFailed
    updateTask(task.id, {
      status: 'error',
      error: errorMessage,
      serverTaskId: extractServerTaskIdFromErrorMessage(errorMessage) ?? serverTaskId,
    })
  }
}
