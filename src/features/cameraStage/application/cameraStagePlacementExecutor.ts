import { z } from 'zod'

import type {
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationExecutionContext,
  ApplicationSemanticOperationExecutor,
  JsonValue,
} from '@/core/application-control'
import { CAMERA_STAGE_NAME_MAX_LENGTH } from '@/core/assistant/capabilities/cameraStageCapabilitySchemas'

import { cameraStageApplicationService } from './cameraStageApplicationService'
import type { CameraStageControlExecutorDependencies } from './cameraStageControlExecutors'
import { restoreCameraStageUndo } from './cameraStageUndo'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'

const vec3Schema = z.object({ x: z.number(), y: z.number(), z: z.number() }).strict()

export const cameraStagePlacementInputSchema = z.object({
  projectId: z.string().min(1),
  objectId: z.string().min(1).optional(),
  objectType: z.enum(['primitive', 'character', 'camera']),
  primitiveKind: z.enum(['box', 'sphere', 'cylinder', 'cone', 'pyramid', 'torus']).optional(),
  name: z.string().trim().min(1).max(CAMERA_STAGE_NAME_MAX_LENGTH).optional(),
  role: z.enum(['subject', 'prop', 'character', 'camera', 'environment']).optional(),
  reusePolicy: z.enum(['prefer_existing', 'require_new']).default('prefer_existing'),
  placement: z.object({
    mode: z.enum(['auto', 'beside', 'surround', 'foreground', 'background']).default('auto'),
    position: vec3Schema.optional(),
    rotation: vec3Schema.optional(),
    scale: vec3Schema.optional(),
    dimensions: vec3Schema.optional(),
    targetObjectId: z.string().min(1).optional(),
    spacing: z.number().min(0).max(1_000).default(0.35),
    allowOverlap: z.boolean().default(false),
  }).strict().default({ mode: 'auto', spacing: 0.35, allowOverlap: false }),
}).strict().superRefine((input, context) => {
  if (input.objectType === 'primitive' && !input.primitiveKind) {
    context.addIssue({ code: 'custom', path: ['primitiveKind'], message: '基础几何体必须声明类型' })
  }
  if (input.objectType !== 'primitive' && input.primitiveKind) {
    context.addIssue({ code: 'custom', path: ['primitiveKind'], message: '仅基础几何体可声明几何体类型' })
  }
})

export class CameraStagePlacementOperationExecutor implements ApplicationSemanticOperationExecutor {
  readonly capabilityId = 'place_camera_stage_object'
  readonly capabilityVersion = 1
  readonly risk = 'R1' as const
  readonly requiredPermissions = ['camera_stage:write']
  readonly supportsAtomic = true

  constructor(private readonly dependencies: CameraStageControlExecutorDependencies) {}

  normalizeInput(input: JsonValue): JsonValue {
    return cameraStagePlacementInputSchema.parse(input) as JsonValue
  }

  async getCurrentRevisions(): Promise<Record<string, number>> {
    return { toolbox: this.dependencies.readRevision() }
  }

  async execute(input: JsonValue, _context: ApplicationExecutionContext): Promise<ApplicationCompletedStepResult> {
    const parsed = cameraStagePlacementInputSchema.parse(input)
    const result = await cameraStageApplicationService.placeObject({
      projectId: parsed.projectId,
      spec: {
        objectId: parsed.objectId,
        objectType: parsed.objectType,
        primitiveKind: parsed.primitiveKind,
        name: parsed.name,
        role: parsed.role,
        reusePolicy: parsed.reusePolicy,
      },
      placement: parsed.placement,
    })
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    const entityType = result.objectType === 'camera'
      ? CAMERA_STAGE_ENTITY_TYPES.camera
      : CAMERA_STAGE_ENTITY_TYPES.object
    return {
      status: 'completed',
      resultingRevisions: { toolbox: revision },
      producedRefs: [{ kind: entityType, id: `${result.projectId}:${result.objectId}`, revision }],
      evidence: [{
        kind: 'operation_result',
        target: { kind: entityType, id: `${result.projectId}:${result.objectId}`, revision },
        fact: '三维场景对象已按复用与空间约束处理。',
        data: {
          decision: result.decision,
          position: { x: result.position.x, y: result.position.y, z: result.position.z },
          bounds: {
            min: { x: result.bounds.min.x, y: result.bounds.min.y, z: result.bounds.min.z },
            max: { x: result.bounds.max.x, y: result.bounds.max.y, z: result.bounds.max.z },
          },
          conflicts: result.conflicts,
          reason: result.reason,
        },
        capturedAt: new Date().toISOString(),
      }],
      ...(result.undoToken ? { undoToken: result.undoToken } : {}),
    }
  }

  async compensate(_input: JsonValue, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
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
        fact: '三维场景布置已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }
}
