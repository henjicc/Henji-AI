import { createLogger } from '@/core/logging'
import { CAMERA_STAGE_NAME_MAX_LENGTH } from '@/core/assistant/capabilities/cameraStageCapabilitySchemas'

import { getAnimatablePropByPath } from '../domain/animatableProps'
import type { StageCameraAspectRatio, StageCameraLookAt, StageObject, StageObjectPatch, StageTransform, StageVec3 } from '../domain/sceneTypes'
import type { StageCameraEffector, StageStateKeyframe, StageSpatialPath } from '../domain/stateKeyframeTypes'
import type { StageKeyframeValue, StagePlaybackState } from '../domain/animationTypes'
import { POSE_PRESETS } from '../domain/posePresets.gen'
import { markSpatialPathCustom } from '../domain/spatialPath'
import {
  createNewProject,
  deleteProject as deleteStoredProject,
  listProjects,
  loadProjectIntoScene,
  readProjectSnapshot,
  renameProject as renameStoredProject,
  saveCurrentProject,
  type CameraStageProjectSnapshot,
} from '../projects/cameraStageProjectService'
import { compileStateKeyframesToAnimation } from '../domain/stateKeyframeCompiler'
import { useCameraStageStore } from '../store/cameraStageStore'
import { captureObjectsIntoStateKeyframe } from '../store/stateKeyframeSlice'
import {
  calculateStageObjectBounds,
  dimensionsToScale,
  listSceneCollisionPairs,
  matchReusableSceneObject,
  resolveScenePlacement,
  type CameraStageObjectSpec,
  type CameraStagePlacementIntent,
  type StageObjectBounds,
} from './sceneAnalysis'
import { captureCameraStageUndo, restoreCameraStageUndo } from './cameraStageUndo'

const logger = createLogger('features.cameraStage.application')

export interface CameraStageObjectUpdate {
  name?: string
  visible?: boolean
  color?: string
  transform?: Partial<StageTransform>
  fov?: number
  lookAt?: StageCameraLookAt
  aspectRatio?: StageCameraAspectRatio
  variant?: 'standard' | 'strong' | 'slim' | 'child'
  effectors?: StageCameraEffector[]
}

export interface CameraStageStateKeyframeUpdate {
  name?: string
  /** 状态关键帧在时间轴上的位置。落到 store 的 moveStateKeyframeTime，那里负责对帧量化并保持状态关键帧有序。 */
  time?: number
  hold?: number
  transitionDuration?: number
  continuity?: StageStateKeyframe['continuity']
  cameraId?: string | null
  /**
   * 把列出的对象/摄像机当前在场景中的实时状态记录进这张状态关键帧（2.2 状态捕获入口）。
   * 只覆盖列出的对象，不触碰这张卡上其余对象、也不触碰其他状态关键帧——不会重新打开
   * "新对象在其余卡上停留默认状态、播放时插值"那个已修问题（modelingWrite.test.ts）。
   */
  captureObjectIds?: string[]
}

export interface CameraStageSceneObservation {
  project: { id: string; name: string }
  activeCameraId: string | null
  objects: Array<{
    id: string
    type: StageObject['type']
    name: string
    visible: boolean
    transform: StageTransform
    bounds: StageObjectBounds
    primitiveKind?: string
    lookAt?: StageCameraLookAt
  }>
  stateKeyframes: Array<{
    id: string
    name: string
    time: number
    hold: number
    transitionDuration: number
    continuity: StageStateKeyframe['continuity']
    cameraId: string | null
  }>
  trajectories: Array<{
    stateKeyframeId: string
    objectId: string
    source: string
    knotCount: number
  }>
  collisions: Array<{ objectIds: [string, string] }>
}

interface PlaceObjectInput {
  projectId: string
  spec: CameraStageObjectSpec
  placement: CameraStagePlacementIntent
}

function assertFiniteVec3(value: StageVec3, label: string): void {
  if (![value.x, value.y, value.z].every(Number.isFinite)) throw new Error(`INVALID_${label}`)
}

export function resolveUniqueCameraStageObjectName(
  objects: StageObject[],
  requested: string,
  excludedId?: string,
): string {
  const base = requested.trim().slice(0, CAMERA_STAGE_NAME_MAX_LENGTH)
  if (!base) throw new Error('INVALID_INPUT')
  const occupied = new Set(objects.filter((object) => object.id !== excludedId).map((object) => object.name))
  if (!occupied.has(base)) return base
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = ` ${index}`
    const candidate = `${base.slice(0, CAMERA_STAGE_NAME_MAX_LENGTH - suffix.length)}${suffix}`
    if (!occupied.has(candidate)) return candidate
  }
  throw new Error('NAME_CONFLICT')
}

function requireObject(projectId: string, objectId: string): StageObject {
  const state = useCameraStageStore.getState()
  if (state.currentProjectId !== projectId) throw new Error('STALE_CONTEXT')
  const object = state.objects.find((candidate) => candidate.id === objectId)
  if (!object) throw new Error('NOT_FOUND')
  return object
}

function validateObjectUpdate(object: StageObject, objects: StageObject[], update: CameraStageObjectUpdate): StageObjectPatch {
  const patch: StageObjectPatch = {}
  if (update.name !== undefined) {
    const unique = resolveUniqueCameraStageObjectName(objects, update.name, object.id)
    if (unique !== update.name.trim()) throw new Error('NAME_CONFLICT')
    patch.name = unique
  }
  if (update.visible !== undefined) patch.visible = update.visible
  if (update.color !== undefined) {
    if (!/^#[0-9a-f]{6}$/i.test(update.color)) throw new Error('INVALID_COLOR')
    patch.color = update.color
  }
  if (update.transform) {
    const transform: StageTransform = {
      position: update.transform.position ?? object.transform.position,
      rotation: update.transform.rotation ?? object.transform.rotation,
      scale: update.transform.scale ?? object.transform.scale,
    }
    assertFiniteVec3(transform.position, 'POSITION')
    assertFiniteVec3(transform.rotation, 'ROTATION')
    assertFiniteVec3(transform.scale, 'SCALE')
    if ([transform.scale.x, transform.scale.y, transform.scale.z].some((value) => value <= 0)) throw new Error('INVALID_SCALE')
    patch.transform = transform
  }
  if (update.fov !== undefined) {
    if (object.type !== 'camera' || !Number.isFinite(update.fov) || update.fov < 1 || update.fov > 179) throw new Error('INVALID_FOV')
    patch.fov = update.fov
  }
  if (update.lookAt !== undefined) {
    if (object.type !== 'camera') throw new Error('OBJECT_TYPE_MISMATCH')
    if (update.lookAt.mode === 'manual') assertFiniteVec3(update.lookAt.target, 'LOOK_AT')
    else {
      const lookAtObjectId = update.lookAt.objectId
      if (lookAtObjectId === object.id || !objects.some((candidate) => candidate.id === lookAtObjectId)) throw new Error('INVALID_REFERENCE')
    }
    patch.lookAt = structuredClone(update.lookAt)
  }
  if (update.aspectRatio !== undefined) {
    if (object.type !== 'camera' || !Number.isFinite(update.aspectRatio.ratio) || update.aspectRatio.ratio <= 0) throw new Error('INVALID_ASPECT_RATIO')
    patch.aspectRatio = { ...update.aspectRatio }
  }
  if (update.variant !== undefined) {
    if (object.type !== 'character') throw new Error('OBJECT_TYPE_MISMATCH')
    patch.variant = update.variant
  }
  if (update.effectors !== undefined) {
    if (object.type !== 'camera') throw new Error('OBJECT_TYPE_MISMATCH')
    patch.effectors = structuredClone(update.effectors)
  }
  if (Object.keys(patch).length === 0) throw new Error('INVALID_INPUT')
  return patch
}

async function ensureProjectLoaded(projectId: string): Promise<void> {
  if (useCameraStageStore.getState().currentProjectId === projectId) return
  if (!await loadProjectIntoScene(projectId)) throw new Error('NOT_FOUND')
}

/**
 * 写入失败后把场景恢复到快照。回滚本身再失败也不能盖掉原始错误——原始错误才是模型需要
 * 看到的那条，回滚失败单独记日志。
 */
async function rollbackFailedPlacement(projectId: string, undoToken: string): Promise<void> {
  try {
    await restoreCameraStageUndo(undoToken)
  } catch (rollbackError) {
    logger.error('三维场景布置回滚失败', rollbackError, {
      event: 'camera_stage.object.place.rollback_failed',
      projectId,
    })
  }
}

/**
 * 校验 targetObjectId 指向真实存在的对象，**并在报错时给出可用值**。
 *
 * 原来这个校验藏在 `resolveScenePlacement` 里，抛的是裸 `NOT_FOUND`：模型既不知道自己填错
 * 了哪个字段，也不知道该填什么，只能猜——实测就是连续几轮都卡在这。schema 那边
 * `targetObjectId` 是裸 `z.string()`，帮不上任何忙，所以错误信息必须自己把候选列出来。
 */
function requirePlacementTarget(objects: StageObject[], targetObjectId?: string): void {
  if (!targetObjectId) return
  if (objects.some((object) => object.id === targetObjectId)) return
  const available = objects
    .filter((object) => object.type !== 'camera')
    .map((object) => `${object.id}（${object.name}）`)
  throw new Error(
    `TARGET_OBJECT_NOT_FOUND：targetObjectId «${targetObjectId}» 不是本场景中的对象 id。`
    + `targetObjectId 必须取自观察结果里 objects[].id 的原值。`
    + (available.length > 0 ? `当前可用：${available.join('、')}。` : '当前场景没有可作为参照的对象。')
  )
}

function sceneObservation(snapshot: CameraStageProjectSnapshot): CameraStageSceneObservation {
  return {
    project: { id: snapshot.id, name: snapshot.name },
    activeCameraId: snapshot.activeCameraId,
    objects: snapshot.objects.map((object) => ({
      id: object.id,
      type: object.type,
      name: object.name,
      visible: object.visible,
      transform: structuredClone(object.transform),
      bounds: calculateStageObjectBounds(object),
      ...(object.type === 'primitive' ? { primitiveKind: object.kind } : {}),
      ...(object.type === 'camera' ? { lookAt: structuredClone(object.lookAt) } : {}),
    })),
    stateKeyframes: snapshot.stateKeyframes.map((stateKeyframe) => ({
      id: stateKeyframe.id,
      name: stateKeyframe.name,
      time: stateKeyframe.time,
      hold: stateKeyframe.hold,
      transitionDuration: stateKeyframe.transitionDuration,
      continuity: stateKeyframe.continuity,
      cameraId: stateKeyframe.cameraId,
    })),
    trajectories: snapshot.stateKeyframes.flatMap((stateKeyframe) => Object.entries(stateKeyframe.transition.perObject).flatMap(([objectId, detail]) => {
      const path = detail.spatialPath
      return path ? [{ stateKeyframeId: stateKeyframe.id, objectId, source: path.source.kind === 'preset' ? path.source.preset.kind : 'custom', knotCount: path.knots.length }] : []
    })),
    collisions: listSceneCollisionPairs(snapshot.objects),
  }
}

async function readDomainSnapshot(projectId: string): Promise<CameraStageProjectSnapshot> {
  const current = useCameraStageStore.getState()
  if (current.currentProjectId === projectId) {
    return {
      id: projectId,
      name: current.currentProjectName,
      createdAt: 0,
      updatedAt: 0,
      objects: current.objects,
      activeCameraId: current.activeCameraId,
      animation: current.animation,
      sceneSettings: current.sceneSettings,
      stateKeyframes: current.stateKeyframes,
    }
  }
  const snapshot = await readProjectSnapshot(projectId)
  if (!snapshot) throw new Error('NOT_FOUND')
  return snapshot
}

export const cameraStageApplicationService = {
  async listProjects(): Promise<Awaited<ReturnType<typeof listProjects>>> {
    return await listProjects()
  },

  async observeProject(projectId: string): Promise<CameraStageSceneObservation> {
    return sceneObservation(await readDomainSnapshot(projectId))
  },

  async readSnapshot(projectId: string): Promise<CameraStageProjectSnapshot> {
    return await readDomainSnapshot(projectId)
  },

  /**
   * 播放状态只对**当前打开的**工程有意义：它是会话态，不进工程文件。
   * 未打开该工程时返回 null，反射层据此不列出这个实体。
   */
  readPlayback(projectId: string): StagePlaybackState | null {
    const state = useCameraStageStore.getState()
    return state.currentProjectId === projectId ? { ...state.playback } : null
  },

  /** 播放控制。助手做完动画要能自己预览验证，而不是让用户去点播放。 */
  async updatePlayback(
    projectId: string,
    update: { playing?: boolean; currentTime?: number; loop?: boolean },
  ): Promise<{ projectId: string; playback: StagePlaybackState }> {
    await ensureProjectLoaded(projectId)
    const state = useCameraStageStore.getState()
    if (update.currentTime !== undefined) {
      if (!Number.isFinite(update.currentTime) || update.currentTime < 0) throw new Error('INVALID_TIME_RANGE')
      state.seek(update.currentTime)
    }
    if (update.loop !== undefined && update.loop !== state.playback.loop) state.toggleLoop()
    // 播放开关放最后：先定位、先设好循环，再决定播不播。
    if (update.playing !== undefined) {
      if (update.playing) state.play()
      else state.pause()
    }
    return { projectId, playback: { ...useCameraStageStore.getState().playback } }
  },

  async createProject(name: string): Promise<{ projectId: string; name: string }> {
    const project = await createNewProject(name.trim())
    return { projectId: project.id, name: project.name }
  },

  async openProject(projectId: string): Promise<{ projectId: string; name: string; objectCount: number; stateKeyframeCount: number }> {
    if (!await loadProjectIntoScene(projectId)) throw new Error('NOT_FOUND')
    const state = useCameraStageStore.getState()
    return { projectId, name: state.currentProjectName, objectCount: state.objects.length, stateKeyframeCount: state.stateKeyframes.length }
  },

  async renameProject(projectId: string, name: string): Promise<{ projectId: string; name: string }> {
    await renameStoredProject(projectId, name)
    return { projectId, name: name.trim() }
  },

  async deleteProject(projectId: string): Promise<{ projectId: string; status: 'deleted' }> {
    await deleteStoredProject(projectId)
    if (useCameraStageStore.getState().currentProjectId === projectId) useCameraStageStore.getState().newScene('未命名场景')
    return { projectId, status: 'deleted' }
  },

  async placeObject(input: PlaceObjectInput): Promise<{
    projectId: string
    objectId: string
    objectType: StageObject['type']
    decision: 'reused' | 'created'
    reason: string
    position: StageVec3
    bounds: StageObjectBounds
    conflicts: string[]
    undoToken?: string
  }> {
    logger.info('三维场景对象布置开始', {
      event: 'camera_stage.object.place.start',
      projectId: input.projectId,
      objectType: input.spec.objectType,
      reusePolicy: input.spec.reusePolicy,
    })
    try {
      await ensureProjectLoaded(input.projectId)
    const before = useCameraStageStore.getState()
    // 纯输入校验必须在任何写入之前做完。`resolveScenePlacement` 内部对不存在的
    // targetObjectId 抛裸 NOT_FOUND，而它在对象创建之后才被调用——结果是对象已经建出来、
    // 停在默认位置，事务却报失败，调用方拿到一个"失败但场景被改了"的状态。
    requirePlacementTarget(before.objects, input.placement.targetObjectId)
    const reuse = matchReusableSceneObject(before.objects, input.spec, before.activeCameraId)
    const noPlacementChange = reuse.object && !input.placement.position && !input.placement.rotation
      && !input.placement.scale && !input.placement.dimensions && !input.placement.targetObjectId
      && input.placement.mode === 'auto'
    if (reuse.object && noPlacementChange) {
      const bounds = calculateStageObjectBounds(reuse.object)
      logger.info('三维场景对象布置完成', {
        event: 'camera_stage.object.place.completed',
        projectId: input.projectId,
        objectId: reuse.object.id,
        decision: 'reused',
        conflictCount: 0,
      })
      return {
        projectId: input.projectId,
        objectId: reuse.object.id,
        objectType: reuse.object.type,
        decision: 'reused',
        reason: reuse.reason,
        position: reuse.object.transform.position,
        bounds,
        conflicts: [],
      }
    }
    const undoToken = captureCameraStageUndo(input.projectId)
    // 从这里开始有写入，任何失败都必须把场景恢复到 undoToken 的状态。快照早就在抓了，
    // 但失败路径从来没用过它——于是"事务失败"和"场景已被改动"可以同时成立，模型据此
    // 判断该重试还是该补救时必然判错。
    try {
      let object = reuse.object
      if (!object) {
        if (input.spec.objectType === 'primitive') before.addPrimitive(input.spec.primitiveKind ?? 'box')
        else if (input.spec.objectType === 'character') before.addCharacter()
        else before.addCamera()
        const createdId = useCameraStageStore.getState().selectedId
        object = useCameraStageStore.getState().objects.find((candidate) => candidate.id === createdId) ?? null
        if (!object) throw new Error('CAPABILITY_REJECTED')
      }
      const state = useCameraStageStore.getState()
      const layout = resolveScenePlacement(object, state.objects, input.placement)
      const scale = input.placement.dimensions
        ? dimensionsToScale(object, input.placement.dimensions)
        : input.placement.scale ?? object.transform.scale
      const transform: StageTransform = {
        position: layout.position,
        rotation: input.placement.rotation ?? object.transform.rotation,
        scale,
      }
      const name = input.spec.name
        ? resolveUniqueCameraStageObjectName(state.objects, input.spec.name, object.id)
        : object.name
      state.updateObject(object.id, { name, transform })
      await saveCurrentProject()
      const saved = requireObject(input.projectId, object.id)
      logger.info('三维场景对象布置完成', {
        event: 'camera_stage.object.place.completed',
        projectId: input.projectId,
        objectId: saved.id,
        decision: reuse.object ? 'reused' : 'created',
        conflictCount: layout.conflicts.length,
      })
      return {
        projectId: input.projectId,
        objectId: saved.id,
        objectType: saved.type,
        decision: reuse.object ? 'reused' : 'created',
        reason: `${reuse.reason} ${layout.reason}`,
        position: saved.transform.position,
        bounds: calculateStageObjectBounds(saved),
        conflicts: layout.conflicts,
        undoToken,
      }
    } catch (error) {
      await rollbackFailedPlacement(input.projectId, undoToken)
      throw error
    }
    } catch (error) {
      logger.error('三维场景对象布置失败', error, {
        event: 'camera_stage.object.place.failed',
        projectId: input.projectId,
        objectType: input.spec.objectType,
        reusePolicy: input.spec.reusePolicy,
        // 入参必须进日志：这次排查卡在"无法确定模型到底填了什么 targetObjectId"上
        placementMode: input.placement.mode,
        targetObjectId: input.placement.targetObjectId ?? null,
        hasExplicitPosition: Boolean(input.placement.position),
      })
      throw error
    }
  },

  async updateObject(projectId: string, objectId: string, update: CameraStageObjectUpdate): Promise<{ projectId: string; objectId: string; updatedKeys: string[]; undoToken: string }> {
    await ensureProjectLoaded(projectId)
    const object = requireObject(projectId, objectId)
    const state = useCameraStageStore.getState()
    const patch = validateObjectUpdate(object, state.objects, update)
    const undoToken = captureCameraStageUndo(projectId)
    /*
     * 助手的写入是**建模**，不是动画编辑，必须同步到所有状态关键帧。
     *
     * 动画编辑时 store.updateObject 会把改动只捕获进当前时间点的状态关键帧（captureObjectsIntoStateKeyframe
     * 对其他状态关键帧直接原样返回），而新对象在创建时是以默认状态写进**所有**状态关键帧的。两者一叠加：
     * 助手"放一个白色球体"之后，球体在 1 张卡上是新位置+白色、在其余 146 张卡上是默认位置+
     * 默认颜色——播放时插值，球体一边移动一边变色，实测截图里它是淡黄色而不是白色。
     *
     * 人手动拖物体时希望自动打点（那确实是在编辑动画），所以 store.updateObject 的行为不动；
     * 走能力层的写入改用建模语义。
     */
    state.updateObjectAcrossStateKeyframes(objectId, patch)
    await saveCurrentProject()
    return { projectId, objectId, updatedKeys: Object.keys(patch), undoToken }
  },

  /**
   * 逐分量动画属性直接写入：调用 store 的 `updateTransform` / `updatePoseJoint` / `updateObject`，
   * 在当前播放时间创建或更新聚合状态关键帧。
   *
   * 这条路径与 `updateObject()`（上面那个）故意分开：那个是"建模"语义，一律同步全部状态关键帧、
   * 从不自动打点；这个是"动画编辑"语义，只在有轨道时才打点。两条路径混用同一个 store 动作
   * 会重新打开重要记录 002 描述的陷阱——静态值刚写完，播放头一动就被插值结果覆盖回去。
   *
   * 所有动画编辑只存在这一条落地语义，派生轨道不会成为第二真相源。
   */
  async updateAnimatableProperties(
    projectId: string,
    objectId: string,
    values: Record<string, StageKeyframeValue>,
  ): Promise<{ projectId: string; objectId: string; updatedPaths: string[]; undoToken: string }> {
    await ensureProjectLoaded(projectId)
    const object = requireObject(projectId, objectId)
    const paths = Object.keys(values)
    if (paths.length === 0) throw new Error('INVALID_INPUT')
    for (const path of paths) {
      const descriptor = getAnimatablePropByPath(path)
      if (!descriptor || !descriptor.isAvailable(object)) {
        throw new Error(`ANIMATABLE_PATH_INVALID：属性路径 «${path}» 对该对象不可用。`)
      }
    }
    const undoToken = captureCameraStageUndo(projectId)
    const actions = useCameraStageStore.getState()
    for (const path of paths) {
      const current = requireObject(projectId, objectId)
      const descriptor = getAnimatablePropByPath(path)!
      const next = descriptor.applyToObject(current, values[path])
      if (path.startsWith('transform.position')) actions.updateTransform(objectId, { position: next.transform.position }, [path])
      else if (path.startsWith('transform.rotation')) actions.updateTransform(objectId, { rotation: next.transform.rotation }, [path])
      else if (path.startsWith('transform.scale')) actions.updateTransform(objectId, { scale: next.transform.scale }, [path])
      else if (path === 'color') actions.updateObject(objectId, { color: next.color })
      else if (path === 'fov' && next.type === 'camera') actions.updateObject(objectId, { fov: next.fov })
      else if (path.startsWith('pose.joints.') && next.type === 'character') {
        const jointId = path.split('.')[2] as keyof typeof next.pose.joints
        actions.updatePoseJoint(objectId, jointId, next.pose.joints[jointId] ?? { x: 0, y: 0, z: 0 }, [path])
      }
    }
    await saveCurrentProject()
    return { projectId, objectId, updatedPaths: paths, undoToken }
  },

  /**
   * 一键套用预设姿势：整体替换角色姿态并记录到当前状态关键帧——委托给
   * `store.applyPosePreset`，与界面姿态面板的预设按钮同一份实现，未重写。
   * 语义上与逐分量写入同属“动画编辑”，复用 store 的正式落地语义。
   */
  async applyObjectPosePreset(
    projectId: string,
    objectId: string,
    presetId: string,
  ): Promise<{ projectId: string; objectId: string; presetId: string; undoToken: string }> {
    await ensureProjectLoaded(projectId)
    const object = requireObject(projectId, objectId)
    if (object.type !== 'character') throw new Error('OBJECT_TYPE_MISMATCH：pose_preset 只对角色对象有效。')
    const state = useCameraStageStore.getState()
    const preset = POSE_PRESETS.find((candidate) => candidate.id === presetId)
    if (!preset) {
      throw new Error(`POSE_PRESET_NOT_FOUND：«${presetId}» 不是已知预设。可用预设：${POSE_PRESETS.map((item) => item.id).join('、')}。`)
    }
    const undoToken = captureCameraStageUndo(projectId)
    state.applyPosePreset(objectId, preset)
    await saveCurrentProject()
    return { projectId, objectId, presetId, undoToken }
  },

  /**
   * 手工编辑三维轨迹（2.5）：`path` 走 `store.setStateKeyframeSpatialPath`（整条路径替换，与界面拖控制点
   * /切线手柄同一份实现），`startPosition`/`endPosition` 走 `store.setStateKeyframePathAnchor`（挪相邻
   * 状态关键帧里该对象的位置快照）。两者是独立的 store 动作，可以同一次提交里都出现。
   *
   * 与 `apply_camera_stage_camera_move`（`cameraMotionService.ts`）不冲突：那条路径产生初始
   * 轨迹（算法采样），这条路径编辑已产生的轨迹（人工调整），两者落地到同一个字段
   * （`stateKeyframe.transition.perObject[objectId].spatialPath`），互不知道对方存在也不需要知道——
   * 后写的值就是最终值，与界面上"先套预设、再手动微调控制点"完全一致的行为。
   */
  async updateTrajectory(
    projectId: string,
    stateKeyframeId: string,
    objectId: string,
    update: { path?: StageSpatialPath; startPosition?: StageVec3; endPosition?: StageVec3 },
  ): Promise<{ projectId: string; stateKeyframeId: string; objectId: string; undoToken: string }> {
    await ensureProjectLoaded(projectId)
    const state = useCameraStageStore.getState()
    if (!state.stateKeyframes.some((stateKeyframe) => stateKeyframe.id === stateKeyframeId)) throw new Error('NOT_FOUND')
    const undoToken = captureCameraStageUndo(projectId)
    if (update.path !== undefined) state.setStateKeyframeSpatialPath(stateKeyframeId, objectId, markSpatialPathCustom(update.path))
    if (update.startPosition !== undefined) state.setStateKeyframePathAnchor(stateKeyframeId, objectId, 'start', update.startPosition)
    if (update.endPosition !== undefined) state.setStateKeyframePathAnchor(stateKeyframeId, objectId, 'end', update.endPosition)
    await saveCurrentProject()
    return { projectId, stateKeyframeId, objectId, undoToken }
  },

  async duplicateObject(projectId: string, objectId: string): Promise<{ projectId: string; objectId: string; duplicatedFromObjectId: string; undoToken: string }> {
    await ensureProjectLoaded(projectId)
    requireObject(projectId, objectId)
    const undoToken = captureCameraStageUndo(projectId)
    useCameraStageStore.getState().duplicateObject(objectId)
    const createdId = useCameraStageStore.getState().selectedId
    if (!createdId) throw new Error('CAPABILITY_REJECTED')
    await saveCurrentProject()
    return { projectId, objectId: createdId, duplicatedFromObjectId: objectId, undoToken }
  },

  async deleteObject(projectId: string, objectId: string): Promise<{ projectId: string; objectId: string; status: 'deleted' }> {
    await ensureProjectLoaded(projectId)
    requireObject(projectId, objectId)
    useCameraStageStore.getState().removeObject(objectId)
    await saveCurrentProject()
    return { projectId, objectId, status: 'deleted' }
  },

  async updateStateKeyframe(projectId: string, stateKeyframeId: string, update: CameraStageStateKeyframeUpdate): Promise<{ projectId: string; stateKeyframeId: string; status: 'updated'; undoToken: string }> {
    await ensureProjectLoaded(projectId)
    const state = useCameraStageStore.getState()
    if (!state.stateKeyframes.some((stateKeyframe) => stateKeyframe.id === stateKeyframeId)) throw new Error('NOT_FOUND')
    if (update.cameraId && !state.objects.some((object) => object.id === update.cameraId && object.type === 'camera')) throw new Error('INVALID_REFERENCE')
    if (update.hold !== undefined && (!Number.isFinite(update.hold) || update.hold < 0)) throw new Error('INVALID_TIME_RANGE')
    if (update.transitionDuration !== undefined && (!Number.isFinite(update.transitionDuration) || update.transitionDuration < 0)) throw new Error('INVALID_TIME_RANGE')
    if (update.time !== undefined && (!Number.isFinite(update.time) || update.time < 0)) throw new Error('INVALID_TIME_RANGE')
    if (update.captureObjectIds !== undefined) {
      const missing = update.captureObjectIds.filter((id) => !state.objects.some((object) => object.id === id))
      if (missing.length > 0) {
        throw new Error(
          `STATE_KEYFRAME_CAPTURE_OBJECT_NOT_FOUND：${missing.join('、')} 不是本场景中的对象 id，`
          + `capture_object_refs 里的引用必须取自观察结果里 objects[].id 的原值。`
        )
      }
    }
    const undoToken = captureCameraStageUndo(projectId)
    if (update.name !== undefined) state.updateStateKeyframeName(stateKeyframeId, update.name)
    // 时间点先落，后续的 hold / 过渡时长都是相对这个位置计算的。
    if (update.time !== undefined) state.moveStateKeyframeTime(stateKeyframeId, update.time)
    if (update.hold !== undefined || update.transitionDuration !== undefined) state.updateStateKeyframeTiming(stateKeyframeId, update)
    if (update.continuity !== undefined) state.updateStateKeyframeContinuity(stateKeyframeId, update.continuity)
    if (update.cameraId !== undefined) state.updateStateKeyframeCamera(stateKeyframeId, update.cameraId)
    if (update.captureObjectIds !== undefined) {
      // 只覆盖列出的对象在目标状态关键帧上的快照，不触碰其余对象或其他时间点。
      const current = useCameraStageStore.getState()
      const stateKeyframes = captureObjectsIntoStateKeyframe(current.stateKeyframes, stateKeyframeId, current.objects, update.captureObjectIds)
      useCameraStageStore.setState({ stateKeyframes, animation: compileStateKeyframesToAnimation(stateKeyframes, current.objects) })
    }
    await saveCurrentProject()
    return { projectId, stateKeyframeId, status: 'updated', undoToken }
  },
}
