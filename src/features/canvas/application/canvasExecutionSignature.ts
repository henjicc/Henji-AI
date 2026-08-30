import type { CanvasEdge, CanvasNode } from '../domain/canvasNodes'
import { getIncomingEdges, getNodeIndexById } from '../domain/connectionIndex'
import { getNodeValueOutput } from '../domain/nodeRegistry'
import { createCanvasExecutionValueSignature } from './canvasExecutionCache'
import { getGraphNodeMediaOutputs } from './graphOutputResolver'

const VOLATILE_NODE_DATA_KEYS = new Set([
  'displayName',
  'latestExecution',
  'dependencyRunPolicy',
  'fixedResult',
  'lastOutput',
  'lastOutputFingerprint',
  'lastOutputRevision',
  'lastExecutionStatus',
  'syncedInputRevision',
  'isGenerating',
  'generationStartedAt',
  'generationDurationMs',
  'generationError',
  'serverTaskId',
  'serverTaskModelId',
  'generationOutputCommitId',
  'generationOutputDescriptor',
  'imageUrl',
  'previewImageUrl',
  'videoUrl',
  'audioUrl',
  'sourceFileName',
  'multiAngleBatch',
  'multiAngleResultPlaceholderId',
])

function executionInputData(node: CanvasNode): DynamicValueMap {
  return Object.fromEntries(
    Object.entries(node.data as DynamicValueMap)
      .filter(([key]) => !VOLATILE_NODE_DATA_KEYS.has(key)),
  )
}

/**
 * 对一次节点执行真正可观察到的持久输入做版本化签名。
 * 只在运行规划阶段调用，不进入画布渲染热路径，也不读取媒体文件内容。
 */
export function createCanvasNodeInputSignature(
  nodeId: string,
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  extras?: unknown,
): string {
  const nodeById = getNodeIndexById(nodes)
  const node = nodeById.get(nodeId)
  if (!node) throw new Error(`画布执行节点不存在：${nodeId}`)

  const inputs = getIncomingEdges(edges, nodeId)
    .map((edge) => {
      const sourceNode = nodeById.get(edge.source)
      if (!sourceNode) return null
      const media = getGraphNodeMediaOutputs(
        sourceNode,
        nodeById,
        edge.sourceHandle ?? 'source',
      ).map((output) => ({
        kind: output.kind,
        url: output.url,
        sourceHandle: output.sourceHandle ?? edge.sourceHandle ?? 'source',
      }))
      const value = getNodeValueOutput(sourceNode.type, sourceNode.data)
      return {
        sourceNodeId: sourceNode.id,
        sourceNodeType: sourceNode.type,
        sourceHandle: edge.sourceHandle ?? 'source',
        targetHandle: edge.targetHandle ?? 'target',
        media,
        value: value ? { socketType: value.socketType, value: value.value } : null,
      }
    })
    .filter((input): input is NonNullable<typeof input> => input !== null)

  return createCanvasExecutionValueSignature({
    contractVersion: 2,
    nodeType: node.type,
    data: executionInputData(node),
    inputs,
    extras: extras ?? null,
  })
}
