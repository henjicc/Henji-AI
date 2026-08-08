import { z } from 'zod'

import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationExecutionContext,
  ApplicationMutationExecutor,
  ApplicationMutationOperation,
  ApplicationPlannedStep,
  ApplicationPropertyWriterTable,
  ApplicationSemanticOperationExecutor,
  JsonValue,
} from '@/core/application-control'
import { applyWriterTable, propertyOperations, writableProperties } from '@/core/application-control'

import { saveCurrentProject } from '../projects/cameraStageProjectService'
import { useCameraStageStore } from '../store/cameraStageStore'
import { cameraStageApplicationService } from './cameraStageApplicationService'
import { applyCameraStageMotion } from './cameraMotionService'
import { restoreCameraStageUndo, captureCameraStageUndo } from './cameraStageUndo'
import { CAMERA_STAGE_CAMERA_WRITERS, CAMERA_STAGE_OBJECT_WRITERS, type CameraStageObjectDraft } from './cameraStageObjectFields'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'
import { CAMERA_STAGE_SCENE_WRITERS } from './cameraStageSceneFields'
import {
  CAMERA_STAGE_KEYFRAME_WRITERS,
  CAMERA_STAGE_PLAYBACK_WRITERS,
  CAMERA_STAGE_PROJECT_WRITERS,
  CAMERA_STAGE_SHOT_WRITERS,
  type CameraStageKeyframeDraft,
  type CameraStagePlaybackDraft,
  type CameraStageProjectDraft,
  type CameraStageShotDraft,
} from './cameraStageTimelineFields'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
type MutationEntityType = Exclude<typeof CAMERA_STAGE_ENTITY_TYPES[keyof typeof CAMERA_STAGE_ENTITY_TYPES], 'camera_stage.trajectory'>

export interface CameraStageControlExecutorDependencies {
  readRevision: () => number
  bumpRevision: () => void
}

function childTarget(id: string): { projectId: string; childId: string } {
  const separator = id.indexOf(':')
  if (separator < 1) throw new Error('NOT_FOUND')
  return { projectId: id.slice(0, separator), childId: id.slice(separator + 1) }
}

/** 六类实体各一张写入表；`writableProperties` 由它派生，门禁据此与反射层声明做双向比对。 */
const WRITER_TABLES = {
  [CAMERA_STAGE_ENTITY_TYPES.project]: CAMERA_STAGE_PROJECT_WRITERS,
  [CAMERA_STAGE_ENTITY_TYPES.scene]: CAMERA_STAGE_SCENE_WRITERS,
  [CAMERA_STAGE_ENTITY_TYPES.object]: CAMERA_STAGE_OBJECT_WRITERS,
  [CAMERA_STAGE_ENTITY_TYPES.camera]: CAMERA_STAGE_CAMERA_WRITERS,
  [CAMERA_STAGE_ENTITY_TYPES.shot]: CAMERA_STAGE_SHOT_WRITERS,
  [CAMERA_STAGE_ENTITY_TYPES.keyframe]: CAMERA_STAGE_KEYFRAME_WRITERS,
  [CAMERA_STAGE_ENTITY_TYPES.playback]: CAMERA_STAGE_PLAYBACK_WRITERS,
} as const satisfies Record<MutationEntityType, ApplicationPropertyWriterTable<never>>

function mutationEvidence(step: MutationStep, revision: number): ApplicationEvidence[] {
  return step.mutations.map((mutation) => ({
    kind: 'property_value',
    target: { ...step.target, revision },
    fact: `三维属性 ${mutation.propertyId} 已更新。`,
    data: mutation.value,
    capturedAt: new Date().toISOString(),
  }))
}

export class CameraStageMutationExecutor implements ApplicationMutationExecutor {
  readonly writableProperties: ReadonlySet<string>
  readonly propertyOperations: ReadonlyMap<string, ReadonlySet<ApplicationMutationOperation>>

  constructor(
    readonly entityType: MutationEntityType,
    private readonly dependencies: CameraStageControlExecutorDependencies,
  ) {
    this.writableProperties = writableProperties(WRITER_TABLES[entityType])
    this.propertyOperations = propertyOperations(WRITER_TABLES[entityType])
  }

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    if (step.entityType !== this.entityType || step.target.kind !== this.entityType) throw new Error('NOT_FOUND')
    const undoToken = await this.applyMutations(step)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { toolbox: revision },
      producedRefs: [{ ...step.target, revision }],
      evidence: mutationEvidence(step, revision),
      undoToken,
    }
  }

  async compensate(
    _step: MutationStep,
    result: ApplicationCompletedStepResult,
  ): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) throw new Error('UNDO_NOT_SUPPORTED')
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const restored = await restoreCameraStageUndo(undoToken)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { toolbox: revision },
      producedRefs: [{ kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision }],
      evidence: [{
        kind: 'entity_state',
        target: { kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision },
        fact: '三维工程已撤销到事务前状态。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }

  private async applyMutations(step: MutationStep): Promise<string> {
    if (this.entityType === CAMERA_STAGE_ENTITY_TYPES.project) return await this.applyProject(step)
    if (this.entityType === CAMERA_STAGE_ENTITY_TYPES.scene) return await this.applyScene(step)
    if (this.entityType === CAMERA_STAGE_ENTITY_TYPES.object || this.entityType === CAMERA_STAGE_ENTITY_TYPES.camera) return await this.applyObject(step)
    if (this.entityType === CAMERA_STAGE_ENTITY_TYPES.shot) return await this.applyShot(step)
    if (this.entityType === CAMERA_STAGE_ENTITY_TYPES.playback) return await this.applyPlayback(step)
    return await this.applyKeyframe(step)
  }

  private async applyProject(step: MutationStep): Promise<string> {
    const projectId = step.target.id
    await cameraStageApplicationService.openProject(projectId)
    const undoToken = captureCameraStageUndo(projectId)
    const draft: CameraStageProjectDraft = { projectId }
    await applyWriterTable(CAMERA_STAGE_PROJECT_WRITERS, draft, step.mutations)
    if (draft.rename !== undefined) await cameraStageApplicationService.renameProject(projectId, draft.rename)
    return undoToken
  }

  private async applyScene(step: MutationStep): Promise<string> {
    const projectId = step.target.id
    await cameraStageApplicationService.openProject(projectId)
    const undoToken = captureCameraStageUndo(projectId)
    await applyWriterTable(CAMERA_STAGE_SCENE_WRITERS, useCameraStageStore.getState(), step.mutations)
    await saveCurrentProject()
    return undoToken
  }

  /**
   * 建模属性（name/color/transform 等）与动画属性（animatable.* / pose_preset）落地到两个
   * 语义完全不同的 store 路径（见 cameraStageObjectFields.ts 顶部注释），一批写入里混用
   * 会让其中一种语义悄悄失效，所以在提交前拒绝，而不是二选一静默丢弃另一半。
   */
  private async applyObject(step: MutationStep): Promise<string> {
    const { projectId, childId: objectId } = childTarget(step.target.id)
    const snapshot = await cameraStageApplicationService.readSnapshot(projectId)
    const current = snapshot.objects.find((object) => object.id === objectId)
    if (!current) throw new Error('NOT_FOUND')
    const draft: CameraStageObjectDraft = {
      current,
      update: {},
      transform: { ...current.transform },
      transformTouched: false,
      animatable: {},
    }
    const table = this.entityType === CAMERA_STAGE_ENTITY_TYPES.camera
      ? CAMERA_STAGE_CAMERA_WRITERS
      : CAMERA_STAGE_OBJECT_WRITERS
    await applyWriterTable(table, draft, step.mutations)
    if (draft.transformTouched) draft.update.transform = draft.transform
    const hasRegular = Object.keys(draft.update).length > 0
    const hasAnimatable = Object.keys(draft.animatable).length > 0
    const hasPosePreset = draft.posePresetId !== undefined
    if ([hasRegular, hasAnimatable, hasPosePreset].filter(Boolean).length > 1) {
      throw new Error(
        'MIXED_MUTATION_NOT_SUPPORTED：一次写入不能同时包含建模属性（name/color/transform 等）、'
        + '逐分量动画属性（animatable.*）与姿态预设（pose_preset），请分开调用。'
      )
    }
    if (hasAnimatable) {
      return (await cameraStageApplicationService.updateAnimatableProperties(projectId, objectId, draft.animatable)).undoToken
    }
    if (hasPosePreset) {
      return (await cameraStageApplicationService.applyObjectPosePreset(projectId, objectId, draft.posePresetId!)).undoToken
    }
    return (await cameraStageApplicationService.updateObject(projectId, objectId, draft.update)).undoToken
  }

  private async applyShot(step: MutationStep): Promise<string> {
    const { projectId, childId: shotId } = childTarget(step.target.id)
    const draft: CameraStageShotDraft = {}
    await applyWriterTable(CAMERA_STAGE_SHOT_WRITERS, draft, step.mutations)
    return (await cameraStageApplicationService.updateShot(projectId, shotId, draft)).undoToken
  }

  private async applyPlayback(step: MutationStep): Promise<string> {
    const projectId = step.target.id
    await cameraStageApplicationService.openProject(projectId)
    const undoToken = captureCameraStageUndo(projectId)
    const draft: CameraStagePlaybackDraft = {}
    await applyWriterTable(CAMERA_STAGE_PLAYBACK_WRITERS, draft, step.mutations)
    await cameraStageApplicationService.updatePlayback(projectId, draft)
    // 播放态不进工程文件，所以这里不落盘。
    return undoToken
  }

  private async applyKeyframe(step: MutationStep): Promise<string> {
    const { projectId, childId } = childTarget(step.target.id)
    await cameraStageApplicationService.openProject(projectId)
    const parts = childId.split(':')
    const objectId = parts.shift()
    const originalTime = Number(parts.pop())
    const path = parts.join(':')
    if (!objectId || !path || !Number.isFinite(originalTime)) throw new Error('NOT_FOUND')
    const undoToken = captureCameraStageUndo(projectId)
    const draft: CameraStageKeyframeDraft = { objectId, path, currentTime: originalTime }
    await applyWriterTable(CAMERA_STAGE_KEYFRAME_WRITERS, draft, step.mutations)
    await saveCurrentProject()
    return undoToken
  }
}

const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() }).strict()
const motionInputSchema = z.object({
  projectId: z.string().min(1),
  cameraId: z.string().min(1),
  move: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('orbit'), degrees: z.number().min(1).max(1440), direction: z.enum(['cw', 'ccw']) }).strict(),
    z.object({ kind: z.enum(['dollyIn', 'dollyOut']), distanceRatio: z.number().min(0.05).max(20) }).strict(),
    z.object({ kind: z.literal('truck'), offset: z.number().min(-10_000).max(10_000) }).strict(),
    z.object({ kind: z.literal('crane'), height: z.number().min(-10_000).max(10_000) }).strict(),
  ]),
  targetObjectId: z.string().min(1).optional(),
  targetPoint: vec3Schema.optional(),
  startShotId: z.string().min(1).optional(),
  endShotId: z.string().min(1).optional(),
  startTime: z.number().min(0).max(3600).optional(),
  duration: z.number().positive().max(3600),
  speed: z.enum(['uniform', 'easeInOut', 'fastStart', 'slowStart']),
}).strict()

export class CameraStageMotionOperationExecutor implements ApplicationSemanticOperationExecutor {
  readonly capabilityId = 'apply_camera_stage_camera_move'
  readonly capabilityVersion = 1
  readonly risk = 'R1' as const
  readonly requiredPermissions = ['camera_stage:write']
  readonly supportsAtomic = true

  constructor(private readonly dependencies: CameraStageControlExecutorDependencies) {}

  normalizeInput(input: JsonValue): JsonValue {
    return motionInputSchema.parse(input) as JsonValue
  }

  async getCurrentRevisions(): Promise<Record<string, number>> {
    return { toolbox: this.dependencies.readRevision() }
  }

  async execute(input: JsonValue, _context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const result = await applyCameraStageMotion(motionInputSchema.parse(input))
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { toolbox: revision },
      producedRefs: [
        { kind: CAMERA_STAGE_ENTITY_TYPES.camera, id: `${result.projectId}:${result.cameraId}`, revision },
        ...result.affectedShotIds.map((id) => ({ kind: CAMERA_STAGE_ENTITY_TYPES.shot, id: `${result.projectId}:${id}`, revision })),
      ],
      evidence: [{
        kind: 'operation_result',
        target: { kind: CAMERA_STAGE_ENTITY_TYPES.camera, id: `${result.projectId}:${result.cameraId}`, revision },
        fact: '三维摄像机运镜已应用。',
        data: {
          moveKind: result.moveKind,
          path: {
            source: result.path.source,
            sampleCount: result.path.sampleCount,
            start: { x: result.path.start.x, y: result.path.start.y, z: result.path.start.z },
            end: { x: result.path.end.x, y: result.path.end.y, z: result.path.end.z },
          },
          affectedShotIds: result.affectedShotIds,
          affectedKeyframeCount: result.affectedKeyframeCount,
        },
        capturedAt: new Date().toISOString(),
      }],
      undoToken: result.undoToken,
    }
  }

  async compensate(_input: JsonValue, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) throw new Error('UNDO_NOT_SUPPORTED')
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const restored = await restoreCameraStageUndo(undoToken)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { toolbox: revision },
      producedRefs: [{ kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision }],
      evidence: [{ kind: 'entity_state', fact: '三维运镜已撤销。', target: { kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision }, capturedAt: new Date().toISOString() }],
    }
  }
}

export const CAMERA_STAGE_MUTATION_ENTITY_TYPES: MutationEntityType[] = [
  CAMERA_STAGE_ENTITY_TYPES.project,
  CAMERA_STAGE_ENTITY_TYPES.scene,
  CAMERA_STAGE_ENTITY_TYPES.object,
  CAMERA_STAGE_ENTITY_TYPES.camera,
  CAMERA_STAGE_ENTITY_TYPES.shot,
  CAMERA_STAGE_ENTITY_TYPES.keyframe,
  CAMERA_STAGE_ENTITY_TYPES.playback,
]
