import type {
  ApplicationCollectionExecutor,
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationPlannedStep,
  ApplicationRef,
  JsonValue,
} from '@/core/application-control'
import { createLogger } from '@/core/logging'
import { notExecutedFailure } from '@/core/application-control/execution/writeExecution'

import type { StageObject } from '../domain/sceneTypes'
import { cameraStageProjectStore, ensureCameraStageProjectRuntime, saveCameraStageProjectRuntime, bindCameraStageProjectOperation } from './cameraStageProjectRuntime'
import { afterCameraStageWrite, captureCameraStageUndo, forgetCameraStageUndo, restoreCameraStageUndo } from './cameraStageUndo'
import type { CameraStageControlExecutorDependencies } from './cameraStageControlExecutors'
import type { CameraStageCameraCutDraft } from './cameraStageTimelineFields'

const logger = createLogger('features.cameraStage.cameraCuts')
const CUT_ENTITY_TYPE = 'camera_stage.camera_cut'
const PROJECT_ENTITY_TYPE = 'camera_stage.document'

/*
 * 机位切换点的增删改，界面、通用实体写入与剪辑能力共用这一处：都经 store 动作落地、一次一个撤销点、写完存盘。
 * 写入前校验摄像机 id，写错时列出可用摄像机，助手据此改正后重试。
 */

function assertCamera(objects: readonly StageObject[], cameraId: string | null, label: string): void {
  if (cameraId === null || objects.some((object) => object.id === cameraId && object.type === 'camera')) return
  const cameras = objects.filter((object) => object.type === 'camera').map((object) => `${object.id}（${object.name}）`)
  throw notExecutedFailure(new Error(`CAMERA_CUT_CAMERA_NOT_FOUND：${label}的 camera_ref «${cameraId}» 不是本场景中的摄像机。当前摄像机：${cameras.join('、') || '没有'}。`))
}

function assertTime(time: number, label: string): void {
  if (!Number.isFinite(time) || time < 0 || time > 3600) throw notExecutedFailure(new Error(`CAMERA_CUT_TIME_INVALID：${label}的 time 必须是 0~3600 秒之间的数。`))
}

const implementation = {
  async createCameraCuts(projectId: string, inputs: ReadonlyArray<{ time: number; cameraId: string | null }>): Promise<{ cutIds: string[]; undoToken: string }> {
    await ensureCameraStageProjectRuntime(projectId)
    const store = cameraStageProjectStore(projectId)
    const half = 1 / (2 * Math.max(1, store.getState().animation.fps))
    inputs.forEach((input, index) => {
      assertTime(input.time, `第 ${index} 项`)
      assertCamera(store.getState().objects, input.cameraId, `第 ${index} 项`)
      const occupied = store.getState().cameraCuts.find((cut) => Math.abs(cut.time - input.time) <= half)
      if (occupied) throw notExecutedFailure(new Error(`CAMERA_CUT_TIME_OCCUPIED：第 ${index} 项落在 ${occupied.time} 秒，那一帧已有切换点 ${occupied.id}；要换机位就改它的 camera_stage.camera_cut.camera_ref。`))
      if (inputs.some((other, otherIndex) => otherIndex < index && Math.abs(other.time - input.time) <= half)) throw notExecutedFailure(new Error(`CAMERA_CUT_TIME_DUPLICATED：第 ${index} 项与前面一项落在同一帧。`))
    })
    const undoToken = captureCameraStageUndo(projectId)
    const cutIds = await afterCameraStageWrite(projectId, undoToken, async () => {
      for (const input of inputs) store.getState().setCameraCutAt(input.time, input.cameraId)
      await saveCameraStageProjectRuntime(projectId)
      const fps = store.getState().animation.fps
      return inputs.flatMap((input) => store.getState().cameraCuts.find((cut) => Math.abs(cut.time - input.time) <= 1 / (2 * fps))?.id ?? [])
    })
    logger.info('机位切换点新建完成', { event: 'camera_stage.camera_cut.created', projectId, requested: inputs.length, created: cutIds.length })
    return { cutIds, undoToken }
  },

  async updateCameraCut(projectId: string, cutId: string, draft: CameraStageCameraCutDraft): Promise<{ undoToken: string }> {
    await ensureCameraStageProjectRuntime(projectId)
    const store = cameraStageProjectStore(projectId)
    if (!store.getState().cameraCuts.some((cut) => cut.id === cutId)) throw notExecutedFailure(new Error('NOT_FOUND'))
    if (draft.time !== undefined) assertTime(draft.time, '切换点')
    if (draft.cameraId !== undefined) assertCamera(store.getState().objects, draft.cameraId, '切换点')
    const undoToken = captureCameraStageUndo(projectId)
    await afterCameraStageWrite(projectId, undoToken, async () => {
      if (draft.time !== undefined) store.getState().moveCameraCut(cutId, draft.time)
      if (draft.cameraId !== undefined) store.getState().updateCameraCutCamera(cutId, draft.cameraId)
      await saveCameraStageProjectRuntime(projectId)
    })
    logger.info('机位切换点已修改', { event: 'camera_stage.camera_cut.updated', projectId, cutId, time: draft.time ?? null, cameraId: draft.cameraId ?? null })
    return { undoToken }
  },

  async removeCameraCuts(projectId: string, cutIds: readonly string[]): Promise<{ removedCount: number; undoToken: string }> {
    await ensureCameraStageProjectRuntime(projectId)
    const store = cameraStageProjectStore(projectId)
    const missing = cutIds.filter((id) => !store.getState().cameraCuts.some((cut) => cut.id === id))
    if (missing.length > 0) {
      throw notExecutedFailure(new Error(`CAMERA_CUT_NOT_FOUND：${missing.join('、')} 不是本场景的机位切换点。当前：${store.getState().cameraCuts.map((cut) => `${cut.id}（${cut.time} 秒）`).join('、') || '没有'}。`))
    }
    const undoToken = captureCameraStageUndo(projectId)
    await afterCameraStageWrite(projectId, undoToken, async () => {
      for (const id of cutIds) store.getState().removeCameraCut(id)
      await saveCameraStageProjectRuntime(projectId)
    })
    logger.info('机位切换点已删除', { event: 'camera_stage.camera_cut.removed', projectId, removedCount: cutIds.length })
    return { removedCount: cutIds.length, undoToken }
  },
}

export const cameraStageCameraCutService = {
  createCameraCuts: bindCameraStageProjectOperation(implementation.createCameraCuts, (projectId) => projectId),
  updateCameraCut: bindCameraStageProjectOperation(implementation.updateCameraCut, (projectId) => projectId),
  removeCameraCuts: bindCameraStageProjectOperation(implementation.removeCameraCuts, (projectId) => projectId),
}

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>

function cameraRefId(value: JsonValue | undefined): string | null {
  if (value === undefined || value === null) return null
  const raw = typeof value === 'string' ? value : typeof value === 'object' && !Array.isArray(value) && typeof value.id === 'string' ? value.id : null
  if (raw === null) throw new Error('CAMERA_CUT_CAMERA_REF_INVALID：camera_ref 必须是摄像机引用、摄像机 id 或 null。')
  return raw.includes(':') ? raw.slice(raw.indexOf(':') + 1) : raw
}

function childId(ref: ApplicationRef): string {
  const separator = ref.id.indexOf(':')
  if (separator < 1) throw new Error(`CAMERA_CUT_REF_INVALID：«${ref.id}» 不是合法的机位切换点引用，应为 <镜头参考文档 ID>:<切换点 ID>。`)
  return ref.id.slice(separator + 1)
}

/** 机位切换点集合写入：新建（time + camera_ref）与删除。改时刻、换机位走属性写入。 */
export class CameraStageCameraCutCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = CUT_ENTITY_TYPE
  readonly effectContract = { direct: [], cascades: [] }

  constructor(private readonly dependencies: CameraStageControlExecutorDependencies) {}

  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    const projectId = step.parent.id.includes(':') ? step.parent.id.slice(0, step.parent.id.indexOf(':')) : step.parent.id
    if (step.operation.kind === 'create') {
      const inputs = step.operation.items.map((item) => {
        const time = item.properties[`${CUT_ENTITY_TYPE}.time`]
        if (typeof time !== 'number') throw new Error('CAMERA_CUT_TIME_INVALID：time 必须是数字（秒）。')
        return { time, cameraId: cameraRefId(item.properties[`${CUT_ENTITY_TYPE}.camera_ref`]) }
      })
      const result = await cameraStageCameraCutService.createCameraCuts(projectId, inputs)
      return this.completed(projectId, result.undoToken, result.cutIds, `已新建 ${result.cutIds.length} 个机位切换点。`)
    }
    const targets = step.operation.targets.map(childId)
    const result = await cameraStageCameraCutService.removeCameraCuts(projectId, targets)
    return this.completed(projectId, result.undoToken, targets, `已删除 ${result.removedCount} 个机位切换点。`)
  }

  async compensate(_step: CollectionStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
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
      directRefs: [],
      evidence: [{ kind: 'entity_state', target: { kind: PROJECT_ENTITY_TYPE, id: restored.projectId, revision }, fact: '机位切换点写入已撤销。', capturedAt: new Date().toISOString() }],
    }
  }

  private completed(projectId: string, undoToken: string, cutIds: string[], fact: string): ApplicationCompletedStepResult {
    this.dependencies.bumpRevision()
    const revision = this.dependencies.readRevision()
    return {
      status: 'completed',
      resultingRevisions: { camera_stage: revision },
      directRefs: cutIds.slice(0, 64).map((id) => ({ kind: CUT_ENTITY_TYPE, id: `${projectId}:${id}`, revision })),
      evidence: [{ kind: 'operation_result', target: { kind: PROJECT_ENTITY_TYPE, id: projectId, revision }, fact, data: { cutIds }, capturedAt: new Date().toISOString() }],
      undoToken,
    }
  }
}
