import type { BuiltinModelType } from '@/core/types'
import type { CanvasGenerationOutput } from '@/features/canvas/generation/runGeneration'

import type { GenerationNodeRequestPreparation } from './generationNodeExecutionTypes'

export interface GenerationNodeResourceOwnership {
  modelType: BuiltinModelType
  requestPreparation: GenerationNodeRequestPreparation | null
  generationResult: CanvasGenerationOutput | null
}

/**
 * 前处理资源始终是请求级临时文件；Runtime 生成结果只有图片会在提交时复制为节点权威资源。
 * 视频和音频节点直接引用 Runtime Media 文件，因此不能在执行结束时释放。
 */
export function collectGenerationNodeTemporaryFiles(
  ownership: GenerationNodeResourceOwnership,
): string[] {
  return [...new Set([
    ...(ownership.requestPreparation?.createdFilePaths ?? []),
    ...(ownership.modelType === 'image'
      ? ownership.generationResult?.createdFilePaths ?? []
      : []),
  ])]
}

/**
 * 把所有退出路径收口到同一 finally。回收失败只记录诊断，不能覆盖生成本身的结果或错误。
 */
export async function runWithGenerationNodeResourceCleanup<T>(input: {
  ownership: GenerationNodeResourceOwnership
  operation: () => Promise<T>
  release: (filePaths: string[]) => Promise<void>
  onReleaseError?: (error: unknown, fileCount: number) => void
}): Promise<T> {
  try {
    return await input.operation()
  } finally {
    const filePaths = collectGenerationNodeTemporaryFiles(input.ownership)
    if (filePaths.length > 0) {
      try {
        await input.release(filePaths)
      } catch (error) {
        try {
          input.onReleaseError?.(error, filePaths.length)
        } catch {
          // 日志链路自身异常也不能改变生成执行结果。
        }
      }
    }
  }
}
