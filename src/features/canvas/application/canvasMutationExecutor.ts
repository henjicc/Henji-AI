import { findCanvasProjectInstance, getCanvasProjectInstance, requireCanvasProjectInstance } from './canvasProjectInstances';
import type { ApplicationCompletedStepResult, ApplicationEvidence, ApplicationExecutionContext, ApplicationMutationExecutor, ApplicationPlannedStep } from '@/core/application-control';
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control';
import { createLogger } from '@/core/logging';
import { CanvasApplicationError } from './canvasApplicationService';
import { CANVAS_NODE_WRITERS as WRITERS } from './canvasFields';
import { applyCanvasNodePropertyPatches, applyStoryboardFramePatches, type CanvasNodePropertyPatch } from './canvasMutationService';
import { CANVAS_ENTITY_TYPES } from './canvasReflection';
import { runCanvasTransaction, undoCanvasBatch } from './canvasBatchService';

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

const logger = createLogger('features.canvas.mutation')

function splitNodeRef(id: string): { projectId: string; nodeId: string } {
  const separator = id.indexOf(':')
  if (separator < 1) throw new CanvasApplicationError('INVALID_INPUT', '画布节点引用缺少画布前缀')
  return { projectId: id.slice(0, separator), nodeId: id.slice(separator + 1) }
}

function revision(projectId: string): number {
  return requireCanvasProjectInstance(projectId).snapshot().updatedAt
}

export class CanvasNodeMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly entityType = CANVAS_ENTITY_TYPES.node
  readonly writableProperties = writableProperties(WRITERS)
  readonly propertyOperations = propertyOperations(WRITERS)
  private readonly undoProjects = new Map<string, string>()

  async apply(step: MutationStep, context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    return (await this.applyAtomic([step], context))[0]
  }

  async applyAtomic(
    steps: MutationStep[],
    context: ApplicationExecutionContext
  ): Promise<ApplicationCompletedStepResult[]> {
    const targets = steps.map((step) => ({ step, ...splitNodeRef(step.target.id) }))
    const projectIds = new Set(targets.map((target) => target.projectId))
    if (projectIds.size !== 1) throw new CanvasApplicationError('INVALID_INPUT', '画布节点事务不能跨画布')
    const projectId = targets[0]?.projectId
    if (!projectId) throw new CanvasApplicationError('INVALID_INPUT', '画布节点事务为空')
    if (!findCanvasProjectInstance(projectId)) await getCanvasProjectInstance(projectId)
    const transaction = await runCanvasTransaction(projectId, steps.length, async (options) => {
      const patches: CanvasNodePropertyPatch[] = []
      for (const target of targets) {
        const node = requireCanvasProjectInstance(projectId).store.getState().nodes.find((item) => item.id === target.nodeId)
        if (!node) throw new CanvasApplicationError('NOT_FOUND', '画布节点不存在', true, { nodeId: target.nodeId })
        const patch: CanvasNodePropertyPatch = { nodeId: target.nodeId }
        await applyWriterTable(WRITERS, patch, target.step.mutations)
        patches.push(patch)
      }
      await applyCanvasNodePropertyPatches(projectId, patches, options)
      for (const patch of patches) {
        if (patch.storyboardFrames) await applyStoryboardFramePatches(projectId, patch.nodeId, patch.storyboardFrames, options)
      }
      return patches.map((patch) => ({ nodeId: patch.nodeId }))
    }, { requestId: context.requestId })
    const undoToken = transaction.undoRef
    this.undoProjects.set(undoToken, projectId)
    const resultingRevision = revision(projectId)
    logger.info('画布节点事务完成', {
      event: 'canvas.mutation.apply.completed', requestId: context.requestId,
      projectId, revision: resultingRevision,
    })
    return targets.map((target) => ({
      status: 'completed' as const,
      resultingRevisions: { canvas: resultingRevision },
      directRefs: [{ kind: this.entityType, id: `${projectId}:${target.nodeId}`, revision: resultingRevision }],
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
    const projectId = this.undoProjects.get(undoToken)
    if (!projectId) throw new CanvasApplicationError('NOT_FOUND', '画布撤销引用不存在')
    if (!findCanvasProjectInstance(projectId)) await getCanvasProjectInstance(projectId)
    logger.info('画布节点事务撤销开始', {
      event: 'canvas.mutation.undo.start', requestId: context.requestId, projectId,
    })
    try {
      if (!await undoCanvasBatch(projectId, undoToken)) {
        throw new CanvasApplicationError('NOT_FOUND', '画布撤销引用不存在')
      }
      this.undoProjects.delete(undoToken)
      const resultingRevision = revision(projectId)
      logger.info('画布节点事务撤销完成', {
        event: 'canvas.mutation.undo.completed', requestId: context.requestId,
        projectId, revision: resultingRevision,
      })
      return {
        status: 'completed',
        resultingRevisions: { canvas: resultingRevision },
        directRefs: [],
        evidence: [{
          kind: 'entity_state',
          target: { kind: CANVAS_ENTITY_TYPES.project, id: projectId, revision: resultingRevision },
          fact: '画布节点事务已整体撤销。',
          capturedAt: new Date().toISOString(),
        }],
      }
    } catch (error) {
      logger.error('画布节点事务撤销失败', error, {
        event: 'canvas.mutation.undo.failed', requestId: context.requestId, projectId,
      })
      throw error
    }
  }
}
