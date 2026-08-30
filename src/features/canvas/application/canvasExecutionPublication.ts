import { useCanvasStore } from '@/stores/canvasStore'

import { getNodeIndexById } from '../domain/connectionIndex'
import { getNodeMediaOutputs } from '../domain/nodeRegistry'
import {
  CANVAS_LATEST_EXECUTION_VERSION,
  type CanvasDependencyOutputMode,
  type CanvasExecutionOutputRefV1,
} from './canvasExecutionCache'
import { isCanvasExecutionOutputRefValid } from './graphOutputResolver'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function createOutputReference(
  sourceNodeId: string,
  resultNodeId: string,
  index: number,
  nodeById: ReturnType<typeof getNodeIndexById>,
): CanvasExecutionOutputRefV1 {
  const resultNode = nodeById.get(resultNodeId)
  if (!resultNode) throw new Error(`节点运行结果不存在：${resultNodeId}`)
  if (
    resultNode.data.isGenerating === true
    || resultNode.data.generationError
    || getNodeMediaOutputs(resultNode.type, resultNode.data).length === 0
  ) throw new Error(`节点运行结果尚不可用：${resultNodeId}`)

  const resultData = resultNode.data as DynamicValueMap
  const descriptor = resultData.generationOutputDescriptor
  if (resultData.generationSourceNodeId !== sourceNodeId) {
    throw new Error(`节点运行结果来源不匹配：${resultNodeId}`)
  }
  if (typeof resultData.generationOutputCommitId !== 'string') {
    throw new Error(`节点运行结果缺少提交身份：${resultNodeId}`)
  }
  if (
    !isRecord(descriptor)
    || typeof descriptor.outputId !== 'string'
    || typeof descriptor.order !== 'number'
  ) throw new Error(`节点运行结果缺少输出身份：${resultNodeId}`)
  return {
    resultNodeId,
    completionId: resultData.generationOutputCommitId,
    outputId: descriptor.outputId,
    order: descriptor.order ?? index,
  }
}

/** 发布一次成功执行；媒体仍只保存在结果节点，这里仅持久化稳定引用。 */
export function publishCanvasSuccessfulExecution(input: {
  sourceNodeId: string
  inputSignature: string
  outputMode: CanvasDependencyOutputMode
  resultNodeIds: string[]
}): void {
  const canvas = useCanvasStore.getState()
  const nodeById = getNodeIndexById(canvas.nodes)
  const sourceNode = nodeById.get(input.sourceNodeId)
  if (!sourceNode) throw new Error(`画布执行节点不存在：${input.sourceNodeId}`)
  const outputRefs = input.outputMode === 'result-nodes'
    ? input.resultNodeIds.map((resultNodeId, index) => (
        createOutputReference(input.sourceNodeId, resultNodeId, index, nodeById)
      ))
    : []
  if (input.outputMode === 'result-nodes' && outputRefs.length === 0) {
    throw new Error(`节点没有产生可发布的结果：${input.sourceNodeId}`)
  }
  if (outputRefs.some((reference) => (
    !isCanvasExecutionOutputRefValid(
      sourceNode,
      reference,
      nodeById.get(reference.resultNodeId),
    )
  ))) throw new Error(`节点运行结果引用无效：${input.sourceNodeId}`)

  canvas.updateNodeData(input.sourceNodeId, {
    latestExecution: {
      version: CANVAS_LATEST_EXECUTION_VERSION,
      inputSignature: input.inputSignature,
      outputMode: input.outputMode,
      outputRefs,
    },
  }, { skipHistory: true })
}
