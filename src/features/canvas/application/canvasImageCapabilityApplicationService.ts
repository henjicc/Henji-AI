import { createLogger } from '@/core/logging'
import { useCanvasStore } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'

import {
  getExecutableCanvasImageCapabilitiesForSourceNode,
  type CanvasImageCapabilityDefinition,
  type CanvasImageCapabilityId,
  type CanvasImageCapabilityImplementation,
} from '../capabilities'
import type { CanvasNode } from '../domain/canvasNodes'
import { canvasEventBus } from './canvasServices'
import {
  addCanvasNode,
  CanvasApplicationError,
  connectCanvasNodes,
} from './canvasApplicationService'
import { runCanvasTransaction } from './canvasBatchService'
import { selectCanvasNode } from './canvasMutationService'

const logger = createLogger('features.canvas.image_capability')

export type CanvasImageCapabilityExecutionResult =
  | {
      kind: 'local-tool'
      capabilityId: CanvasImageCapabilityId
      sourceNodeId: string
    }
  | {
      kind: 'canvas-node'
      capabilityId: CanvasImageCapabilityId
      sourceNodeId: string
      nodeId: string
      edgeId: string
      undoRef: string
    }

interface CanvasImageCapabilityExecutorDependencies {
  getExecutableCapabilities: typeof getExecutableCanvasImageCapabilitiesForSourceNode
}

const DEFAULT_DEPENDENCIES: CanvasImageCapabilityExecutorDependencies = {
  getExecutableCapabilities: getExecutableCanvasImageCapabilitiesForSourceNode,
}

const activeExecutions = new Map<string, Promise<CanvasImageCapabilityExecutionResult>>()

type ImplementedCanvasImageCapability = Omit<CanvasImageCapabilityDefinition, 'implementation'> & {
  implementation: Extract<CanvasImageCapabilityImplementation, { status: 'implemented' }>
}

function isImplementedCanvasImageCapability(
  capability: CanvasImageCapabilityDefinition | undefined,
): capability is ImplementedCanvasImageCapability {
  return capability?.implementation.status === 'implemented'
}

function requireCurrentProjectId(): string {
  const project = useProjectStore.getState()
  if (
    !project.currentProjectId
    || !project.currentProject
    || project.currentProject.id !== project.currentProjectId
  ) {
    throw new CanvasApplicationError('PROJECT_NOT_FOUND', '当前没有可写入的画布项目')
  }
  return project.currentProjectId
}

function requireExecutableCapability(
  sourceNodeId: string,
  capabilityId: CanvasImageCapabilityId,
  dependencies: CanvasImageCapabilityExecutorDependencies,
): { sourceNode: CanvasNode; capability: ImplementedCanvasImageCapability } {
  const sourceNode = useCanvasStore.getState().nodes.find((node) => node.id === sourceNodeId)
  if (!sourceNode) {
    throw new CanvasApplicationError('NOT_FOUND', '图片能力的来源节点不存在', true, { sourceNodeId })
  }
  const capability = dependencies.getExecutableCapabilities(sourceNode)
    .find((definition) => definition.id === capabilityId)
  if (!isImplementedCanvasImageCapability(capability)) {
    throw new CanvasApplicationError(
      'CAPABILITY_REJECTED',
      '当前图片或功能状态不支持该操作',
      true,
      { sourceNodeId, capabilityId },
    )
  }
  return { sourceNode, capability }
}

async function executeCanvasImageCapability(
  sourceNodeId: string,
  capabilityId: CanvasImageCapabilityId,
  dependencies: CanvasImageCapabilityExecutorDependencies,
): Promise<CanvasImageCapabilityExecutionResult> {
  const { capability } = requireExecutableCapability(sourceNodeId, capabilityId, dependencies)
  const execution = capability.implementation.execution
  logger.info('画布图片能力执行开始', {
    event: 'canvas.image_capability.execute.start',
    sourceNodeId,
    capabilityId,
    executionKind: execution.kind,
  })

  try {
    if (execution.kind === 'local-tool') {
      canvasEventBus.publish('tool-dialog/open', {
        nodeId: sourceNodeId,
        toolType: execution.toolType,
      })
      const result: CanvasImageCapabilityExecutionResult = {
        kind: 'local-tool',
        capabilityId,
        sourceNodeId,
      }
      logger.info('画布图片能力执行完成', {
        event: 'canvas.image_capability.execute.completed',
        sourceNodeId,
        capabilityId,
        executionKind: execution.kind,
      })
      return result
    }

    const projectId = requireCurrentProjectId()
    let createdNodeId = ''
    let createdEdgeId = ''
    const { undoRef } = await runCanvasTransaction(
      projectId,
      3,
      async () => {
        const created = addCanvasNode({
          projectId,
          nodeType: execution.nodeType,
          placement: { mode: 'right_of_node', anchorNodeId: sourceNodeId },
        })
        if (typeof created.nodeId !== 'string' || !created.nodeId) {
          throw new CanvasApplicationError('CAPABILITY_REJECTED', '图片能力未能创建目标节点')
        }
        const nodeId = created.nodeId
        const connection = connectCanvasNodes({
          projectId,
          sourceNodeId,
          targetNodeId: nodeId,
        })
        if (typeof connection.edgeId !== 'string' || !connection.edgeId) {
          throw new CanvasApplicationError('CAPABILITY_REJECTED', '图片能力未能创建目标连线')
        }
        createdNodeId = nodeId
        createdEdgeId = connection.edgeId

        const canvas = useCanvasStore.getState()
        canvas.onNodesChange(canvas.nodes.map((node) => ({
          id: node.id,
          type: 'select' as const,
          selected: node.id === nodeId,
        })))
        const selected = selectCanvasNode(projectId, nodeId)

        return [created, connection, selected]
      },
      { capabilityId, sourceNodeId },
    )
    const nodeId = createdNodeId
    const edgeId = createdEdgeId
    // 事务内核合并历史时会重载节点快照；显式恢复业务选中 id。
    useCanvasStore.getState().setSelectedNode(nodeId)
    const result: CanvasImageCapabilityExecutionResult = {
      kind: 'canvas-node',
      capabilityId,
      sourceNodeId,
      nodeId,
      edgeId,
      undoRef,
    }
    logger.info('画布图片能力执行完成', {
      event: 'canvas.image_capability.execute.completed',
      projectId,
      sourceNodeId,
      capabilityId,
      executionKind: execution.kind,
      nodeId,
      edgeId,
      undoRef,
    })
    return result
  } catch (error) {
    logger.error('画布图片能力执行失败', error, {
      event: 'canvas.image_capability.execute.failed',
      sourceNodeId,
      capabilityId,
      executionKind: execution.kind,
    })
    throw error
  }
}

export function createCanvasImageCapabilityExecutor(
  dependencies: CanvasImageCapabilityExecutorDependencies = DEFAULT_DEPENDENCIES,
): (sourceNodeId: string, capabilityId: CanvasImageCapabilityId) => Promise<CanvasImageCapabilityExecutionResult> {
  return (sourceNodeId, capabilityId) => {
    const executionKey = `${sourceNodeId}:${capabilityId}`
    const active = activeExecutions.get(executionKey)
    if (active) return active

    const execution = executeCanvasImageCapability(sourceNodeId, capabilityId, dependencies)
    activeExecutions.set(executionKey, execution)
    void execution.finally(() => {
      if (activeExecutions.get(executionKey) === execution) activeExecutions.delete(executionKey)
    }).catch(() => undefined)
    return execution
  }
}

export const executeCanvasImageCapabilityFromSource = createCanvasImageCapabilityExecutor()

export function resetCanvasImageCapabilityApplicationStateForTests(): void {
  activeExecutions.clear()
}
