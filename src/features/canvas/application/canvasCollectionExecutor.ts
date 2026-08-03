import type {
  ApplicationCollectionExecutor,
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationPlannedStep,
  ApplicationRef,
  JsonValue,
} from '@/core/application-control'
import type { CanvasBatchOperation } from '@/core/assistant/capabilities/canvasBatchApplicationCapabilities'

import { applyCanvasOperationsAtomically, undoCanvasBatch } from './canvasBatchService'
import { CANVAS_ENTITY_TYPES } from './canvasReflection'

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>

export interface CanvasCollectionDependencies {
  readRevision: () => number
  bumpRevision: () => void
}

/** 引用可能是 `projectId:nodeId` 形式的稳定引用，也可能是裸 id，两者都接受。 */
function childId(value: JsonValue | undefined, label: string): string {
  const raw = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, JsonValue>).id
      : undefined
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new Error(`CANVAS_${label}_INVALID：${label} 必须是节点引用或节点 id 字符串。`)
  }
  return raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw
}

function refChildId(ref: ApplicationRef): string {
  return ref.id.includes(':') ? ref.id.slice(ref.id.indexOf(':') + 1) : ref.id
}

function property(properties: Record<string, JsonValue>, entityType: string, suffix: string): JsonValue | undefined {
  return properties[`${entityType}.${suffix}`]
}

/**
 * 画布节点与连线的集合写入执行器。
 *
 * **不含任何自己的写入逻辑**：全部委托 `applyCanvasOperationsAtomically`，与批量能力共用同一个
 * 内核。画布已经有一套完整的「抓快照—执行—失败整批回滚—合并撤销历史」实现，再写一份就是
 * 本项目已经吃过四次亏的那种双路径。
 */
export class CanvasCollectionExecutor implements ApplicationCollectionExecutor {
  constructor(
    readonly entityType: string,
    private readonly dependencies: CanvasCollectionDependencies,
  ) {}

  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    const projectId = step.parent.id.includes(':')
      ? step.parent.id.slice(0, step.parent.id.indexOf(':'))
      : step.parent.id
    const operations = this.toOperations(step)
    const { appliedOperations, undoRef } = await applyCanvasOperationsAtomically(projectId, operations, {
      source: 'application_collection', entityType: this.entityType,
    })
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    const producedRefs = appliedOperations.flatMap((result) => {
      const id = typeof result.nodeId === 'string'
        ? result.nodeId
        : typeof result.edgeId === 'string' ? result.edgeId : null
      return id ? [{ kind: this.entityType, id: `${projectId}:${id}`, revision }] : []
    })
    return {
      status: 'completed',
      resultingRevisions: { canvas: revision },
      producedRefs: producedRefs.slice(0, 64),
      evidence: [{
        kind: 'operation_result',
        target: { kind: CANVAS_ENTITY_TYPES.project, id: projectId, revision },
        fact: step.operation.kind === 'create'
          ? `已在画布中创建 ${appliedOperations.length} 个${this.entityType === CANVAS_ENTITY_TYPES.edge ? '连线' : '节点'}。`
          : `已从画布中删除 ${appliedOperations.length} 个${this.entityType === CANVAS_ENTITY_TYPES.edge ? '连线' : '节点'}。`,
        data: { operationCount: appliedOperations.length, entityType: this.entityType },
        capturedAt: new Date().toISOString(),
      }],
      undoToken: undoRef,
    }
  }

  async compensate(_step: CollectionStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    // undoCanvasBatch 需要 projectId 做归属与指纹校验，从撤销记录本身取不到，
    // 因此用当前工程；集合写入始终发生在当前打开的工程上，这一点由 requireCurrentCanvasProject 保证。
    const projectId = String(undoToken.split(':')[1] ?? '')
    const restored = undoCanvasBatch(projectId, undoToken)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { canvas: revision },
      producedRefs: [],
      evidence: [{
        kind: 'entity_state',
        target: { kind: CANVAS_ENTITY_TYPES.project, id: String(restored?.projectId ?? projectId), revision },
        fact: '画布集合写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }

  private toOperations(step: CollectionStep): CanvasBatchOperation[] {
    const isEdge = this.entityType === CANVAS_ENTITY_TYPES.edge
    if (step.operation.kind === 'create') {
      return step.operation.items.map((item, index) => {
        if (isEdge) {
          return {
            kind: 'connect_nodes' as const,
            sourceNodeId: childId(property(item.properties, CANVAS_ENTITY_TYPES.edge, 'source_ref'), `SOURCE_REF[${index}]`),
            targetNodeId: childId(property(item.properties, CANVAS_ENTITY_TYPES.edge, 'target_ref'), `TARGET_REF[${index}]`),
          }
        }
        const nodeType = property(item.properties, CANVAS_ENTITY_TYPES.node, 'node_type')
        if (typeof nodeType !== 'string' || nodeType.trim() === '') {
          throw new Error(`CANVAS_NODE_TYPE_INVALID：第 ${index} 项缺少 ${CANVAS_ENTITY_TYPES.node}.node_type。`)
        }
        // placement 只支持 viewport_center / right_of_node，没有绝对坐标模式。
        // 要指定精确位置就在创建之后用 set_properties 写 canvas.node.position，它本来就是可写属性。
        const anchor = property(item.properties, CANVAS_ENTITY_TYPES.node, 'anchor_ref')
        return {
          kind: 'add_node' as const,
          nodeType,
          placement: anchor === undefined
            ? { mode: 'viewport_center' as const }
            : { mode: 'right_of_node' as const, anchorNodeId: childId(anchor, `ANCHOR_REF[${index}]`) },
        }
      })
    }
    if (isEdge) {
      return step.operation.targets.map((target) => ({
        kind: 'disconnect_edge' as const,
        edgeId: refChildId(target),
      }))
    }
    return [{
      kind: 'delete_nodes' as const,
      nodeIds: step.operation.targets.map((target) => refChildId(target)),
    }]
  }
}

