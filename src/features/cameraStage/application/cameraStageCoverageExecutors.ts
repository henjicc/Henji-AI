import { z } from 'zod'

import type {
  ApplicationCompletedStepResult,
  ApplicationEffectReceipt,
  ApplicationEvidence,
  ApplicationExecutionContext,
  ApplicationSemanticOperationExecutor,
  JsonValue,
} from '@/core/application-control'
import {
  COVER_CAMERA_STAGE_SCENE_CAPABILITY_ID,
  CUT_CAMERA_STAGE_COVERAGE_CAPABILITY_ID,
} from '@/core/application-control/domains/cameraStage/cameraStageCoverageApplicationCapabilities'
import { cameraStageCoverageIntentShape, cameraStageCutIntentShape, refineCameraStageCoverage, refineCameraStageLines } from '@/core/application-control/domains/cameraStage/cameraStageCoverageSchemas'

import type { CameraStageControlExecutorDependencies } from './cameraStageControlExecutors'
import { CAMERA_STAGE_ENTITY_TYPES } from './cameraStageReflection'
import { forgetCameraStageUndo, restoreCameraStageUndo } from './cameraStageUndo'
import { coverCameraStageScene } from './coverageService'
import { cutCameraStageCoverage } from './editService'

export const cameraStageCoverageInputSchema = z.object({ projectId: z.string().min(1), ...cameraStageCoverageIntentShape }).strict().superRefine(refineCameraStageCoverage)
export const cameraStageCutInputSchema = z.object({ projectId: z.string().min(1), ...cameraStageCutIntentShape }).strict()
  .superRefine((input, context) => refineCameraStageLines(input.lines, context))

export const COVERAGE_FACT = '多机位覆盖已布置。'
export const CUT_FACT = '切镜序列已写进机位轨。'

const CAMERA_PROPERTY_IDS = [
  'camera_stage.camera.transform.position', 'camera_stage.camera.transform.rotation',
  'camera_stage.camera.fov', 'camera_stage.camera.look_at_target',
]

function asJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

interface CoverageRun {
  projectId: string
  undoToken: string
  /** 按写入后的修订号给出实际副作用 */
  effects: (revision: number) => ApplicationEffectReceipt[]
  readback: Record<string, unknown>
}

function receipt(effect: 'create' | 'update' | 'delete', entityType: string, refs: ApplicationEffectReceipt['refs'], propertyIds: string[]): ApplicationEffectReceipt[] {
  return refs.length > 0 ? [{ effect, entityType, refs, propertyIds, origin: { kind: 'direct' } }] : []
}

/** 覆盖与剪辑共用的执行器外壳：一次调用一个撤销点；读回整份放进证据，由适配器提到结果顶层。 */
abstract class CameraStageCoverageOperationExecutorBase<Input> implements ApplicationSemanticOperationExecutor {
  abstract readonly capabilityId: string
  readonly capabilityVersion = 1
  readonly requiredPermissions = ['camera_stage:write']
  readonly supportsAtomic = true
  readonly effectContract = { direct: [], cascades: [] }
  protected abstract readonly fact: string

  constructor(protected readonly dependencies: CameraStageControlExecutorDependencies) {}

  protected abstract parse(input: JsonValue): Input
  protected abstract run(input: Input): Promise<CoverageRun>

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
    const target = { kind: CAMERA_STAGE_ENTITY_TYPES.project, id: result.projectId, revision }
    const effects = result.effects(revision)
    const refs = effects.flatMap((effect) => effect.refs)
    return {
      status: 'completed',
      resultingRevisions: { camera_stage: revision },
      directRefs: refs.length > 0 ? refs.slice(0, 64) : [target],
      directEffects: effects,
      cascadeEffects: [],
      evidence: [{ kind: 'operation_result', target, fact: this.fact, data: asJson(result.readback), capturedAt: new Date().toISOString() }],
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

type CoverageInput = z.output<typeof cameraStageCoverageInputSchema>

export class CameraStageCoverageOperationExecutor extends CameraStageCoverageOperationExecutorBase<CoverageInput> {
  readonly capabilityId = COVER_CAMERA_STAGE_SCENE_CAPABILITY_ID
  protected readonly fact = COVERAGE_FACT
  protected parse(input: JsonValue): CoverageInput { return cameraStageCoverageInputSchema.parse(input) }
  protected async run(input: CoverageInput): Promise<CoverageRun> {
    const result = await coverCameraStageScene(input)
    const { projectId, undoToken, createdCameraIds: _created, ...readback } = result
    return {
      projectId,
      undoToken,
      readback,
      effects: (revision) => {
        const ref = (cameraId: string) => ({ kind: CAMERA_STAGE_ENTITY_TYPES.camera, id: `${projectId}:${cameraId}`, revision })
        return [
          ...receipt('create', CAMERA_STAGE_ENTITY_TYPES.camera, result.setups.filter((setup) => setup.created).map((setup) => ref(setup.cameraId)), CAMERA_PROPERTY_IDS),
          ...receipt('update', CAMERA_STAGE_ENTITY_TYPES.camera, result.setups.filter((setup) => !setup.created).map((setup) => ref(setup.cameraId)), CAMERA_PROPERTY_IDS),
        ]
      },
    }
  }
}

type CutInput = z.output<typeof cameraStageCutInputSchema>

export class CameraStageCutOperationExecutor extends CameraStageCoverageOperationExecutorBase<CutInput> {
  readonly capabilityId = CUT_CAMERA_STAGE_COVERAGE_CAPABILITY_ID
  protected readonly fact = CUT_FACT
  protected parse(input: JsonValue): CutInput { return cameraStageCutInputSchema.parse(input) }
  protected async run(input: CutInput): Promise<CoverageRun> {
    const result = await cutCameraStageCoverage(input)
    const { projectId, undoToken, createdCutIds, removedCutIds, ...readback } = result
    return {
      projectId,
      undoToken,
      readback,
      effects: (revision) => {
        const ref = (cutId: string) => ({ kind: CAMERA_STAGE_ENTITY_TYPES.cameraCut, id: `${projectId}:${cutId}`, revision })
        return [
          ...receipt('create', CAMERA_STAGE_ENTITY_TYPES.cameraCut, createdCutIds.map(ref), []),
          ...receipt('delete', CAMERA_STAGE_ENTITY_TYPES.cameraCut, removedCutIds.map(ref), []),
        ]
      },
    }
  }
}
