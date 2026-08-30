import type { CanvasNodeData, CanvasNodeType } from '@/features/canvas/domain/canvasNodes'
import type { CanvasGenerationOutput } from '@/features/canvas/generation/runGeneration'

export interface GenerationNodeRuntimePreparationContext {
  data: CanvasNodeData
  images: string[]
  videos: string[]
  audios: string[]
  params: DynamicValueMap
  modelId: string
}

export interface GenerationNodeResultCommitContext {
  sourceNodeId: string
  placeholderNodeId: string
  resultNodeType: CanvasNodeType
  completionId: string
  modelId: string
  providerId: string
  params: DynamicValueMap
  inputs: {
    images: string[]
    videos: string[]
    audios: string[]
  }
  result: CanvasGenerationOutput
  resultNodeData: DynamicValueMap
}

export interface GenerationNodeRequestPreparation {
  /** 将专属前处理与模型调用、后处理聚合到同一日志链路。 */
  requestId?: string
  /** 本次前处理新建且只供当前请求使用的受管文件；执行结束后统一释放。 */
  createdFilePaths?: string[]
  params?: DynamicValueMap
  inputs?: {
    images: string[]
    videos: string[]
    audios: string[]
  }
  resultNodeData?: DynamicValueMap
}

export interface GenerationNodeResultCommitResult {
  resultNodeIds: string[]
  idempotent?: boolean
}
