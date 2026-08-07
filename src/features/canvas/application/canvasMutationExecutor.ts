import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationExecutionContext,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
} from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control'
import { createLogger } from '@/core/logging'
import { useCanvasStore, type CanvasEdge, type CanvasHistoryState, type CanvasNode } from '@/stores/canvasStore'
import { useProjectStore } from '@/stores/projectStore'
import { v4 as uuidv4 } from 'uuid'

import {
  CanvasApplicationError,
  persistCanvasState,
  requireCurrentCanvasProject,
} from './canvasApplicationService'
import { CANVAS_NODE_WRITERS as WRITERS } from './canvasFields'
import { applyCanvasNodePropertyPatches, type CanvasNodePropertyPatch } from './canvasMutationService'
import { CANVAS_ENTITY_TYPES } from './canvasReflection'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

interface CanvasUndoEntry {
  projectId: string
  nodes: CanvasNode[]
  edges: CanvasEdge[]
  history: CanvasHistoryState
  afterFingerprint: string
}

const logger = createLogger('features.canvas.mutation')

function splitNodeRef(id: string): { projectId: string; nodeId: string } {
  const separator = id.indexOf(':')
  if (separator < 1) throw new CanvasApplicationError('INVALID_INPUT', '画布节点引用缺少项目前缀')
  return { projectId: id.slice(0, separator), nodeId: id.slice(separator + 1) }
}

function fingerprint(nodes: CanvasNode[], edges: CanvasEdge[]): string {
  return JSON.stringify({
    nodes: nodes.map((node) => ({ id: node.id, position: node.position, data: node.data })),
    edges: edges.map((edge) => ({
      id: edge.id, source: edge.source, target: edge.target,
      sourceHandle: edge.sourceHandle, targetHandle: edge.targetHandle,
    })),
  })
}

function revision(): number {
  return Math.max(0, Math.trunc(useProjectStore.getState().currentProject?.updatedAt ?? 0))
}

export class CanvasNodeMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = CANVAS_ENTITY_TYPES.node
  readonly writableProperties = writableProperties(WRITERS)
  readonly propertyOperations = propertyOperations(WRITERS)
  private readonly undoEntries = new Map<string, CanvasUndoEntry>()

  async apply(step: MutationStep, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    return (await this.applyAtomic([step], context))[0]
  }

  async applyAtomic(
    steps: MutationStep[],
    context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult[]> {
    const targets = steps.map((step) => ({ step, ...splitNodeRef(step.target.id) }))
    const projectIds = new Set(targets.map((target) => target.projectId))
    if (projectIds.size !== 1) throw new CanvasApplicationError('INVALID_INPUT', '画布节点事务不能跨项目')
    const projectId = targets[0]?.projectId
    if (!projectId) throw new CanvasApplicationError('INVALID_INPUT', '画布节点事务为空')
    requireCurrentCanvasProject(projectId)
    const canvas = useCanvasStore.getState()
    const before: CanvasUndoEntry = {
      projectId,
      nodes: structuredClone(canvas.nodes),
      edges: structuredClone(canvas.edges),
      history: structuredClone(canvas.history),
      afterFingerprint: '',
    }

    logger.info('画布节点事务开始', {
      event: 'canvas.mutation.apply.start', requestId: context.requestId,
      projectId, nodeIds: targets.map((target) => target.nodeId),
    })
    try {
      const patches: CanvasNodePropertyPatch[] = []
      for (const target of targets) {
        const node = useCanvasStore.getState().nodes.find((item) => item.id === target.nodeId)
        if (!node) throw new CanvasApplicationError('NOT_FOUND', '画布节点不存在', true, { nodeId: target.nodeId })
        const patch: CanvasNodePropertyPatch = { nodeId: target.nodeId }
        await applyWriterTable(WRITERS, patch, target.step.mutations)
        patches.push(patch)
      }
      applyCanvasNodePropertyPatches(projectId, patches)
    } catch (error) {
      useCanvasStore.getState().setCanvasData(before.nodes, before.edges, before.history)
      persistCanvasState()
      logger.error('画布节点事务失败', error, {
        event: 'canvas.mutation.apply.failed', requestId: context.requestId, projectId,
      })
      throw error
    }

    const current = useCanvasStore.getState()
    const undoToken = `canvas-control-undo:${uuidv4()}`
    before.afterFingerprint = fingerprint(current.nodes, current.edges)
    this.undoEntries.set(undoToken, before)
    const resultingRevision = revision()
    logger.info('画布节点事务完成', {
      event: 'canvas.mutation.apply.completed', requestId: context.requestId,
      projectId, revision: resultingRevision,
    })
    return targets.map((target) => ({
      status: 'completed' as const,
      resultingRevisions: { canvas: resultingRevision },
      producedRefs: [{ kind: this.entityType, id: `${projectId}:${target.nodeId}`, revision: resultingRevision }],
      evidence: target.step.mutations.map((mutation) => ({
        kind: 'property_value' as const,
        target: { kind: this.entityType, id: `${projectId}:${target.nodeId}`, revision: resultingRevision },
        fact: `画布节点属性 ${mutation.propertyId} 已更新。`,
        data: mutation.value,
        capturedAt: new Date().toISOString(),
      })),
      undoToken,
    }))
  }

  async compensate(
    _step: MutationStep,
    result: ApplicationCompletedStepResult,
    context: ApplicationExecutionContext
  ): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) throw new Error('UNDO_NOT_SUPPORTED')
    return (await this.undo(result.undoToken, context)).evidence
  }

  async undo(undoToken: string, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const entry = this.undoEntries.get(undoToken)
    if (!entry) throw new CanvasApplicationError('NOT_FOUND', '画布撤销引用不存在')
    requireCurrentCanvasProject(entry.projectId)
    const canvas = useCanvasStore.getState()
    if (fingerprint(canvas.nodes, canvas.edges) !== entry.afterFingerprint) {
      throw new CanvasApplicationError('STALE_CONTEXT', '画布在事务后已变化，撤销引用失效')
    }
    logger.info('画布节点事务撤销开始', {
      event: 'canvas.mutation.undo.start', requestId: context.requestId, projectId: entry.projectId,
    })
    try {
      canvas.setCanvasData(entry.nodes, entry.edges, entry.history)
      persistCanvasState()
      this.undoEntries.delete(undoToken)
      const resultingRevision = revision()
      logger.info('画布节点事务撤销完成', {
        event: 'canvas.mutation.undo.completed', requestId: context.requestId,
        projectId: entry.projectId, revision: resultingRevision,
      })
      return {
        status: 'completed',
        resultingRevisions: { canvas: resultingRevision },
        producedRefs: [{ kind: CANVAS_ENTITY_TYPES.project, id: entry.projectId, revision: resultingRevision }],
        evidence: [{
          kind: 'entity_state',
          target: { kind: CANVAS_ENTITY_TYPES.project, id: entry.projectId, revision: resultingRevision },
          fact: '画布节点事务已整体撤销。',
          capturedAt: new Date().toISOString(),
        }],
      }
    } catch (error) {
      logger.error('画布节点事务撤销失败', error, {
        event: 'canvas.mutation.undo.failed', requestId: context.requestId, projectId: entry.projectId,
      })
      throw error
    }
  }
}
