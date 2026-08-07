import { createLogger } from '@/core/logging'
import { CAMERA_STAGE_NAME_MAX_LENGTH } from '@/core/assistant/capabilities/cameraStageCapabilitySchemas'

import type { StageObject } from '../domain/sceneTypes'
import type { StageShot } from '../domain/shotTypes'
import { loadProjectIntoScene, saveCurrentProject } from '../projects/cameraStageProjectService'
import { useCameraStageStore } from '../store/cameraStageStore'
import { captureCameraStageUndo, restoreCameraStageUndo } from './cameraStageUndo'

const logger = createLogger('features.cameraStage.application')

/**
 * 镜头卡的批量增删。
 *
 * `collectionWrite` 补齐前，`camera_stage.shot` 只能靠专用能力 `add_camera_stage_shot` 新建、
 * 删不掉也排不了序——store 侧的 `removeShot`/`removeShots` 早就是完整实现（含选中态回退与
 * 过渡时长重算），缺的只是集合写入这一条正式入口。创建复用 `store.addShot()` 的合并语义：
 * 先把播放头 seek 到目标时间（顺带把插值采样结果录进新卡，与人在界面上拖动播放头再点新建
 * 完全一致），已有卡占着同一帧时自动合并进它，不产生重复卡。
 */

export interface CameraStageShotCreateInput {
  time: number
  name?: string
  cameraId?: string | null
  continuity?: StageShot['continuity']
  hold?: number
  transitionDuration?: number
}

async function ensureProjectLoaded(projectId: string): Promise<void> {
  if (useCameraStageStore.getState().currentProjectId === projectId) return
  if (!await loadProjectIntoScene(projectId)) throw new Error(`PROJECT_NOT_FOUND:${projectId}`)
}

/** 纯输入校验，必须在任何写入之前跑完——写到一半才发现参数不对，留下的残局比失败本身更难收拾。 */
function assertShotInputsValid(inputs: CameraStageShotCreateInput[], objects: StageObject[]): void {
  const cameraIds = new Set(objects.filter((object) => object.type === 'camera').map((object) => object.id))
  for (const [index, input] of inputs.entries()) {
    if (!Number.isFinite(input.time) || input.time < 0 || input.time > 3_600) {
      throw new Error(`SHOT_TIME_INVALID：第 ${index} 项的 time 必须是 0~3600 秒之间的有限数。`)
    }
    if (input.cameraId && !cameraIds.has(input.cameraId)) {
      throw new Error(
        `SHOT_CAMERA_NOT_FOUND：第 ${index} 项的 camera_ref «${input.cameraId}» 不是本场景中的摄像机。`
        + `camera_ref 必须取自观察结果里 objects[].id 的原值。当前可用摄像机：${[...cameraIds].join('、') || '无'}。`
      )
    }
    if (input.hold !== undefined && (!Number.isFinite(input.hold) || input.hold < 0)) {
      throw new Error(`SHOT_HOLD_INVALID：第 ${index} 项的 hold 必须是不小于 0 的有限数。`)
    }
    if (input.transitionDuration !== undefined && (!Number.isFinite(input.transitionDuration) || input.transitionDuration < 0)) {
      throw new Error(`SHOT_TRANSITION_DURATION_INVALID：第 ${index} 项的 transition_duration 必须是不小于 0 的有限数。`)
    }
    if (input.name !== undefined && input.name.trim().length === 0) {
      throw new Error(`SHOT_NAME_INVALID：第 ${index} 项的 name 不能是空字符串。`)
    }
  }
}

function resolveUniqueShotName(shots: StageShot[], requested: string, excludedId: string): string {
  const base = requested.trim().slice(0, CAMERA_STAGE_NAME_MAX_LENGTH)
  const occupied = new Set(shots.filter((shot) => shot.id !== excludedId).map((shot) => shot.name))
  if (!occupied.has(base)) return base
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = ` ${index}`
    const candidate = `${base.slice(0, CAMERA_STAGE_NAME_MAX_LENGTH - suffix.length)}${suffix}`
    if (!occupied.has(candidate)) return candidate
  }
  throw new Error('SHOT_NAME_CONFLICT')
}

async function rollback(projectId: string, undoToken: string, event: string): Promise<void> {
  try {
    await restoreCameraStageUndo(undoToken)
  } catch (rollbackError) {
    logger.error('三维镜头卡回滚失败', rollbackError, { event, projectId })
  }
}

export const cameraStageShotService = {
  /** 批量新建镜头卡；同一批次里落在同一帧的两项会像人工操作一样合并成一张卡。 */
  async createShots(projectId: string, inputs: CameraStageShotCreateInput[]): Promise<{
    projectId: string
    shotIds: string[]
    undoToken: string
  }> {
    logger.info('三维镜头卡批量新建开始', {
      event: 'camera_stage.shot.create.start', projectId, shotCount: inputs.length,
    })
    await ensureProjectLoaded(projectId)
    const before = useCameraStageStore.getState()
    assertShotInputsValid(inputs, before.objects)
    const undoToken = captureCameraStageUndo(projectId)
    try {
      const shotIds: string[] = []
      for (const input of inputs) {
        const state = useCameraStageStore.getState()
        state.seek(input.time)
        state.addShot()
        const after = useCameraStageStore.getState()
        const shotId = after.selectedShotId
        if (!shotId) throw new Error('CAPABILITY_REJECTED')
        if (input.name !== undefined) after.updateShotName(shotId, resolveUniqueShotName(after.shots, input.name, shotId))
        if (input.cameraId !== undefined) after.updateShotCamera(shotId, input.cameraId)
        if (input.continuity !== undefined) after.updateShotContinuity(shotId, input.continuity)
        if (input.hold !== undefined || input.transitionDuration !== undefined) {
          after.updateShotTiming(shotId, { hold: input.hold, transitionDuration: input.transitionDuration })
        }
        shotIds.push(shotId)
      }
      await saveCurrentProject()
      logger.info('三维镜头卡批量新建完成', {
        event: 'camera_stage.shot.create.completed', projectId, shotCount: shotIds.length,
      })
      return { projectId, shotIds, undoToken }
    } catch (error) {
      await rollback(projectId, undoToken, 'camera_stage.shot.create.rollback_failed')
      logger.error('三维镜头卡批量新建失败', error, { event: 'camera_stage.shot.create.failed', projectId })
      throw error
    }
  },

  async removeShots(projectId: string, shotIds: string[]): Promise<{
    projectId: string
    removedCount: number
    undoToken: string
  }> {
    await ensureProjectLoaded(projectId)
    const state = useCameraStageStore.getState()
    const missing = shotIds.filter((id) => !state.shots.some((shot) => shot.id === id))
    if (missing.length > 0) {
      throw new Error(`SHOT_NOT_FOUND：${missing.join('、')} 不是本工程中的镜头卡 id，先观察场景再删除。`)
    }
    const undoToken = captureCameraStageUndo(projectId)
    try {
      if (shotIds.length === 1) state.removeShot(shotIds[0])
      else state.removeShots(shotIds)
      await saveCurrentProject()
      return { projectId, removedCount: shotIds.length, undoToken }
    } catch (error) {
      await rollback(projectId, undoToken, 'camera_stage.shot.remove.rollback_failed')
      logger.error('三维镜头卡删除失败', error, { event: 'camera_stage.shot.remove.failed', projectId })
      throw error
    }
  },
}
