import { createLogger } from '@/core/logging'
import { CAMERA_STAGE_NAME_MAX_LENGTH } from '@/core/assistant/capabilities/cameraStageCapabilitySchemas'

import type { StageObject } from '../domain/sceneTypes'
import type { StageStateKeyframe } from '../domain/stateKeyframeTypes'
import { loadProjectIntoScene, saveCurrentProject } from '../projects/cameraStageProjectService'
import { useCameraStageStore } from '../store/cameraStageStore'
import { captureCameraStageUndo, restoreCameraStageUndo } from './cameraStageUndo'

const logger = createLogger('features.cameraStage.application')

/**
 * 状态关键帧的批量增删。
 *
 * `collectionWrite` 补齐前，`camera_stage.state_keyframe` 只能靠专用能力 `add_camera_stage_stateKeyframe` 新建、
 * 删不掉也排不了序——store 侧的 `removeStateKeyframe`/`removeStateKeyframes` 早就是完整实现（含选中态回退与
 * 过渡时长重算），缺的只是集合写入这一条正式入口。创建复用 `store.addStateKeyframe()` 的合并语义：
 * 先把播放头 seek 到目标时间（顺带把插值采样结果录进新状态关键帧，与人在界面上拖动播放头再点新建
 * 完全一致），同一帧已有状态关键帧时自动更新它，不产生重复时间点。
 */

export interface CameraStageStateKeyframeCreateInput {
  time: number
  name?: string
  cameraId?: string | null
  continuity?: StageStateKeyframe['continuity']
  hold?: number
  transitionDuration?: number
}

async function ensureProjectLoaded(projectId: string): Promise<void> {
  if (useCameraStageStore.getState().currentProjectId === projectId) return
  if (!await loadProjectIntoScene(projectId)) throw new Error(`PROJECT_NOT_FOUND:${projectId}`)
}

/** 纯输入校验，必须在任何写入之前跑完——写到一半才发现参数不对，留下的残局比失败本身更难收拾。 */
function assertStateKeyframeInputsValid(inputs: CameraStageStateKeyframeCreateInput[], objects: StageObject[]): void {
  const cameraIds = new Set(objects.filter((object) => object.type === 'camera').map((object) => object.id))
  for (const [index, input] of inputs.entries()) {
    if (!Number.isFinite(input.time) || input.time < 0 || input.time > 3_600) {
      throw new Error(`STATE_KEYFRAME_TIME_INVALID：第 ${index} 项的 time 必须是 0~3600 秒之间的有限数。`)
    }
    if (input.cameraId && !cameraIds.has(input.cameraId)) {
      throw new Error(
        `STATE_KEYFRAME_CAMERA_NOT_FOUND：第 ${index} 项的 camera_ref «${input.cameraId}» 不是本场景中的摄像机。`
        + `camera_ref 必须取自观察结果里 objects[].id 的原值。当前可用摄像机：${[...cameraIds].join('、') || '无'}。`
      )
    }
    if (input.hold !== undefined && (!Number.isFinite(input.hold) || input.hold < 0)) {
      throw new Error(`STATE_KEYFRAME_HOLD_INVALID：第 ${index} 项的 hold 必须是不小于 0 的有限数。`)
    }
    if (input.transitionDuration !== undefined && (!Number.isFinite(input.transitionDuration) || input.transitionDuration < 0)) {
      throw new Error(`STATE_KEYFRAME_TRANSITION_DURATION_INVALID：第 ${index} 项的 transition_duration 必须是不小于 0 的有限数。`)
    }
    if (input.name !== undefined && input.name.trim().length === 0) {
      throw new Error(`STATE_KEYFRAME_NAME_INVALID：第 ${index} 项的 name 不能是空字符串。`)
    }
  }
}

function resolveUniqueStateKeyframeName(stateKeyframes: StageStateKeyframe[], requested: string, excludedId: string): string {
  const base = requested.trim().slice(0, CAMERA_STAGE_NAME_MAX_LENGTH)
  const occupied = new Set(stateKeyframes.filter((stateKeyframe) => stateKeyframe.id !== excludedId).map((stateKeyframe) => stateKeyframe.name))
  if (!occupied.has(base)) return base
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = ` ${index}`
    const candidate = `${base.slice(0, CAMERA_STAGE_NAME_MAX_LENGTH - suffix.length)}${suffix}`
    if (!occupied.has(candidate)) return candidate
  }
  throw new Error('STATE_KEYFRAME_NAME_CONFLICT')
}

async function rollback(projectId: string, undoToken: string, event: string): Promise<void> {
  try {
    await restoreCameraStageUndo(undoToken)
  } catch (rollbackError) {
    logger.error('三维状态关键帧回滚失败', rollbackError, { event, projectId })
  }
}

export const cameraStageStateKeyframeService = {
  /** 批量新建状态关键帧；同一批次里落在同一帧的两项会像人工操作一样合并为一个时间点。 */
  async createStateKeyframes(projectId: string, inputs: CameraStageStateKeyframeCreateInput[]): Promise<{
    projectId: string
    stateKeyframeIds: string[]
    undoToken: string
  }> {
    logger.info('三维状态关键帧批量新建开始', {
      event: 'camera_stage.state_keyframe.create.start', projectId, stateKeyframeCount: inputs.length,
    })
    await ensureProjectLoaded(projectId)
    const before = useCameraStageStore.getState()
    assertStateKeyframeInputsValid(inputs, before.objects)
    const undoToken = captureCameraStageUndo(projectId)
    try {
      const stateKeyframeIds: string[] = []
      for (const input of inputs) {
        const state = useCameraStageStore.getState()
        /*
         * seek 是对的，别改成 setPlaybackTime。
         *
         * 这条服务复刻的是「把播放头拖到 T，点新建状态关键帧」——那张卡本来就该录下 T 时刻的
         * 插值姿态，所以必须 scrub。改成只挪播放头会让一批卡全部录下播放头**原来**位置的
         * 姿态，反而全都一样。
         *
         * 自动动画记录走的是另一条路：先写 camera_stage.playback.current_time 把播放头
         * 挪到 T，再改物体 transform——状态关键帧编辑器会在 T 自动记录完整场景状态。
         * 建卡与改姿态是两件事，不要指望在建卡这一步顺带改姿态。
         */
        state.seek(input.time)
        state.addStateKeyframe()
        const after = useCameraStageStore.getState()
        const stateKeyframeId = after.selectedStateKeyframeId
        if (!stateKeyframeId) throw new Error('CAPABILITY_REJECTED')
        if (input.name !== undefined) after.updateStateKeyframeName(stateKeyframeId, resolveUniqueStateKeyframeName(after.stateKeyframes, input.name, stateKeyframeId))
        if (input.cameraId !== undefined) after.updateStateKeyframeCamera(stateKeyframeId, input.cameraId)
        if (input.continuity !== undefined) after.updateStateKeyframeContinuity(stateKeyframeId, input.continuity)
        if (input.hold !== undefined || input.transitionDuration !== undefined) {
          after.updateStateKeyframeTiming(stateKeyframeId, { hold: input.hold, transitionDuration: input.transitionDuration })
        }
        stateKeyframeIds.push(stateKeyframeId)
      }
      await saveCurrentProject()
      logger.info('三维状态关键帧批量新建完成', {
        event: 'camera_stage.state_keyframe.create.completed', projectId, stateKeyframeCount: stateKeyframeIds.length,
      })
      return { projectId, stateKeyframeIds, undoToken }
    } catch (error) {
      await rollback(projectId, undoToken, 'camera_stage.state_keyframe.create.rollback_failed')
      logger.error('三维状态关键帧批量新建失败', error, { event: 'camera_stage.state_keyframe.create.failed', projectId })
      throw error
    }
  },

  async removeStateKeyframes(projectId: string, stateKeyframeIds: string[]): Promise<{
    projectId: string
    removedCount: number
    undoToken: string
  }> {
    await ensureProjectLoaded(projectId)
    const state = useCameraStageStore.getState()
    const missing = stateKeyframeIds.filter((id) => !state.stateKeyframes.some((stateKeyframe) => stateKeyframe.id === id))
    if (missing.length > 0) {
      throw new Error(`STATE_KEYFRAME_NOT_FOUND：${missing.join('、')} 不是本工程中的状态关键帧 id，先观察场景再删除。`)
    }
    const undoToken = captureCameraStageUndo(projectId)
    try {
      if (stateKeyframeIds.length === 1) state.removeStateKeyframe(stateKeyframeIds[0])
      else state.removeStateKeyframes(stateKeyframeIds)
      await saveCurrentProject()
      return { projectId, removedCount: stateKeyframeIds.length, undoToken }
    } catch (error) {
      await rollback(projectId, undoToken, 'camera_stage.state_keyframe.remove.rollback_failed')
      logger.error('三维状态关键帧删除失败', error, { event: 'camera_stage.state_keyframe.remove.failed', projectId })
      throw error
    }
  },
}
