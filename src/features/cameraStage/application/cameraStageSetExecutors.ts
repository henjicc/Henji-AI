import { z } from 'zod'

import type {
  ApplicationCollectionExecutor,
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationExecutionContext,
  ApplicationPlannedStep,
  ApplicationSemanticOperationExecutor,
  JsonValue,
} from '@/core/application-control'
import { CAMERA_STAGE_NAME_MAX_LENGTH } from '@/core/application-control/domains/cameraStage/cameraStageCapabilitySchemas'
import { GENERATE_CAMERA_STAGE_SET_CAPABILITY_ID } from '@/core/application-control/domains/cameraStage/cameraStageSceneApplicationCapabilities'
import { cameraStageSetLayoutSchema } from '@/core/application-control/domains/cameraStage/cameraStageSetSchemas'

import { cameraStageApplicationService } from './cameraStageApplicationService'
import type { CameraStageControlExecutorDependencies } from './cameraStageControlExecutors'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'
import { forgetCameraStageUndo, restoreCameraStageUndo, afterCameraStageWrite } from './cameraStageUndo'

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>

const cameraStageSetGenerateInputSchema = z.object({
  projectId: z.string().min(1),
  layout: cameraStageSetLayoutSchema,
  name: z.string().trim().min(1).max(CAMERA_STAGE_NAME_MAX_LENGTH).optional(),
  replaceSetId: z.string().min(1).optional(),
}).strict()

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

async function undoCompleted(undoToken: string, dependencies: CameraStageControlExecutorDependencies, fact: string): Promise<ApplicationCompletedStepResult> {
  const restored = await restoreCameraStageUndo(undoToken)
  dependencies.bumpRevision()
  const revision = dependencies.readRevision()
  const target = { kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision }
  return {
    status: 'completed',
    resultingRevisions: { camera_stage: revision },
    directRefs: [target],
    directEffects: [{ effect: 'execute', entityType: CAMERA_STAGE_ENTITY_TYPES.project, refs: [target], propertyIds: [], origin: { kind: 'direct' } }],
    cascadeEffects: [],
    evidence: [{ kind: 'entity_state', target, fact, capturedAt: new Date().toISOString() }],
  }
}

/** 布景生成：一次调用整片布景进场景，事务回执只带布景引用与摘要，成员不逐个列出。 */
export class CameraStageSetGenerateOperationExecutor implements ApplicationSemanticOperationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly capabilityId = GENERATE_CAMERA_STAGE_SET_CAPABILITY_ID
  readonly capabilityVersion = 1
  readonly requiredPermissions = ['camera_stage:write']
  readonly supportsAtomic = true

  constructor(private readonly dependencies: CameraStageControlExecutorDependencies) {}

  normalizeInput(input: JsonValue): JsonValue {
    return cameraStageSetGenerateInputSchema.parse(input) as JsonValue
  }

  async getCurrentRevisions(): Promise<Record<string, number>> {
    return { camera_stage: this.dependencies.readRevision() }
  }

  async execute(input: JsonValue, _context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const parsed = cameraStageSetGenerateInputSchema.parse(input)
    const result = await cameraStageApplicationService.generateSet(parsed)
    await afterCameraStageWrite(parsed.projectId, result.undoToken, async () => {
      const snapshot = await cameraStageApplicationService.readSnapshot(parsed.projectId)
      const count = snapshot.objects.reduce((total, object) => total + (object.setId === result.set.id ? 1 : 0), 0)
      if (!snapshot.sets.some(set => set.id === result.set.id) || count !== result.set.objectCount) {
        throw new Error('生成后正式场景中的布景成员与结果不一致，已恢复到生成前。')
      }
    })
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    const ref = { kind: CAMERA_STAGE_ENTITY_TYPES.set, id: `${parsed.projectId}:${result.set.id}`, label: result.set.name, revision }
    return {
      status: 'completed',
      resultingRevisions: { camera_stage: revision },
      directRefs: [ref],
      directEffects: [{ effect: result.replaced ? 'update' : 'create', entityType: CAMERA_STAGE_ENTITY_TYPES.set, refs: [ref], propertyIds: [], origin: { kind: 'direct' } }],
      cascadeEffects: [],
      evidence: [{
        kind: 'operation_result',
        target: ref,
        fact: '三维布景已生成。',
        data: asJson({ ...result.set, replaced: result.replaced, removedObjectCount: result.removedObjectCount }),
        capturedAt: new Date().toISOString(),
      }],
      undoToken: result.undoToken,
    }
  }

  async compensate(_input: JsonValue, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  forget(undoToken: string): void {
    forgetCameraStageUndo(undoToken)
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    return await undoCompleted(undoToken, this.dependencies, '三维布景生成已撤销。')
  }
}

function setIdOf(ref: { id: string }): string {
  const separator = ref.id.indexOf(':')
  if (separator < 1) throw new Error(`STAGE_SET_REF_INVALID：«${ref.id}» 不是合法布景引用，应为 <镜头参考文档 ID>:<布景 ID>。`)
  return ref.id.slice(separator + 1)
}

/** 删除整片布景（连同全部成员）。新建布景必须经 generate_camera_stage_set，集合写入不接受 create。 */
export class CameraStageSetCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = CAMERA_STAGE_ENTITY_TYPES.set
  readonly effectContract = { direct: [], cascades: [] }
  constructor(private readonly dependencies: CameraStageControlExecutorDependencies) {}

  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    if (step.operation.kind === 'create') {
      throw new Error(`STAGE_SET_CREATE_NOT_SUPPORTED：布景要按参数生成，请调用 ${GENERATE_CAMERA_STAGE_SET_CAPABILITY_ID}。`)
    }
    const projectId = step.parent.id.includes(':') ? step.parent.id.slice(0, step.parent.id.indexOf(':')) : step.parent.id
    const setIds = step.operation.targets.map(setIdOf)
    const result = await cameraStageApplicationService.removeSets(projectId, setIds)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { camera_stage: revision },
      directRefs: setIds.map(id => ({ kind: CAMERA_STAGE_ENTITY_TYPES.set, id: `${projectId}:${id}`, revision })),
      evidence: [{
        kind: 'operation_result',
        target: { kind: CAMERA_STAGE_ENTITY_TYPES.project, id: projectId, revision },
        fact: `已删除 ${setIds.length} 片布景。`,
        data: { setIds, removedObjectCount: result.removedObjectCount },
        capturedAt: new Date().toISOString(),
      }],
      undoToken: result.undoToken,
    }
  }

  async compensate(_step: CollectionStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  forget(undoToken: string): void {
    forgetCameraStageUndo(undoToken)
  }

  /** 集合撤销的直接引用由引擎按原删除步骤给出，这里只恢复场景。 */
  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const { directEffects: _projectEffects, ...rest } = await undoCompleted(undoToken, this.dependencies, '三维布景删除已撤销。')
    return { ...rest, directRefs: [] }
  }
}
