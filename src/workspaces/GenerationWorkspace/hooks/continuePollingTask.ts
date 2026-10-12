import { beginGenerationTaskExecution } from '../application/generationTaskExecution'
import { aiReadSavedResult } from '@/commands/aiRuntime'
import { awaitGenerationTaskPersistence } from './useTaskHistory'
import { createLogger } from '@/core/logging'
import { clonedVoiceCompletion } from '@/services/voiceLibrary/clonedVoiceResult'
import { captureClonedVoice } from '@/services/voiceLibrary/captureClonedVoice'
import { registry } from '@/core/ModelRegistry'
import { GenerationService } from '@/core/services/GenerationService'
import { getMediaDimensions, getMediaDurationFormatted } from '@/utils/mediaDimensions'
import type { GenerationTask } from '../types'
import { resolveProgressSettleDelayMs } from '../utils/progressAnimation'
import { extractServerTaskIdFromErrorMessage, resolveResumableServerTaskId } from '@/features/generation/application/taskServerId'
import { normalizeMediaResultForDesktop } from '../utils/mediaResult'
import { useGenerationTaskProgressStore } from '@/stores/generationTaskProgressStore'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.continuePollingTask')

type ContinuePollingProgressCallback = NonNullable<Parameters<GenerationService['continuePolling']>[3]>

export interface ContinuePollingTaskParams {
  task: GenerationTask
  execution?: ReturnType<typeof beginGenerationTaskExecution>
  genericGenerateFailed: string
  notify: (message: string, type?: 'success' | 'error') => void
  updateTask: (taskId: string, updates: Partial<GenerationTask>) => void
  updateProgress: (taskId: string, progress: number) => void
  toUserMessage: (error: DynamicValue) => string
}

export async function continuePollingTask({
  task,
  genericGenerateFailed,
  notify,
  updateTask,
  updateProgress,
  toUserMessage,
  execution: parentExecution,
}: ContinuePollingTaskParams): Promise<void> {
  const serverTaskId = resolveResumableServerTaskId(task)

  if (!serverTaskId) {
    logger.error('[Workspace] 再次轮询失败：缺少有效任务ID', { taskId: task.id, model: task.model, error: task.error })
    notify(genericGenerateFailed, 'error')
    return
  }

  const execution = parentExecution ?? beginGenerationTaskExecution(task.id)
  const saveUpdate = async (updates: Partial<GenerationTask>): Promise<void> => {
    if (!execution.isCurrent()) return
    updateTask(task.id, updates)
    await awaitGenerationTaskPersistence(task.id)
  }
  try {
    logger.info('[Workspace] 开始再次轮询', { taskId: task.id, model: task.model, serverTaskId })
    const options = { ...(task.options ?? {}) }
    if (task.uploadedFilePaths) options.uploadedFilePaths = task.uploadedFilePaths
    if (task.uploadedVideoFilePaths) options.uploadedVideoFilePaths = task.uploadedVideoFilePaths
    if (task.images) options.images = task.images

    await saveUpdate({ status: 'generating', error: undefined, serverTaskId })
    if (!execution.isCurrent()) return
    // 进度地板优先取瞬态 store 中的现值（进度已不再写进 task），回退到 task 快照
    const storedProgress = useGenerationTaskProgressStore.getState().progress[task.id]
    let currentProgress = Math.max(1, storedProgress ?? task.progress ?? 0)
    updateProgress(task.id, currentProgress)

    // 先查缓存结果（主进程轮询完成但渲染层已重载的场景）
    const cached = await aiReadSavedResult(serverTaskId)
    if (!execution.isCurrent()) return
    let resultObj: { urls: string[]; filePaths: string[]; metadata?: unknown }
    if (cached && (!(cached.urls?.length) || cached.filePaths?.length === cached.urls.length)) {
      const provider = registry.getModel(task.model)?.meta.provider
      if (provider) await captureClonedVoice(task.model, provider, cached)
      logger.info('[Workspace] 命中缓存轮询结果，跳过重新轮询', { taskId: task.id, serverTaskId })
      resultObj = {
        urls: cached.urls ?? [],
        filePaths: cached.filePaths ?? [],
        metadata: cached.metadata,
      }
    } else {
      const handleProgress: ContinuePollingProgressCallback = (status) => {
        if (!execution.isCurrent() || status.progress === undefined) return
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
      }, handleProgress, { signal: execution.signal })
      if (!execution.isCurrent()) return
      resultObj = {
        urls: result.urls,
        filePaths: result.filePaths,
        metadata: result.metadata,
      }
    }
    logger.info('[Workspace] 继续轮询响应', { model: task.model, taskId: serverTaskId, metadata: resultObj.metadata })

    const normalized = await normalizeMediaResultForDesktop(
      task,
      { urls: resultObj.urls, filePaths: resultObj.filePaths },
      '[Workspace] 继续轮询结果本地保存失败，回退在线地址'
    )
    const { urls, filePaths } = normalized

    if (urls.length === 0) {
      const completion = clonedVoiceCompletion(resultObj.metadata)
      if (completion) {
        await saveUpdate({ status: 'success', progress: 100, options: { ...options, __completionMessage: completion } })
        if (execution.isCurrent()) useGenerationTaskProgressStore.getState().clearProgress(task.id)
        return
      }
      logger.error('[Workspace] 继续轮询响应缺少 URL', { model: task.model, result: resultObj })
      throw new Error(genericGenerateFailed)
    }

    const firstCheck = filePaths[0] ?? urls[0]
    const [dimensions, duration] = await Promise.all([
      getMediaDimensions(firstCheck, task.type),
      getMediaDurationFormatted(firstCheck, task.type),
    ])

    if (!execution.isCurrent()) return
    updateProgress(task.id, 100)
    await new Promise((r) => setTimeout(r, resolveProgressSettleDelayMs(currentProgress)))
    await saveUpdate({
      status: 'success',
      progress: 100,
      dimensions: dimensions ?? undefined,
      duration: duration ?? undefined,
      serverTaskId,
      result: {
        id: task.id,
        type: task.type,
        urls,
        filePaths,
        prompt: task.prompt,
        createdAt: new Date(),
      },
    })
    // 任务已进入 success（不再渲染进度条），清掉瞬态进度
    if (execution.isCurrent()) useGenerationTaskProgressStore.getState().clearProgress(task.id)
  } catch (error) {
    if (!execution.isCurrent()) return
    logger.error('[Workspace] 继续轮询失败', error)
    const errorMessage = toUserMessage(error) || genericGenerateFailed
    await saveUpdate({
      status: 'error',
      error: errorMessage,
      serverTaskId: extractServerTaskIdFromErrorMessage(errorMessage) ?? serverTaskId,
    })
    if (execution.isCurrent()) useGenerationTaskProgressStore.getState().clearProgress(task.id)
  } finally {
    if (!parentExecution) execution.finish()
  }
}
