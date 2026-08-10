import { createLogger } from '@/core/logging'

import { loadProjectIntoScene, saveCurrentProject } from '../projects/cameraStageProjectService'
import { upsertTrackKeyframe, removeTrackKeyframe, getTrack } from '../store/animationActions'
import type { StageEasing } from '../domain/animationTypes'
import { useCameraStageStore } from '../store/cameraStageStore'
import { captureCameraStageUndo, restoreCameraStageUndo } from './cameraStageUndo'

export interface CameraStageTrackRef {
  objectId: string
  propertyPath: string
}

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
 * 简易模式下写关键帧是**静默数据丢失**，必须挡在门口。
 *
 * 简易模式的真相是「镜头卡才是时间轴」：`shotSlice` 里有 14 处
 * `animation: compile(shots, objects)`——任何一次镜头卡改动都会把 animation 整个重算一遍，
 * 直接写进 `animation.tracks` 的关键帧当场被覆盖；`bakeToProMode()` 同样是从镜头卡重新编译，
 * 也不会保留它们。而 `play()` 在简易模式只看镜头卡数量，所以这些关键帧连播都播不出来。
 *
 * 三件事叠加的结果：助手写完关键帧、拿到成功回执、向用户报告"动画做好了"，而场景里什么都
 * 没有发生。这比直接失败糟得多——失败至少还能改道。所以宁可在这里拒绝，并且**把改道说清楚**。
 *
 * 人在界面上撞不到这个坑：简易模式压根没有关键帧编辑界面。这一条不是给助手加限制，
 * 是把人机行为对齐。
 */
export function assertProModeForKeyframes(action: '写入' | '删除' | '清空' | '修改'): void {
  const state = useCameraStageStore.getState()
  if (state.editorMode !== 'simple') return
  throw new Error(
    `KEYFRAME_REQUIRES_PRO_MODE：当前工程是简易模式，${action}关键帧不会生效。`
    + '简易模式下时间轴由镜头卡编译而成，直接写入的关键帧会被下一次镜头卡改动覆盖，'
    + '也无法播放。两条可选路径：'
    + '① 用 bake_camera_stage_to_pro 把工程烘焙成专业模式（单向，之后不能改回简易），再写关键帧；'
    + `② 留在简易模式，改用 camera_stage.shot 的集合写入建镜头卡来做动画（当前 ${state.shots.length} 张）。`
  )
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

/** 与 `assertKeyframesValid` 同一把尺子，只是不校验 time（清空轨道不带时间点）。 */
function assertTracksValid(targets: CameraStageTrackRef[], objectIds: Set<string>): void {
  for (const [index, target] of targets.entries()) {
    if (!objectIds.has(target.objectId)) {
      throw new Error(
        `KEYFRAME_OBJECT_NOT_FOUND：第 ${index} 项的 objectId «${target.objectId}» 不在本场景中。`
        + `objectId 必须取自观察结果里 objects[].id 的原值。当前可用：${[...objectIds].join('、') || '无'}。`
      )
    }
    if (!WRITABLE_PROPERTY_PATHS.has(target.propertyPath)) {
      throw new Error(
        `KEYFRAME_PROPERTY_PATH_INVALID：第 ${index} 项的 propertyPath «${target.propertyPath}» 不可写。`
        + `可写路径：${[...WRITABLE_PROPERTY_PATHS].join('、')}。`
      )
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
    assertProModeForKeyframes('写入')
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
    assertProModeForKeyframes('删除')
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

  /**
   * 整条清空动画轨道（2.5）。逐条指定关键帧引用删除条数多时会撞上集合写入的
   * `maxItemsPerChange` 上限，而且啰嗦——清空一条轨道本来就是一件事，不该表达成
   * "先列举全部关键帧再逐条删"。领域层的 `clearTrack`（`keyframeSlice.ts`）早就是完整实现，
   * 缺的只是这一条正式入口。
   */
  async clearTracks(projectId: string, targets: CameraStageTrackRef[]): Promise<{
    projectId: string
    clearedCount: number
    undoToken: string
  }> {
    await ensureProjectLoaded(projectId)
    assertProModeForKeyframes('清空')
    const before = useCameraStageStore.getState()
    assertTracksValid(targets, new Set(before.objects.map((object) => object.id)))
    const missing = targets.filter((target) => !getTrack(before.animation, target.objectId, target.propertyPath))
    if (missing.length > 0) {
      throw new Error(`KEYFRAME_TRACK_NOT_FOUND：${missing.length} 个目标所在的轨道不存在，先观察场景再清空。`)
    }
    const undoToken = captureCameraStageUndo(projectId)
    try {
      for (const target of targets) {
        useCameraStageStore.getState().clearTrack(target.objectId, target.propertyPath)
      }
      await saveCurrentProject()
      return { projectId, clearedCount: targets.length, undoToken }
    } catch (error) {
      await rollback(projectId, undoToken)
      logger.error('三维动画轨道清空失败', error, {
        event: 'camera_stage.track.clear.failed',
        projectId,
        trackCount: targets.length,
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
