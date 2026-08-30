import type { CanvasNodeData, CanvasNodeType } from '../domain/canvasNodes'
import type {
  CanvasGenerationOutputBatchContractV1,
  CanvasGenerationOutputDescriptorV1,
  CanvasGenerationOutputStrategy,
} from '../domain/generationOutputs'
import type { LayerStackDocumentV1 } from '../domain/layerStack'
import type { RowMediaKind } from '../domain/socketTypes'

export class GenerationOutputApplicationError extends Error {
  constructor(
    readonly code: 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'UNSUPPORTED_STRATEGY',
    message: string,
  ) {
    super(message)
    this.name = 'GenerationOutputApplicationError'
  }
}

export interface CommitCanvasGenerationOutputsInput {
  /** 旧工程可能在任务运行期间删除来源连线；缺省时仍恢复结果，但不补来源边。 */
  sourceNodeId?: string
  /** 模型生成可传已有进度占位节点；本地确定性处理可省略，由本服务在事务内创建首个结果。 */
  placeholderNodeId?: string
  resultNodeType: CanvasNodeType
  /** 无占位节点时用于初始化首个结果，不得携带媒体路径。 */
  resultNodeData?: Partial<CanvasNodeData>
  contract: CanvasGenerationOutputBatchContractV1
  completionId?: string
  groupTitle?: string
  validateResultPatch?: (patch: DynamicValueMap, descriptor: CanvasGenerationOutputDescriptorV1) => void
  /** 测试与后续本地处理器可注入；生产默认走统一媒体落盘入口。 */
  persistOutput?: (mediaType: RowMediaKind, source: string) => Promise<
    DynamicValueMap | { patch: DynamicValueMap; createdFilePaths: string[] }
  >
  /** 测试可注入；生产复用受管图片资源释放通道。 */
  releaseCreatedFiles?: (filePaths: string[]) => Promise<void>
  /** layer-stack 必须由主进程全量验证/合成后注入，通用落图器不会自行猜图层语义。 */
  preparedLayerStack?: LayerStackDocumentV1
}

export interface CommitCanvasGenerationOutputsResult {
  projectId: string
  completionId: string
  strategy: CanvasGenerationOutputStrategy
  resultNodeIds: string[]
  groupNodeId: string | null
  idempotent: boolean
}
