import { createLogger } from '@/core/logging'

import { loadProjectIntoScene, saveCurrentProject } from '../projects/cameraStageProjectService'
import { upsertTrackKeyframe, removeTrackKeyframe, getTrack } from '../store/animationActions'
import type { StageEasing } from '../domain/animationTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { captureCameraStageUndo, restoreCameraStageUndo } from './cameraStageUndo'

const logger = createLogger('features.cameraStage.application')

/**
 * 关键帧的批量增删。
 *
 * 领域层的轨道能力（`upsertTrackKeyframe` / `removeTrackKeyframe`）一直是完整的，只是从来
 * 没有对外的写入入口——助手能读能改已有关键帧，却建不出新的，于是"两个物体上下漂浮"这种
 * 需求直接无解。这里把它补成正式服务，交由反射层的集合写入统一调用。
 */

export interface CameraStageKeyframeInput {
  objectId: string
  propertyPath: string
  time: number
  value: number
  easing?: StageEasing
}

export interface CameraStageKeyframeRef {
  objectId: string
  propertyPath: string
  time: number
}

/** 可写关键帧属性路径的白名单。放开任意路径等于放开任意 store patch。 */
const WRITABLE_PROPERTY_PATHS = new Set([
  'transform.position.x', 'transform.position.y', 'transform.position.z',
  'transform.rotation.x', 'transform.rotation.y', 'transform.rotation.z',
  'transform.scale.x', 'transform.scale.y', 'transform.scale.z',
])

export function listWritableKeyframePropertyPaths(): string[] {
  return [...WRITABLE_PROPERTY_PATHS]
}

async function ensureProjectLoaded(projectId: string): Promise<void> {
  if (useCameraStageStore.getState().currentProjectId === projectId) return
  if (!await loadProjectIntoScene(projectId)) throw new Error(`PROJECT_NOT_FOUND:${projectId}`)
}

/**
 * 纯输入校验，**必须在任何写入之前跑完**，错误信息要能让调用方自我修正。
 * 这是三维布置那次事故的教训：写到一半才发现参数不对，留下的残局比失败本身更难收拾。
 */
function assertKeyframesValid(
  keyframes: Array<{ objectId: string; propertyPath: string; time: number }>,
  objectIds: Set<string>
): void {
  for (const [index, keyframe] of keyframes.entries()) {
    if (!objectIds.has(keyframe.objectId)) {
      throw new Error(
        `KEYFRAME_OBJECT_NOT_FOUND：第 ${index} 项的 objectId «${keyframe.objectId}» 不在本场景中。`
        + `objectId 必须取自观察结果里 objects[].id 的原值。当前可用：${[...objectIds].join('、') || '无'}。`
      )
    }
    if (!WRITABLE_PROPERTY_PATHS.has(keyframe.propertyPath)) {
      throw new Error(
        `KEYFRAME_PROPERTY_PATH_INVALID：第 ${index} 项的 propertyPath «${keyframe.propertyPath}» 不可写。`
        + `可写路径：${[...WRITABLE_PROPERTY_PATHS].join('、')}。`
      )
    }
    if (!Number.isFinite(keyframe.time) || keyframe.time < 0 || keyframe.time > 3_600) {
      throw new Error(`KEYFRAME_TIME_INVALID：第 ${index} 项的 time 必须是 0~3600 秒之间的有限数。`)
    }
  }
}

export const cameraStageKeyframeService = {
  /** 批量写入关键帧；同一对象同一路径同一时间点按 upsert 合并。 */
  async createKeyframes(projectId: string, keyframes: CameraStageKeyframeInput[]): Promise<{
    projectId: string
    createdCount: number
    duration: number
    undoToken: string
  }> {
    logger.info('三维关键帧写入开始', {
      event: 'camera_stage.keyframe.create.start',
      projectId,
      keyframeCount: keyframes.length,
    })
    await ensureProjectLoaded(projectId)
    const before = useCameraStageStore.getState()
    assertKeyframesValid(keyframes, new Set(before.objects.map((object) => object.id)))
    const undoToken = captureCameraStageUndo(projectId)
    try {
      let animation = before.animation
      let maxTime = animation.duration
      for (const keyframe of keyframes) {
        animation = upsertTrackKeyframe(
          animation,
          keyframe.objectId,
          keyframe.propertyPath,
          keyframe.time,
          keyframe.value,
          keyframe.easing,
        )
        maxTime = Math.max(maxTime, keyframe.time)
      }
      // 时间轴必须长到装得下最后一个关键帧，否则动画会被截断而调用方无从察觉
      useCameraStageStore.setState({ animation: { ...animation, duration: maxTime } })
      await saveCurrentProject()
      logger.info('三维关键帧写入完成', {
        event: 'camera_stage.keyframe.create.completed',
        projectId,
        keyframeCount: keyframes.length,
        duration: maxTime,
      })
      return { projectId, createdCount: keyframes.length, duration: maxTime, undoToken }
    } catch (error) {
      await rollback(projectId, undoToken)
      logger.error('三维关键帧写入失败', error, {
        event: 'camera_stage.keyframe.create.failed',
        projectId,
        keyframeCount: keyframes.length,
      })
      throw error
    }
  },

  async removeKeyframes(projectId: string, targets: CameraStageKeyframeRef[]): Promise<{
    projectId: string
    removedCount: number
    undoToken: string
  }> {
    await ensureProjectLoaded(projectId)
    const before = useCameraStageStore.getState()
    assertKeyframesValid(targets, new Set(before.objects.map((object) => object.id)))
    const missing = targets.filter((target) => !getTrack(before.animation, target.objectId, target.propertyPath))
    if (missing.length > 0) {
      throw new Error(`KEYFRAME_TRACK_NOT_FOUND：${missing.length} 个目标所在的轨道不存在，先观察场景再删除。`)
    }
    const undoToken = captureCameraStageUndo(projectId)
    try {
      let animation = before.animation
      for (const target of targets) {
        animation = removeTrackKeyframe(animation, target.objectId, target.propertyPath, target.time)
      }
      useCameraStageStore.setState({ animation })
      await saveCurrentProject()
      return { projectId, removedCount: targets.length, undoToken }
    } catch (error) {
      await rollback(projectId, undoToken)
      logger.error('三维关键帧删除失败', error, {
        event: 'camera_stage.keyframe.remove.failed',
        projectId,
        keyframeCount: targets.length,
      })
      throw error
    }
  },
}

/** 回滚自身失败不能顶掉原始错误：原始错误才是调用方需要据以决策的那条。 */
async function rollback(projectId: string, undoToken: string): Promise<void> {
  try {
    await restoreCameraStageUndo(undoToken)
  } catch (rollbackError) {
    logger.error('三维关键帧回滚失败', rollbackError, {
      event: 'camera_stage.keyframe.rollback_failed',
      projectId,
    })
  }
}
