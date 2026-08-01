import { z } from 'zod'

import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationExecutionContext,
  ApplicationMutationExecutor,
  ApplicationPlannedStep,
  ApplicationSemanticOperationExecutor,
  JsonValue,
} from '@/core/application-control'

import type { StageVec3 } from '../domain/sceneTypes'
import type { StageEasingPreset, StageKeyframeValue } from '../domain/animationTypes'
import { saveCurrentProject } from '../projects/cameraStageProjectService'
import { setTrackKeyframeValue } from '../store/animationActions'
import { useCameraStageStore } from '../store/cameraStageStore'
import { cameraStageApplicationService, type CameraStageObjectUpdate, type CameraStageShotUpdate } from './cameraStageApplicationService'
import { applyCameraStageMotion } from './cameraMotionService'
import { restoreCameraStageUndo, captureCameraStageUndo } from './cameraStageUndo'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'

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

function vec3(value: JsonValue | undefined): StageVec3 {
  const parsed = z.object({ x: z.number(), y: z.number(), z: z.number() }).strict().parse(value)
  return parsed
}

function stringValue(value: JsonValue | undefined): string {
  return z.string().parse(value)
}

function numberValue(value: JsonValue | undefined): number {
  return z.number().parse(value)
}

function booleanValue(value: JsonValue | undefined): boolean {
  return z.boolean().parse(value)
}

function refId(value: JsonValue | undefined): string | null {
  if (value === null) return null
  return z.object({ kind: z.string(), id: z.string() }).passthrough().parse(value).id.split(':').pop() ?? null
}

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
  constructor(
    readonly entityType: MutationEntityType,
    private readonly dependencies: CameraStageControlExecutorDependencies,
  ) {}

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
    return await this.applyKeyframe(step)
  }

  private async applyProject(step: MutationStep): Promise<string> {
    const projectId = step.target.id
    await cameraStageApplicationService.openProject(projectId)
    const undoToken = captureCameraStageUndo(projectId)
    for (const mutation of step.mutations) {
      if (mutation.propertyId !== `${CAMERA_STAGE_ENTITY_TYPES.project}.name` || mutation.operation !== 'set') throw new Error('PROPERTY_NOT_WRITABLE')
      await cameraStageApplicationService.renameProject(projectId, stringValue(mutation.value))
    }
    return undoToken
  }

  private async applyScene(step: MutationStep): Promise<string> {
    const projectId = step.target.id
    await cameraStageApplicationService.openProject(projectId)
    const undoToken = captureCameraStageUndo(projectId)
    const state = useCameraStageStore.getState()
    for (const mutation of step.mutations) {
      if (mutation.operation !== 'set') throw new Error('INVALID_MUTATION_OPERATION')
      if (mutation.propertyId === `${CAMERA_STAGE_ENTITY_TYPES.scene}.active_camera_ref`) state.setActiveCameraId(refId(mutation.value))
      else if (mutation.propertyId === `${CAMERA_STAGE_ENTITY_TYPES.scene}.duration`) state.setDuration(numberValue(mutation.value))
      else if (mutation.propertyId === `${CAMERA_STAGE_ENTITY_TYPES.scene}.fps`) state.setFps(numberValue(mutation.value))
      else throw new Error('PROPERTY_NOT_WRITABLE')
    }
    await saveCurrentProject()
    return undoToken
  }

  private async applyObject(step: MutationStep): Promise<string> {
    const { projectId, childId: objectId } = childTarget(step.target.id)
    const snapshot = await cameraStageApplicationService.readSnapshot(projectId)
    const current = snapshot.objects.find((object) => object.id === objectId)
    if (!current) throw new Error('NOT_FOUND')
    const update: CameraStageObjectUpdate = {}
    const transform = { ...current.transform }
    for (const mutation of step.mutations) {
      if (mutation.operation !== 'set') throw new Error('INVALID_MUTATION_OPERATION')
      const suffix = mutation.propertyId.slice(this.entityType.length + 1)
      if (suffix === 'name') update.name = stringValue(mutation.value)
      else if (suffix === 'visible') update.visible = booleanValue(mutation.value)
      else if (suffix === 'color') update.color = stringValue(mutation.value)
      else if (suffix === 'transform.position') transform.position = vec3(mutation.value)
      else if (suffix === 'transform.rotation') transform.rotation = vec3(mutation.value)
      else if (suffix === 'transform.scale') transform.scale = vec3(mutation.value)
      else if (suffix === 'character_variant') update.variant = z.enum(['standard', 'strong', 'slim', 'child']).parse(mutation.value)
      else if (suffix === 'fov') update.fov = numberValue(mutation.value)
      else if (suffix === 'look_at_target') update.lookAt = { mode: 'manual', target: vec3(mutation.value) }
      else if (suffix === 'look_at_object_ref') {
        const id = refId(mutation.value)
        if (!id || current.type !== 'camera') throw new Error('INVALID_REFERENCE')
        update.lookAt = { mode: 'object', objectId: id, fallbackTarget: current.lookAt.mode === 'manual' ? current.lookAt.target : current.lookAt.fallbackTarget }
      } else if (suffix === 'aspect_ratio_preset' || suffix === 'aspect_ratio') {
        if (current.type !== 'camera') throw new Error('OBJECT_TYPE_MISMATCH')
        update.aspectRatio = {
          preset: suffix === 'aspect_ratio_preset'
            ? z.enum(['16:9', '4:3', '1:1', '9:16', 'custom']).parse(mutation.value)
            : current.aspectRatio.preset,
          ratio: suffix === 'aspect_ratio' ? numberValue(mutation.value) : current.aspectRatio.ratio,
        }
      } else throw new Error('PROPERTY_NOT_WRITABLE')
    }
    if (step.mutations.some((mutation) => mutation.propertyId.includes('.transform.'))) update.transform = transform
    return (await cameraStageApplicationService.updateObject(projectId, objectId, update)).undoToken
  }

  private async applyShot(step: MutationStep): Promise<string> {
    const { projectId, childId: shotId } = childTarget(step.target.id)
    const update: CameraStageShotUpdate = {}
    for (const mutation of step.mutations) {
      if (mutation.operation !== 'set') throw new Error('INVALID_MUTATION_OPERATION')
      const suffix = mutation.propertyId.slice(this.entityType.length + 1)
      if (suffix === 'name') update.name = stringValue(mutation.value)
      else if (suffix === 'hold') update.hold = numberValue(mutation.value)
      else if (suffix === 'transition_duration') update.transitionDuration = numberValue(mutation.value)
      else if (suffix === 'continuity') update.continuity = z.enum(['stop', 'smooth']).parse(mutation.value)
      else if (suffix === 'camera_ref') update.cameraId = refId(mutation.value)
      else throw new Error('PROPERTY_NOT_WRITABLE')
    }
    return (await cameraStageApplicationService.updateShot(projectId, shotId, update)).undoToken
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
    const state = useCameraStageStore.getState()
    let currentTime = originalTime
    for (const mutation of step.mutations) {
      if (mutation.operation !== 'set') throw new Error('INVALID_MUTATION_OPERATION')
      const suffix = mutation.propertyId.slice(this.entityType.length + 1)
      if (suffix === 'time') {
        const nextTime = numberValue(mutation.value)
        state.moveKeyframe(objectId, path, currentTime, nextTime)
        currentTime = nextTime
      } else if (suffix === 'value') {
        const track = useCameraStageStore.getState().animation.tracks.find((candidate) => candidate.objectId === objectId && candidate.propertyPath === path)
        const keyframe = track?.keyframes.find((candidate) => candidate.time === currentTime)
        if (!keyframe) throw new Error('NOT_FOUND')
        const raw = stringValue(mutation.value)
        const value: StageKeyframeValue = typeof keyframe.value === 'number' ? Number(raw) : raw
        if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('INVALID_INPUT')
        useCameraStageStore.setState((current) => ({ animation: setTrackKeyframeValue(current.animation, objectId, path, currentTime, value) }))
      } else if (suffix === 'easing') {
        const easing = z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold']).parse(mutation.value) as StageEasingPreset
        state.setKeyframesEasing([{ objectId, path, time: currentTime }], easing)
      } else throw new Error('PROPERTY_NOT_WRITABLE')
    }
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
]
