import type { ProgressStatus } from '@/core/providers/base/types'
import { GenerationService, type GenerationExecutionOptions } from '@/core/services/GenerationService'
import { extractServerTaskIdFromMetadata } from './taskServerId'

/**
 * 提交并等到结果：异步供应商先返回 pending，再按任务号续查到完成。
 * 画布、测试台与声音克隆共用这一份；只提交不续查时，钱已经花了结果却取不回来。
 */
export async function generateToCompletion(
  modelId: string,
  params: DynamicValueMap,
  onProgress?: (status: ProgressStatus) => void,
  options: GenerationExecutionOptions & {
    /** 拿到供应商任务号时回调（画布据此记下任务号，应用重启后能续查） */
    onTaskId?: (taskId: string) => void | Promise<void>
  } = {},
): ReturnType<GenerationService['generate']> {
  const { onTaskId, ...executionOptions } = options
  const generationService = GenerationService.getInstance()
  const result = await generationService.generate(modelId, params, onProgress, executionOptions)
  if (result.status !== 'pending') return result
  const taskId = result.taskId ?? extractServerTaskIdFromMetadata(result.metadata)
  if (!taskId) throw new Error('异步任务缺少 taskId，无法继续轮询')
  await onTaskId?.(taskId)
  executionOptions.signal?.throwIfAborted()
  return await generationService.continuePolling(modelId, taskId, params, onProgress, executionOptions)
}
