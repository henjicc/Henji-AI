import { z } from 'zod'

import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationExecutionContext,
  ApplicationSemanticOperationExecutor,
  JsonValue,
} from '@/core/application-control'
import {
  BLOCK_CAMERA_STAGE_CHARACTER_CAPABILITY_ID,
  FOLLOW_CAMERA_STAGE_CHARACTER_CAPABILITY_ID,
} from '@/core/application-control/domains/cameraStage/cameraStageBlockingApplicationCapabilities'
import { cameraStageBlockingIntentShape, cameraStageFollowIntentShape, refineCameraStageBlocking } from '@/core/application-control/domains/cameraStage/cameraStageBlockingSchemas'

import { followCameraStageCharacter } from './cameraFollowService'
import type { CameraStageControlExecutorDependencies } from './cameraStageControlExecutors'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'
import { forgetCameraStageUndo, restoreCameraStageUndo } from './cameraStageUndo'
import { blockCameraStageCharacter } from './characterBlockingService'

export const cameraStageBlockingInputSchema = z.object({ projectId: z.string().min(1), ...cameraStageBlockingIntentShape }).strict().superRefine(refineCameraStageBlocking)
export const cameraStageFollowInputSchema = z.object({ projectId: z.string().min(1), ...cameraStageFollowIntentShape }).strict()

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

interface WrittenTimeline {
  projectId: string
  stateKeyframeIds: string[]
  createdStateKeyframes: number
  undoToken: string
}

/**
 * 走位与跟拍共用的执行器外壳：一次调用一个撤销点，直接影响角色或摄像机，级联新建或更新状态关键帧。
 * 读回整份放进证据，由适配器提到结果顶层。
 */
abstract class CameraStageTimelineOperationExecutor<Input, Result extends WrittenTimeline> implements ApplicationSemanticOperationExecutor {
  abstract readonly capabilityId: string
  readonly capabilityVersion = 1
  readonly requiredPermissions = ['camera_stage:write']
  readonly supportsAtomic = true
  protected abstract readonly declarationPrefix: string
  protected abstract readonly entityType: string
  protected abstract readonly propertyIds: string[]
  protected abstract readonly fact: string

  constructor(protected readonly dependencies: CameraStageControlExecutorDependencies) {}

  get effectContract() {
    return {
      direct: [],
      cascades: [
        { declarationId: `${this.declarationPrefix}_state_keyframe_create`, effect: 'create' as const, entityType: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe, propertyIds: [], revisionScopes: ['camera_stage'] },
        { declarationId: `${this.declarationPrefix}_state_keyframe_update`, effect: 'update' as const, entityType: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe, propertyIds: [], revisionScopes: ['camera_stage'] },
      ],
    }
  }

  protected abstract parse(input: JsonValue): Input
  protected abstract run(input: Input): Promise<Result>
  protected abstract targetId(result: Result): string
  protected abstract readback(result: Result): Record<string, unknown>

  normalizeInput(input: JsonValue): JsonValue {
    return this.parse(input) as JsonValue
  }

  async getCurrentRevisions(): Promise<Record<string, number>> {
    return { camera_stage: this.dependencies.readRevision() }
  }

  async execute(input: JsonValue, _context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const result = await this.run(this.parse(input))
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    const target = { kind: this.entityType, id: `${result.projectId}:${this.targetId(result)}`, revision }
    const refs = result.stateKeyframeIds.map((id) => ({ kind: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe, id: `${result.projectId}:${id}`, revision }))
    return {
      status: 'completed',
      resultingRevisions: { camera_stage: revision },
      directRefs: [target],
      directEffects: [{ effect: 'update', entityType: this.entityType, refs: [target], propertyIds: this.propertyIds, origin: { kind: 'direct' } }],
      cascadeEffects: refs.length > 0 ? [{
        effect: result.createdStateKeyframes > 0 ? 'create' : 'update',
        entityType: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe,
        refs,
        propertyIds: [],
        origin: { kind: 'cascade', declarationId: `${this.declarationPrefix}_state_keyframe_${result.createdStateKeyframes > 0 ? 'create' : 'update'}` },
      }] : [],
      evidence: [{ kind: 'operation_result', target, fact: this.fact, data: asJson(this.readback(result)), capturedAt: new Date().toISOString() }],
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
      evidence: [{ kind: 'entity_state', fact: `${this.fact.replace(/。$/, '')}已撤销。`, target, capturedAt: new Date().toISOString() }],
    }
  }
}

type BlockingInput = z.output<typeof cameraStageBlockingInputSchema>
type BlockingResult = Awaited<ReturnType<typeof blockCameraStageCharacter>>

export class CameraStageBlockingOperationExecutor extends CameraStageTimelineOperationExecutor<BlockingInput, BlockingResult> {
  readonly capabilityId = BLOCK_CAMERA_STAGE_CHARACTER_CAPABILITY_ID
  protected readonly declarationPrefix = 'camera_stage.blocking'
  protected readonly entityType = CAMERA_STAGE_ENTITY_TYPES.object
  protected readonly propertyIds = ['camera_stage.object.transform.position', 'camera_stage.object.transform.rotation']
  protected readonly fact = '角色走位与动作已写进时间轴。'
  protected parse(input: JsonValue): BlockingInput { return cameraStageBlockingInputSchema.parse(input) }
  protected run(input: BlockingInput): Promise<BlockingResult> { return blockCameraStageCharacter(input) }
  protected targetId(result: BlockingResult): string { return result.characterId }
  protected readback(result: BlockingResult): Record<string, unknown> {
    const { projectId: _project, undoToken: _undo, ...readback } = result
    return readback
  }
}

type FollowInput = z.output<typeof cameraStageFollowInputSchema>
type FollowResult = Awaited<ReturnType<typeof followCameraStageCharacter>>

export class CameraStageFollowOperationExecutor extends CameraStageTimelineOperationExecutor<FollowInput, FollowResult> {
  readonly capabilityId = FOLLOW_CAMERA_STAGE_CHARACTER_CAPABILITY_ID
  protected readonly declarationPrefix = 'camera_stage.follow'
  protected readonly entityType = CAMERA_STAGE_ENTITY_TYPES.camera
  protected readonly propertyIds = ['camera_stage.camera.transform.position', 'camera_stage.camera.look_at_target', 'camera_stage.camera.fov']
  protected readonly fact = '摄像机跟拍已写进时间轴。'
  protected parse(input: JsonValue): FollowInput { return cameraStageFollowInputSchema.parse(input) }
  protected run(input: FollowInput): Promise<FollowResult> { return followCameraStageCharacter(input) }
  protected targetId(result: FollowResult): string { return result.cameraId }
  protected readback(result: FollowResult): Record<string, unknown> {
    const { projectId: _project, undoToken: _undo, stateKeyframeIds: _ids, createdStateKeyframes: _created, ...readback } = result
    return readback
  }
}
