import { z } from 'zod'

import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationExecutionContext,
  ApplicationSemanticOperationExecutor,
  JsonValue,
} from '@/core/application-control'
import { COMPOSE_CAMERA_STAGE_SHOT_CAPABILITY_ID } from '@/core/application-control/domains/cameraStage/cameraStageShotApplicationCapabilities'
import { cameraStageShotIntentShape, refineCameraStageShotIntent } from '@/core/application-control/domains/cameraStage/cameraStageShotSchemas'

import { composeCameraStageShot } from './cameraShotService'
import type { CameraStageControlExecutorDependencies } from './cameraStageControlExecutors'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'
import { forgetCameraStageUndo, restoreCameraStageUndo } from './cameraStageUndo'

export const cameraStageShotInputSchema = z.object({ projectId: z.string().min(1), ...cameraStageShotIntentShape }).strict().superRefine(refineCameraStageShotIntent)

const CAMERA_PROPERTY_IDS = [
  'camera_stage.camera.transform.position', 'camera_stage.camera.transform.rotation',
  'camera_stage.camera.fov', 'camera_stage.camera.look_at_target',
]

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/** 按构图意图摆机位：一次调用一个撤销点；给了时间点时新建或更新那一张状态关键帧。 */
export class CameraStageShotOperationExecutor implements ApplicationSemanticOperationExecutor {
  readonly effectContract = {
    direct: [],
    cascades: [
      { declarationId: 'camera_stage.composed_state_keyframe_create', effect: 'create' as const, entityType: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe, propertyIds: [], revisionScopes: ['camera_stage'] },
      { declarationId: 'camera_stage.composed_state_keyframe_update', effect: 'update' as const, entityType: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe, propertyIds: [], revisionScopes: ['camera_stage'] },
    ],
  }
  readonly capabilityId = COMPOSE_CAMERA_STAGE_SHOT_CAPABILITY_ID
  readonly capabilityVersion = 1
  readonly requiredPermissions = ['camera_stage:write']
  readonly supportsAtomic = true

  constructor(private readonly dependencies: CameraStageControlExecutorDependencies) {}

  normalizeInput(input: JsonValue): JsonValue {
    return cameraStageShotInputSchema.parse(input) as JsonValue
  }

  async getCurrentRevisions(): Promise<Record<string, number>> {
    return { camera_stage: this.dependencies.readRevision() }
  }

  async execute(input: JsonValue, _context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const result = await composeCameraStageShot(cameraStageShotInputSchema.parse(input))
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    const cameraRefs = result.shots.map((shot) => ({ kind: CAMERA_STAGE_ENTITY_TYPES.camera, id: `${result.projectId}:${shot.cameraId}`, label: shot.name, revision }))
    const stateKeyframeRef = result.stateKeyframeId
      ? { kind: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe, id: `${result.projectId}:${result.stateKeyframeId}`, revision }
      : null
    return {
      status: 'completed',
      resultingRevisions: { camera_stage: revision },
      directRefs: cameraRefs,
      directEffects: [{ effect: 'update', entityType: CAMERA_STAGE_ENTITY_TYPES.camera, refs: cameraRefs, propertyIds: CAMERA_PROPERTY_IDS, origin: { kind: 'direct' } }],
      cascadeEffects: stateKeyframeRef ? [{
        effect: result.createdStateKeyframe ? 'create' : 'update',
        entityType: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe,
        refs: [stateKeyframeRef],
        propertyIds: [],
        origin: { kind: 'cascade', declarationId: result.createdStateKeyframe ? 'camera_stage.composed_state_keyframe_create' : 'camera_stage.composed_state_keyframe_update' },
      }] : [],
      evidence: [{
        kind: 'operation_result',
        target: cameraRefs[0],
        fact: '三维摄像机已按构图意图摆好。',
        data: asJson({
          time: result.time,
          stateKeyframeId: result.stateKeyframeId,
          createdStateKeyframe: result.createdStateKeyframe,
          shots: result.shots,
          ...(result.compositionHint ? { compositionHint: result.compositionHint } : {}),
        }),
        capturedAt: new Date().toISOString(),
      }],
      undoToken: result.undoToken,
    }
  }

  async compensate(_input: JsonValue, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) throw new Error('UNDO_NOT_SUPPORTED')
    return (await this.undo(result.undoToken)).evidence
  }

  forget(undoToken: string): void {
    forgetCameraStageUndo(undoToken)
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const restored = await restoreCameraStageUndo(undoToken)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    const target = { kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision }
    return {
      status: 'completed',
      resultingRevisions: { camera_stage: revision },
      directRefs: [target],
      directEffects: [{ effect: 'execute', entityType: CAMERA_STAGE_ENTITY_TYPES.project, refs: [target], propertyIds: [], origin: { kind: 'direct' } }],
      cascadeEffects: [],
      evidence: [{ kind: 'entity_state', fact: '构图定机位已撤销。', target, capturedAt: new Date().toISOString() }],
    }
  }
}
