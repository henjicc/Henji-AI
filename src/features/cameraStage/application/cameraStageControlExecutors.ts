import { cameraStageMoveSchema, cameraStageRigSchema } from '@/core/application-control/domains/cameraStage/cameraStageCapabilitySchemas'
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
  ApplicationEffectReceipt,
  JsonValue,
} from '@/core/application-control'
import { applyWriterTable, directOnlyEffectContract, fieldEffectContract, propertyOperations, writableProperties } from '@/core/application-control'

import { cameraStageProjectStore, leaseCameraStageProjectRuntime, ensureCameraStageProjectRuntime, saveCameraStageProjectRuntime } from './cameraStageProjectRuntime'
import { cameraStageApplicationService } from './cameraStageApplicationService'
import { applyCameraStageMotion, type CameraStageMotionResult } from './cameraMotionService'
import type { CameraPathClearance } from './cameraPathClearance'
import { CAMERA_JOINT_JUMP_RATIO } from './cameraMotionSmoothness'
import { forgetCameraStageUndo, restoreCameraStageUndo, captureCameraStageUndo, afterCameraStageWrite } from './cameraStageUndo'
import { CAMERA_FIELDS, OBJECT_FIELDS, CAMERA_STAGE_CAMERA_WRITERS, CAMERA_STAGE_OBJECT_WRITERS, type CameraStageObjectDraft } from './cameraStageObjectFields'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'
import { CAMERA_STAGE_SCENE_WRITERS } from './cameraStageSceneFields'
import {
  CAMERA_STAGE_PLAYBACK_WRITERS,
  CAMERA_STAGE_STATE_KEYFRAME_WRITERS,
  type CameraStagePlaybackDraft,
  type CameraStageStateKeyframeDraft,
} from './cameraStageTimelineFields'
import { CAMERA_STAGE_TRAJECTORY_WRITERS, type CameraStageTrajectoryDraft } from './cameraStageTrajectoryFields'

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
/** 有属性写入执行器的实体；camera_stage.project（文档本身）只读，名称经通用 documents.document.name 改；布景只有集合删除。 */
type MutationEntityType = Exclude<typeof CAMERA_STAGE_ENTITY_TYPES[keyof typeof CAMERA_STAGE_ENTITY_TYPES], typeof CAMERA_STAGE_ENTITY_TYPES.project | typeof CAMERA_STAGE_ENTITY_TYPES.set>

export interface CameraStageControlExecutorDependencies {
  readRevision: () => number
  bumpRevision: () => void
}

function childTarget(id: string): { projectId: string; childId: string } {
  const separator = id.indexOf(':')
  if (separator < 1) throw new Error('NOT_FOUND')
  return { projectId: id.slice(0, separator), childId: id.slice(separator + 1) }
}

/** 每类公开实体各一张写入表；`writableProperties` 由它派生。 */
const WRITER_TABLES = {
  [CAMERA_STAGE_ENTITY_TYPES.scene]: CAMERA_STAGE_SCENE_WRITERS,
  [CAMERA_STAGE_ENTITY_TYPES.object]: CAMERA_STAGE_OBJECT_WRITERS,
  [CAMERA_STAGE_ENTITY_TYPES.camera]: CAMERA_STAGE_CAMERA_WRITERS,
  [CAMERA_STAGE_ENTITY_TYPES.stateKeyframe]: CAMERA_STAGE_STATE_KEYFRAME_WRITERS,
  [CAMERA_STAGE_ENTITY_TYPES.playback]: CAMERA_STAGE_PLAYBACK_WRITERS,
  [CAMERA_STAGE_ENTITY_TYPES.trajectory]: CAMERA_STAGE_TRAJECTORY_WRITERS,
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

function isAutomaticStateKeyframeMutation(step: MutationStep): boolean {
  return (step.entityType === CAMERA_STAGE_ENTITY_TYPES.object
      || step.entityType === CAMERA_STAGE_ENTITY_TYPES.camera)
    && step.mutations.some((mutation) => mutation.propertyId.includes('.animatable.')
      || mutation.propertyId.endsWith('.pose_preset'))
}

function automaticStateKeyframeEvidence(
  projectId: string,
  beforeIds: ReadonlySet<string>,
  revision: number,
): { refs: ApplicationCompletedStepResult['directRefs']; effects: ApplicationEffectReceipt[]; evidence: ApplicationEvidence[] } {
  const state = cameraStageProjectStore(projectId!).getState()
  const created = state.stateKeyframes.filter((item) => !beforeIds.has(item.id))
  const affected = created.length > 0
    ? created.map((item) => ({ item, effect: 'create' as const }))
    : state.stateKeyframes
      .filter((item) => item.id === state.selectedStateKeyframeId)
      .map((item) => ({ item, effect: 'update' as const }))
  const refs = affected.map(({ item }) => ({
    kind: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe,
    id: `${projectId}:${item.id}`,
    label: item.name,
    revision,
  }))
  return {
    refs,
    effects: affected.map(({ effect }, index) => ({
      effect,
      entityType: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe,
      refs: [refs[index]],
      propertyIds: [],
      origin: { kind: 'cascade', declarationId: `camera_stage.auto_state_keyframe_${effect}` },
    })),
    evidence: affected.map(({ effect }, index) => ({
      kind: 'entity_state',
      target: refs[index],
      fact: effect === 'create' ? '动画编辑自动创建状态关键帧。' : '动画编辑更新已有状态关键帧。',
      // 通用 change 能力以输入声明直接写入；自动打点属于领域级联副作用，必须把真实 Effect
      // 结构化带回运行时账本，不能再靠模型从文案猜“是否创建了关键帧”。
      capturedAt: new Date().toISOString(),
    })),
  }
}

export class CameraStageMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract
  readonly writableProperties: ReadonlySet<string>
  readonly propertyOperations: ReadonlyMap<string, ReadonlySet<ApplicationMutationOperation>>

  constructor(
    readonly entityType: MutationEntityType,
    private readonly dependencies: CameraStageControlExecutorDependencies,
  ) {
    this.writableProperties = writableProperties(WRITER_TABLES[entityType])
    this.propertyOperations = propertyOperations(WRITER_TABLES[entityType])
    this.effectContract = entityType === CAMERA_STAGE_ENTITY_TYPES.object
      ? fieldEffectContract(OBJECT_FIELDS)
      : entityType === CAMERA_STAGE_ENTITY_TYPES.camera
        ? fieldEffectContract(CAMERA_FIELDS)
        : directOnlyEffectContract()
  }

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const projectId = [CAMERA_STAGE_ENTITY_TYPES.project, CAMERA_STAGE_ENTITY_TYPES.scene, CAMERA_STAGE_ENTITY_TYPES.playback].some((type) => type === step.entityType) ? step.target.id : childTarget(step.target.id).projectId
    const release = await leaseCameraStageProjectRuntime(projectId)
    try { return await this.applyLeased(step) } finally { release() }
  }

  private async applyLeased(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    if (step.entityType !== this.entityType || step.target.kind !== this.entityType) throw new Error('NOT_FOUND')
    const recordsAutomaticStateKeyframe = isAutomaticStateKeyframeMutation(step)
    const projectId = recordsAutomaticStateKeyframe ? childTarget(step.target.id).projectId : null
    if (projectId) await ensureCameraStageProjectRuntime(projectId)
    const beforeStateKeyframeIds = new Set(
      recordsAutomaticStateKeyframe
        ? cameraStageProjectStore(projectId!).getState().stateKeyframes.map((item) => item.id)
        : [],
    )
    const undoToken = await this.applyMutations(step)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    const automatic = projectId
      ? automaticStateKeyframeEvidence(projectId, beforeStateKeyframeIds, revision)
      : { refs: [], effects: [], evidence: [] }
    return {
      status: 'completed',
      resultingRevisions: { camera_stage: revision },
      directRefs: [{ ...step.target, revision }],
      cascadeEffects: automatic.effects,
      evidence: [...mutationEvidence(step, revision), ...automatic.evidence],
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

  forget(undoToken: string): void {
    forgetCameraStageUndo(undoToken)
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const restored = await restoreCameraStageUndo(undoToken)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { camera_stage: revision },
      directRefs: [{ kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision }],
      cascadeEffects: [],
      evidence: [{
        kind: 'entity_state',
        target: { kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision },
        fact: '镜头参考已撤销到事务前状态。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }

  private async applyMutations(step: MutationStep): Promise<string> {
    if (this.entityType === CAMERA_STAGE_ENTITY_TYPES.scene) return await this.applyScene(step)
    if (this.entityType === CAMERA_STAGE_ENTITY_TYPES.object || this.entityType === CAMERA_STAGE_ENTITY_TYPES.camera) return await this.applyObject(step)
    if (this.entityType === CAMERA_STAGE_ENTITY_TYPES.stateKeyframe) return await this.applyStateKeyframe(step)
    if (this.entityType === CAMERA_STAGE_ENTITY_TYPES.playback) return await this.applyPlayback(step)
    if (this.entityType === CAMERA_STAGE_ENTITY_TYPES.trajectory) return await this.applyTrajectory(step)
    throw new Error('NOT_FOUND')
  }

  private async applyScene(step: MutationStep): Promise<string> {
    const projectId = step.target.id
    await ensureCameraStageProjectRuntime(projectId)
    const undoToken = captureCameraStageUndo(projectId)
    await afterCameraStageWrite(projectId, undoToken, async () => {
      await applyWriterTable(CAMERA_STAGE_SCENE_WRITERS, cameraStageProjectStore(projectId!).getState(), step.mutations)
      await saveCameraStageProjectRuntime(projectId)
    })
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

  private async applyStateKeyframe(step: MutationStep): Promise<string> {
    const { projectId, childId: stateKeyframeId } = childTarget(step.target.id)
    const draft: CameraStageStateKeyframeDraft = {}
    await applyWriterTable(CAMERA_STAGE_STATE_KEYFRAME_WRITERS, draft, step.mutations)
    return (await cameraStageApplicationService.updateStateKeyframe(projectId, stateKeyframeId, draft)).undoToken
  }

  private async applyPlayback(step: MutationStep): Promise<string> {
    const projectId = step.target.id
    // updatePlayback 自己会按需加载；镜头参考已经打开时绝不能重复 loadSnapshot。
    // 连续 seek→改属性的事务若每次 seek 都重开镜头参考，会制造无意义 revision 并用磁盘快照覆盖前序内存状态。
    await ensureCameraStageProjectRuntime(projectId)
    const undoToken = captureCameraStageUndo(projectId)
    const draft: CameraStagePlaybackDraft = {}
    await applyWriterTable(CAMERA_STAGE_PLAYBACK_WRITERS, draft, step.mutations)
    await cameraStageApplicationService.updatePlayback(projectId, draft)
    // 播放态不进镜头参考文件，所以这里不落盘。
    return undoToken
  }

  /** 轨迹稳定引用形如 `projectId:stateKeyframeId:objectId`（`allRefs()` 里 `childRef` 拼的 `${stateKeyframeId}:${objectId}`）。 */
  private async applyTrajectory(step: MutationStep): Promise<string> {
    const { projectId, childId } = childTarget(step.target.id)
    const separator = childId.indexOf(':')
    if (separator < 1) throw new Error('NOT_FOUND')
    const stateKeyframeId = childId.slice(0, separator)
    const objectId = childId.slice(separator + 1)
    const snapshot = await cameraStageApplicationService.readSnapshot(projectId)
    const index = snapshot.stateKeyframes.findIndex((stateKeyframe) => stateKeyframe.id === stateKeyframeId)
    const stateKeyframe = snapshot.stateKeyframes[index]
    const nextStateKeyframe = snapshot.stateKeyframes[index + 1]
    const path = stateKeyframe?.transition.perObject[objectId]?.spatialPath
    if (!stateKeyframe || !nextStateKeyframe || !path) throw new Error('NOT_FOUND')
    const draft: CameraStageTrajectoryDraft = { path: structuredClone(path), pathTouched: false }
    await applyWriterTable(CAMERA_STAGE_TRAJECTORY_WRITERS, draft, step.mutations)
    return (await cameraStageApplicationService.updateTrajectory(projectId, stateKeyframeId, objectId, {
      path: draft.pathTouched ? draft.path : undefined,
      startPosition: draft.startPosition,
      endPosition: draft.endPosition,
    })).undoToken
  }
}

const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() }).strict()
const motionInputSchema = z.object({
  projectId: z.string().min(1),
  cameraId: z.string().min(1),
  move: cameraStageMoveSchema,
  targetObjectId: z.string().min(1).optional(),
  targetPoint: vec3Schema.optional(),
  startStateKeyframeId: z.string().min(1).optional(),
  endStateKeyframeId: z.string().min(1).optional(),
  duration: z.number().positive().max(3600),
  speed: z.enum(['uniform', 'easeInOut', 'fastStart', 'slowStart']),
  rig: cameraStageRigSchema.optional(),
  continuity: z.enum(['smooth', 'stop']).optional(),
}).strict()

/** 按运镜类型说怎么改：环绕没有半径参数，半径由起始机位到注视点的距离决定。 */
const OBSTRUCTION_ADVICE: Record<CameraStageMotionResult['moveKind'], string> = {
  orbit: '把起始机位放远（加大环绕半径）或抬高，或减小环绕角度',
  dollyIn: '减小推近幅度（调大 distanceRatio），或换注视点',
  dollyOut: '减小拉远幅度（调小 distanceRatio），或把起始机位移到开阔一侧',
  truck: '减小横移距离或改横移方向',
  crane: '减小升降幅度，或把起始机位移到开阔处',
}

const round = (value: number): number => Math.round(value * 1000) / 1000

/**
 * 整条连续链的平滑度写进结果：峰值、衔接点、停顿、塌速与设备上限。有顿挫或超限时附一句怎么改；
 * 有意的停靠衔接不算问题，只在 continuityWithPrevious 里如实写出。无穷大的上限（未指定设备）不写，JSON 里没有无穷大。
 */
function cameraSmoothnessEvidence(result: CameraStageMotionResult): Record<string, JsonValue> {
  const { smoothness, continuityWithPrevious } = result
  if (!smoothness) return {}
  const timing = smoothness.timing
  const facts: string[] = []
  for (const time of smoothness.stops) facts.push(`${time.toFixed(1)} 秒速度降到接近零又起步：不是有意停顿就把那张状态关键帧的 continuity 设为 smooth`)
  for (const joint of smoothness.joints) {
    if (joint.velocityJump > CAMERA_JOINT_JUMP_RATIO * Math.max(smoothness.peakSpeed, 1e-6)) {
      facts.push(`${joint.time.toFixed(1)} 秒衔接处速度突变 ${joint.velocityJump.toFixed(2)} 米/秒：不是有意停顿就把衔接设为平滑`)
    }
  }
  if (timing?.sag) {
    const suggestion = timing.suggestedJointTimes
      ? `；整条一口气走完时衔接卡应在 ${timing.suggestedJointTimes.map((time) => `${time.toFixed(1)} 秒`).join('、')}（现在是 ${timing.jointTimes.map((time) => `${time.toFixed(1)} 秒`).join('、')}），可用 change_application_entities 改这些状态关键帧的 camera_stage.state_keyframe.time，或按路程重新分配各段 duration`
      : ''
    facts.push(`${timing.sag.time.toFixed(1)} 秒附近速度塌到 ${timing.sag.speed.toFixed(2)} 米/秒（两侧约 ${timing.sag.around.toFixed(2)}）：各段时长与路程不成比例${suggestion}`)
  }
  if (timing?.reverses) facts.push('镜头会往回走一段：各段时长与路程差得太多，按路程重新分配时长')
  if (timing && !timing.withinLimits) {
    facts.push(`这条连续运镜用当前设备在 ${(timing.endTime - timing.startTime).toFixed(1)} 秒内走完会超出上限，至少需要 ${timing.requiredDuration.toFixed(1)} 秒：加长 duration、缩短距离或换速度更高的设备`)
  }
  return {
    smoothness: {
      ...(continuityWithPrevious ? { continuityWithPrevious } : {}),
      start: round(smoothness.start),
      end: round(smoothness.end),
      peakSpeed: round(smoothness.peakSpeed),
      peakAcceleration: round(smoothness.peakAcceleration),
      peakJerk: round(smoothness.peakJerk),
      peakAngularSpeed: round(smoothness.peakAngularSpeed),
      joints: smoothness.joints.map((joint) => ({
        time: round(joint.time),
        speed: round(joint.speed),
        velocityJump: round(joint.velocityJump),
        accelerationJump: round(joint.accelerationJump),
        angularSpeedJump: round(joint.angularSpeedJump),
      })),
      stops: smoothness.stops.map(round),
      ...(timing ? {
        timing: {
          rig: timing.rig,
          sag: timing.sag ? { time: round(timing.sag.time), speed: round(timing.sag.speed), around: round(timing.sag.around) } : null,
          ...(timing.suggestedJointTimes ? { suggestedJointTimes: timing.suggestedJointTimes.map(round) } : {}),
          reverses: timing.reverses,
          withinLimits: timing.withinLimits,
          ...(timing.rig === 'free' ? {} : {
            requiredDuration: round(timing.requiredDuration),
            limits: { speed: timing.limits.speed, acceleration: timing.limits.acceleration, jerk: timing.limits.jerk },
          }),
        },
      } : {}),
    },
    ...(facts.length > 0 ? { smoothnessHint: `${facts.join('；')}。` } : {}),
  }
}

/** 轨迹撞楼或钻地时把穿过了谁、第几秒写进结果，附一句怎么改；通畅时不加字段。 */
function cameraPathClearanceEvidence(moveKind: CameraStageMotionResult['moveKind'], clearance: CameraPathClearance): Record<string, JsonValue> {
  if (clearance.obstructionCount === 0 && clearance.belowGroundAt === null) return {}
  const facts: string[] = []
  const advice: string[] = []
  if (clearance.obstructionCount > 0) {
    const first = clearance.obstructions[0]
    facts.push(`轨迹在 ${first.time.toFixed(1)} 秒穿过「${first.name}」${clearance.obstructionCount > 1 ? `等 ${clearance.obstructionCount} 个对象` : ''}`)
    advice.push(OBSTRUCTION_ADVICE[moveKind])
  }
  if (clearance.belowGroundAt !== null) {
    facts.push(`在 ${clearance.belowGroundAt.toFixed(1)} 秒低于地面`)
    advice.push(moveKind === 'crane' ? '减小下降幅度或抬高起始机位' : '抬高起始机位')
  }
  return {
    clearance: {
      obstructions: clearance.obstructions.map(({ objectId, name, time }) => ({ objectId, name, time })),
      obstructionCount: clearance.obstructionCount,
      belowGroundAt: clearance.belowGroundAt,
    },
    clearanceHint: `${facts.join('，')}：撤销后${[...new Set(advice)].join('；')}，再重新应用。`,
  }
}

export class CameraStageMotionOperationExecutor implements ApplicationSemanticOperationExecutor {
  readonly effectContract = {
    direct: [],
    cascades: [{
      declarationId: 'camera_stage.motion_state_keyframes', effect: 'update' as const,
      entityType: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe, propertyIds: [], revisionScopes: ['camera_stage'],
    }],
  }
  readonly capabilityId = 'apply_camera_stage_camera_move'
  readonly capabilityVersion = 1
  readonly requiredPermissions = ['camera_stage:write']
  readonly supportsAtomic = true

  constructor(private readonly dependencies: CameraStageControlExecutorDependencies) {}

  normalizeInput(input: JsonValue): JsonValue {
    return motionInputSchema.parse(input) as JsonValue
  }

  async getCurrentRevisions(): Promise<Record<string, number>> {
    return { camera_stage: this.dependencies.readRevision() }
  }

  async execute(input: JsonValue, _context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const result = await applyCameraStageMotion(motionInputSchema.parse(input))
    await afterCameraStageWrite(result.projectId, result.undoToken, async () => {
      const snapshot = await cameraStageApplicationService.readSnapshot(result.projectId)
      const [start, end] = result.affectedStateKeyframeIds.map(id => snapshot.stateKeyframes.find(frame => frame.id === id))
      if (!start || !end || !start.transition.perObject[result.cameraId]?.spatialPath
        || JSON.stringify(start.objectStates[result.cameraId]?.transform.position) !== JSON.stringify(result.path.start)
        || JSON.stringify(end.objectStates[result.cameraId]?.transform.position) !== JSON.stringify(result.path.end)) {
        throw new Error('运镜后正式状态关键帧中的轨迹与结果不一致。')
      }
    })
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { camera_stage: revision },
      directRefs: [
        { kind: CAMERA_STAGE_ENTITY_TYPES.camera, id: `${result.projectId}:${result.cameraId}`, revision },
      ],
      directEffects: [{
        effect: 'execute', entityType: CAMERA_STAGE_ENTITY_TYPES.camera,
        refs: [{ kind: CAMERA_STAGE_ENTITY_TYPES.camera, id: `${result.projectId}:${result.cameraId}`, revision }],
        propertyIds: [], origin: { kind: 'direct' },
      }],
      cascadeEffects: [{
        effect: 'update', entityType: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe,
        refs: result.affectedStateKeyframeIds.map((id) => ({ kind: CAMERA_STAGE_ENTITY_TYPES.stateKeyframe, id: `${result.projectId}:${id}`, revision })),
        propertyIds: [], origin: { kind: 'cascade', declarationId: 'camera_stage.motion_state_keyframes' },
      }],
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
          affectedStateKeyframeIds: result.affectedStateKeyframeIds,
          affectedStateKeyframeCount: result.affectedStateKeyframeCount,
          ...cameraPathClearanceEvidence(result.moveKind, result.clearance),
          ...cameraSmoothnessEvidence(result),
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

  forget(undoToken: string): void {
    forgetCameraStageUndo(undoToken)
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const restored = await restoreCameraStageUndo(undoToken)
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { camera_stage: revision },
      directRefs: [{ kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision }],
      directEffects: [{ effect: 'execute', entityType: CAMERA_STAGE_ENTITY_TYPES.project, refs: [{ kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision }], propertyIds: [], origin: { kind: 'direct' } }],
      cascadeEffects: [],
      evidence: [{ kind: 'entity_state', fact: '三维运镜已撤销。', target: { kind: CAMERA_STAGE_ENTITY_TYPES.project, id: restored.projectId, revision }, capturedAt: new Date().toISOString() }],
    }
  }
}

export const CAMERA_STAGE_MUTATION_ENTITY_TYPES: MutationEntityType[] = [
  CAMERA_STAGE_ENTITY_TYPES.scene,
  CAMERA_STAGE_ENTITY_TYPES.object,
  CAMERA_STAGE_ENTITY_TYPES.camera,
  CAMERA_STAGE_ENTITY_TYPES.stateKeyframe,
  CAMERA_STAGE_ENTITY_TYPES.playback,
  CAMERA_STAGE_ENTITY_TYPES.trajectory,
]
