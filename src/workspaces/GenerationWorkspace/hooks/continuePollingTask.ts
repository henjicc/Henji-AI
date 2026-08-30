import { createLogger } from '@/core/logging'
import { GenerationService } from '@/core/services/GenerationService'
import { getMediaDimensions, getMediaDurationFormatted } from '@/utils/mediaDimensions'
import type { GenerationTask } from '../types'
import { splitMulti } from '../utils/multiFile'
import { resolveProgressSettleDelayMs } from '../utils/progressAnimation'
import { extractServerTaskIdFromErrorMessage, extractServerTaskIdFromMetadata } from '@/features/generation/application/taskServerId'
import { normalizeMediaResultForDesktop } from '../utils/mediaResult'
import { useGenerationTaskProgressStore } from '@/stores/generationTaskProgressStore'
import { getPlatform } from '@/platform'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.continuePollingTask')

type ContinuePollingProgressCallback = NonNullable<Parameters<GenerationService['continuePolling']>[3]>

export interface ContinuePollingTaskParams {
  task: GenerationTask
  genericGenerateFailed: string
  notify: (message: string, type?: 'success' | 'error') => void
  updateTask: (taskId: string, updates: Partial<GenerationTask>) => void
  updateProgress: (taskId: string, progress: number) => void
  toUserMessage: (error: DynamicValue) => string
}

function normalizeCreatedFilePaths(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [...new Set(value.filter(
    (item): item is string => typeof item === 'string' && item.trim().length > 0,
  ))]
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
    ?? extractServerTaskIdFromMetadata(task.result as DynamicValue)

  if (!serverTaskId) {
    logger.error('[Workspace] 再次轮询失败：缺少有效任务ID', { taskId: task.id, model: task.model, error: task.error })
    notify(genericGenerateFailed, 'error')
    return
  }

  let createdFilePaths: string[] = []
  let ownershipTransferred = false
  try {
    logger.info('[Workspace] 开始再次轮询', { taskId: task.id, model: task.model, serverTaskId })
    const options = { ...(task.options ?? {}) }
    if (task.uploadedFilePaths) options.uploadedFilePaths = task.uploadedFilePaths
    if (task.uploadedVideoFilePaths) options.uploadedVideoFilePaths = task.uploadedVideoFilePaths
    if (task.images) options.images = task.images

    updateTask(task.id, { status: 'generating', error: undefined, serverTaskId })
    // 进度地板优先取瞬态 store 中的现值（进度已不再写进 task），回退到 task 快照
    const storedProgress = useGenerationTaskProgressStore.getState().progress[task.id]
    let currentProgress = Math.max(1, storedProgress ?? task.progress ?? 0)
    updateProgress(task.id, currentProgress)

    // 先查缓存结果（主进程轮询完成但渲染层已重载的场景）
    const cached = await window.henjiNative?.ai.consumePendingResult(serverTaskId)
    let resultObj: DynamicValueMap
    if (cached) {
      logger.info('[Workspace] 命中缓存轮询结果，跳过重新轮询', { taskId: task.id, serverTaskId })
      createdFilePaths = normalizeCreatedFilePaths(cached.createdFilePaths)
      resultObj = {
        url: cached.url,
        filePath: cached.filePath,
        metadata: cached.metadata,
      }
    } else {
      const handleProgress: ContinuePollingProgressCallback = (status) => {
        if (status.progress === undefined) return
        const next = Math.max(currentProgress, status.progress)
        if (next <= currentProgress) return
        currentProgress = next
        updateProgress(task.id, currentProgress)
      }

      const generationService = GenerationService.getInstance()
      const result = await generationService.continuePolling(task.model, serverTaskId, {
        prompt: task.prompt,
        text: task.prompt,
        ...options,
      }, handleProgress)
      createdFilePaths = normalizeCreatedFilePaths(result.createdFilePaths)
      resultObj = {
        url: result.url,
        filePath: result.filePath,
        metadata: result.metadata,
      }
    }
    logger.info('[Workspace] 继续轮询响应', { model: task.model, taskId: serverTaskId, metadata: resultObj['metadata'] })

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
      logger.error('[Workspace] 继续轮询响应缺少 URL', { model: task.model, result: resultObj })
      throw new Error(genericGenerateFailed)
    }

    const firstCheck = filePath ? splitMulti(filePath)[0] : splitMulti(url)[0]
    const [dimensions, duration] = await Promise.all([
      getMediaDimensions(firstCheck, task.type),
      getMediaDurationFormatted(firstCheck, task.type),
    ])

    updateProgress(task.id, 100)
    await new Promise((r) => setTimeout(r, resolveProgressSettleDelayMs(currentProgress)))
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
    ownershipTransferred = true
    // 任务已进入 success（不再渲染进度条），清掉瞬态进度
    useGenerationTaskProgressStore.getState().clearProgress(task.id)
  } catch (error) {
    logger.error('[Workspace] 继续轮询失败', error)
    const errorMessage = toUserMessage(error) || genericGenerateFailed
    updateTask(task.id, {
      status: 'error',
      error: errorMessage,
      serverTaskId: extractServerTaskIdFromErrorMessage(errorMessage) ?? serverTaskId,
    })
    useGenerationTaskProgressStore.getState().clearProgress(task.id)
  } finally {
    if (!ownershipTransferred && createdFilePaths.length > 0) {
      await getPlatform().image.releaseManagedGenerationMedia(createdFilePaths).catch((releaseError) => {
        logger.error('[Workspace] 续查结果媒体回滚失败', releaseError, {
          event: 'generation_workspace.polling.media_rollback.failed',
          taskId: task.id,
          context: { serverTaskId, createdFileCount: createdFilePaths.length },
        })
      })
    }
  }
}
