import type { CanvasNode } from '../domain/canvasNodes'
import { getNodeMediaOutputs } from '../domain/nodeRegistry'
import type { NodeMediaOutput } from '../domain/nodePorts'
import {
  type CanvasExecutionOutputRefV1,
  readCanvasLatestExecution,
} from './canvasExecutionCache'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/**
 * 校验“配方节点 -> 结果节点”的发布引用仍指向同一次、同一项输出。
 * 老项目缺少新增元数据时保持兼容；一旦两端都声明了字段，就必须完全一致。
 */
export function isCanvasExecutionOutputRefValid(
  sourceNode: CanvasNode,
  reference: CanvasExecutionOutputRefV1,
  resultNode: CanvasNode | undefined,
): resultNode is CanvasNode {
  if (
    !resultNode
    || resultNode.data.isGenerating === true
    || Boolean(resultNode.data.generationError)
    || getNodeMediaOutputs(resultNode.type, resultNode.data).length === 0
  ) return false

  const resultData = resultNode.data as DynamicValueMap
  const persistedSourceNodeId = resultData.generationSourceNodeId
  if (
    typeof persistedSourceNodeId === 'string'
    && persistedSourceNodeId.length > 0
    && persistedSourceNodeId !== sourceNode.id
  ) return false

  const completionId = resultData.generationOutputCommitId
  if (
    reference.completionId
    && (typeof completionId !== 'string' || completionId !== reference.completionId)
  ) return false

  const descriptor = resultData.generationOutputDescriptor
  if (isRecord(descriptor)) {
    if (
      reference.outputId
      && (typeof descriptor.outputId !== 'string' || descriptor.outputId !== reference.outputId)
    ) return false
    if (typeof descriptor.order === 'number' && descriptor.order !== reference.order) return false
  } else if (reference.outputId) {
    return false
  }

  return true
}

/**
 * 解析一条源节点连线当前发布的媒体。
 *
 * 生成配方节点把最近一次成功结果保存为稳定节点引用；结果媒体仍只存在于结果节点，
 * 这里仅沿引用读取，避免把 URL 复制成第二份真相源。
 */
export function getGraphNodeMediaOutputs(
  sourceNode: CanvasNode,
  nodeById: ReadonlyMap<string, CanvasNode>,
  sourceHandle?: string,
): NodeMediaOutput[] {
  const latestExecution = readCanvasLatestExecution(sourceNode.data)
  if (latestExecution?.outputMode === 'result-nodes') {
    return latestExecution.outputRefs.flatMap((reference) => {
      const resultNode = nodeById.get(reference.resultNodeId)
      if (!isCanvasExecutionOutputRefValid(sourceNode, reference, resultNode)) return []
      return getNodeMediaOutputs(resultNode.type, resultNode.data)
    })
  }
  if (sourceNode.data.isGenerating === true || sourceNode.data.generationError) return []
  return getNodeMediaOutputs(sourceNode.type, sourceNode.data, sourceHandle)
}
