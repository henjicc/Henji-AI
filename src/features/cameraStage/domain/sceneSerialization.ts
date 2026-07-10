/**
 * 运镜控制场景的序列化 / 反序列化（工程持久化用）。
 *
 * 工程文件里存的是一份带 `schemaVersion` 的场景快照；加载时按版本做向前兼容：
 * 低于当前版本的旧工程逐级迁移，高于当前版本直接报错（提示升级应用）。
 * v2 起并入关键帧动画（tracks/duration/fps）；加载 v1 工程视为无动画。
 * v3 起关键帧轨道按分量存储（位置/旋转/缩放/关节拆成 X/Y/Z 三条 scalar 轨道）；
 * 加载 v2 的整体 Vec3 轨道时自动拆分为分量轨道。
 * v4 起并入场景级设置（背景色/网格显隐）；加载 v3 及以下工程视为默认设置。
 * v5 起摄像机对象新增 aspectRatio（画幅比例）字段；加载 v4 及以下工程时给已有摄像机补默认 16:9。
 * v6 起场景设置拆分为 ground / sky / sunlight / fog；加载 v5 及以下工程时把旧背景色/网格迁移到新结构。
 * v7 起场景设置新增 display.showNameLabels；加载 v6 及以下工程时默认不显示名称标签。
 * v8 起名称标签新增文字色/背景色/大小/位置偏移；加载 v7 及以下工程时回退默认标签样式。
 * v9 起名称标签新增背景跟随对象色、背景透明度与文字阴影参数；加载 v8 及以下工程时回退默认阴影样式。
 * v10 起角色对象新增 motion（静态姿势 / 内置 GLB 动作片段）；加载 v9 及以下工程时回退静态姿势。
 * v11 起并入简易模式数据：editorMode（编辑器模式）与 shots（镜头卡列表）随工程持久化，摄像机对象
 * 新增 effectors（效果器列表，一期仅摄像机）；加载 v10 及以下工程时 editorMode 回退为 'pro'、
 * shots 回退为空数组，已有摄像机补空 effectors。
 */

import { normalizeCharacterMotion } from './characterMotion'
import { createDefaultAnimation } from './animationTypes'
import type { StageKeyframe, StageSceneAnimation, StageTrack } from './animationTypes'
import { createDefaultSceneSettings } from './sceneDefaults'
import { normalizeEditorMode, normalizeShots } from './shotTypes'
import type { StageEditorMode, StageShot } from './shotTypes'
import type { StageCameraObject, StageCharacterObject, StageObject, StageSceneSettings, StageVec3 } from './sceneTypes'

/** 当前场景数据版本；结构不兼容变更时递增并补迁移分支 */
export const CAMERA_STAGE_SCENE_SCHEMA_VERSION = 11

export interface StageSceneSnapshot {
  schemaVersion: number
  objects: StageObject[]
  /** 当前取景摄像机（自由/摄像机视角切换用），无摄像机时为 null */
  activeCameraId: string | null
  /** 关键帧动画数据（v2 引入） */
  animation: StageSceneAnimation
  /** 场景级设置（v4 引入） */
  sceneSettings: StageSceneSettings
  /** 编辑器模式（v11 引入）：simple = 镜头卡模式，pro = 现有关键帧模式 */
  editorMode: StageEditorMode
  /** 镜头卡列表（v11 引入），仅 simple 模式使用 */
  shots: StageShot[]
}

export interface StageSceneSnapshotInput {
  objects: StageObject[]
  activeCameraId: string | null
  animation: StageSceneAnimation
  sceneSettings: StageSceneSettings
  editorMode: StageEditorMode
  shots: StageShot[]
}

export function serializeScene(input: StageSceneSnapshotInput): string {
  const snapshot: StageSceneSnapshot = {
    schemaVersion: CAMERA_STAGE_SCENE_SCHEMA_VERSION,
    objects: input.objects,
    activeCameraId: input.activeCameraId,
    animation: input.animation,
    sceneSettings: input.sceneSettings,
    editorMode: input.editorMode,
    shots: input.shots,
  }
  return JSON.stringify(snapshot)
}

/** 宽松解析动画字段：结构缺失/非法时回退为空动画，避免旧数据打不开 */
function parseAnimation(raw: unknown): StageSceneAnimation {
  const fallback = createDefaultAnimation()
  if (!raw || typeof raw !== 'object') return fallback
  const record = raw as Record<string, unknown>
  const tracks = Array.isArray(record.tracks)
    ? (record.tracks as StageSceneAnimation['tracks'])
    : fallback.tracks
  const duration = Number(record.duration)
  const fps = Number(record.fps)
  return {
    tracks,
    duration: Number.isFinite(duration) && duration > 0 ? duration : fallback.duration,
    fps: Number.isFinite(fps) && fps > 0 ? Math.round(fps) : fallback.fps,
  }
}

/** 宽松解析场景设置字段：结构缺失/非法时逐字段回退默认值 */
function parseSceneSettings(raw: unknown): StageSceneSettings {
  const fallback = createDefaultSceneSettings()
  if (!raw || typeof raw !== 'object') return fallback
  const record = raw as Record<string, unknown>
  if ('ground' in record || 'sky' in record || 'sunlight' in record) {
    const groundRecord = record.ground as Record<string, unknown> | undefined
    const skyRecord = record.sky as Record<string, unknown> | undefined
    const sunlightRecord = record.sunlight as Record<string, unknown> | undefined
    const fogRecord = record.fog as Record<string, unknown> | undefined
    const displayRecord = record.display as Record<string, unknown> | undefined
    const nameLabelRecord = displayRecord?.nameLabel as Record<string, unknown> | undefined
    const pattern = groundRecord?.pattern
    const density = Number(groundRecord?.density)
    const gridLineThickness = Number(groundRecord?.gridLineThickness)
    const intensity = Number(sunlightRecord?.intensity)
    const timeOfDay = Number(sunlightRecord?.timeOfDay)
    const fogDistance = Number(fogRecord?.distance)
    const labelScale = Number(nameLabelRecord?.scale)
    const backgroundOpacity = Number(nameLabelRecord?.backgroundOpacity)
    const shadowOpacity = Number(nameLabelRecord?.shadowOpacity)
    const shadowBlur = Number(nameLabelRecord?.shadowBlur)
    const shadowDistance = Number(nameLabelRecord?.shadowDistance)
    const shadowAngle = Number(nameLabelRecord?.shadowAngle)
    const offsetRecord = nameLabelRecord?.offset as Record<string, unknown> | undefined
    const offsetX = Number(offsetRecord?.x)
    const offsetY = Number(offsetRecord?.y)
    const offsetZ = Number(offsetRecord?.z)

    return {
      ground: {
        color: typeof groundRecord?.color === 'string' ? groundRecord.color : fallback.ground.color,
        pattern:
          pattern === 'none' || pattern === 'grid' || pattern === 'checker'
            ? pattern
            : fallback.ground.pattern,
        density:
          Number.isFinite(density) && density >= 1 && density <= 64
            ? density
            : fallback.ground.density,
        gridLineColor:
          typeof groundRecord?.gridLineColor === 'string'
            ? groundRecord.gridLineColor
            : fallback.ground.gridLineColor,
        gridLineThickness:
          Number.isFinite(gridLineThickness) && gridLineThickness >= 0.2 && gridLineThickness <= 3
            ? gridLineThickness
            : fallback.ground.gridLineThickness,
        checkerLightColor:
          typeof groundRecord?.checkerLightColor === 'string'
            ? groundRecord.checkerLightColor
            : fallback.ground.checkerLightColor,
        checkerDarkColor:
          typeof groundRecord?.checkerDarkColor === 'string'
            ? groundRecord.checkerDarkColor
            : fallback.ground.checkerDarkColor,
      },
      sky: {
        color: typeof skyRecord?.color === 'string' ? skyRecord.color : fallback.sky.color,
      },
      sunlight: {
        enabled:
          typeof sunlightRecord?.enabled === 'boolean' ? sunlightRecord.enabled : fallback.sunlight.enabled,
        intensity:
          Number.isFinite(intensity) && intensity >= 0 && intensity <= 3
            ? intensity
            : fallback.sunlight.intensity,
        timeOfDay:
          Number.isFinite(timeOfDay) && timeOfDay >= 0 && timeOfDay <= 24
            ? timeOfDay
            : fallback.sunlight.timeOfDay,
      },
      fog: {
        enabled: typeof fogRecord?.enabled === 'boolean' ? fogRecord.enabled : fallback.fog.enabled,
        distance:
          Number.isFinite(fogDistance) && fogDistance >= 30 && fogDistance <= 200
            ? fogDistance
            : fallback.fog.distance,
      },
      display: {
        showNameLabels:
          typeof displayRecord?.showNameLabels === 'boolean'
            ? displayRecord.showNameLabels
            : fallback.display.showNameLabels,
        nameLabel: {
          textColor:
            typeof nameLabelRecord?.textColor === 'string'
              ? nameLabelRecord.textColor
              : fallback.display.nameLabel.textColor,
          backgroundColor:
            typeof nameLabelRecord?.backgroundColor === 'string'
              ? nameLabelRecord.backgroundColor
              : fallback.display.nameLabel.backgroundColor,
          backgroundOpacity:
            Number.isFinite(backgroundOpacity) && backgroundOpacity >= 0 && backgroundOpacity <= 1
              ? backgroundOpacity
              : fallback.display.nameLabel.backgroundOpacity,
          followObjectColor:
            typeof nameLabelRecord?.followObjectColor === 'boolean'
              ? nameLabelRecord.followObjectColor
              : fallback.display.nameLabel.followObjectColor,
          scale:
            Number.isFinite(labelScale) && labelScale >= 0.5 && labelScale <= 2.5
              ? labelScale
              : fallback.display.nameLabel.scale,
          offset: {
            x:
              Number.isFinite(offsetX) && offsetX >= -3 && offsetX <= 3
                ? offsetX
                : fallback.display.nameLabel.offset.x,
            y:
              Number.isFinite(offsetY) && offsetY >= -3 && offsetY <= 3
                ? offsetY
                : fallback.display.nameLabel.offset.y,
            z:
              Number.isFinite(offsetZ) && offsetZ >= -3 && offsetZ <= 3
                ? offsetZ
                : fallback.display.nameLabel.offset.z,
          },
          shadowColor:
            typeof nameLabelRecord?.shadowColor === 'string'
              ? nameLabelRecord.shadowColor
              : fallback.display.nameLabel.shadowColor,
          shadowOpacity:
            Number.isFinite(shadowOpacity) && shadowOpacity >= 0 && shadowOpacity <= 1
              ? shadowOpacity
              : fallback.display.nameLabel.shadowOpacity,
          shadowBlur:
            Number.isFinite(shadowBlur) && shadowBlur >= 0 && shadowBlur <= 24
              ? shadowBlur
              : fallback.display.nameLabel.shadowBlur,
          shadowDistance:
            Number.isFinite(shadowDistance) && shadowDistance >= 0 && shadowDistance <= 24
              ? shadowDistance
              : fallback.display.nameLabel.shadowDistance,
          shadowAngle:
            Number.isFinite(shadowAngle)
              ? ((shadowAngle % 360) + 360) % 360
              : fallback.display.nameLabel.shadowAngle,
        },
      },
    }
  }

  return {
    ground: {
      color: fallback.ground.color,
      pattern: record.gridVisible === false ? 'none' : 'grid',
      density: fallback.ground.density,
      gridLineColor: fallback.ground.gridLineColor,
      gridLineThickness: fallback.ground.gridLineThickness,
      checkerLightColor: fallback.ground.checkerLightColor,
      checkerDarkColor: fallback.ground.checkerDarkColor,
    },
    sky: {
      color: typeof record.backgroundColor === 'string' ? record.backgroundColor : fallback.sky.color,
    },
    sunlight: fallback.sunlight,
    fog: fallback.fog,
    display: fallback.display,
  }
}

/** v4→v5：给缺少 aspectRatio 的摄像机对象补默认 16:9，非摄像机对象原样保留 */
function withDefaultCameraAspectRatio(objects: StageObject[]): StageObject[] {
  return objects.map((object) => {
    if (object.type !== 'camera') return object
    const camera = object as StageCameraObject & { aspectRatio?: StageCameraObject['aspectRatio'] }
    if (camera.aspectRatio) return object
    return { ...camera, aspectRatio: { preset: '16:9', ratio: 16 / 9 } }
  })
}

/** v9→v10：给角色对象补 motion，并顺手规范非法动作字段 */
function withNormalizedCharacterMotion(objects: StageObject[]): StageObject[] {
  return objects.map((object) => {
    if (object.type !== 'character') return object
    const character = object as StageCharacterObject & { motion?: unknown }
    return { ...character, motion: normalizeCharacterMotion(character.motion) }
  })
}

/** v10→v11：给摄像机对象补 effectors，非法/缺失时回退空数组 */
function withDefaultCameraEffectors(objects: StageObject[]): StageObject[] {
  return objects.map((object) => {
    if (object.type !== 'camera') return object
    const camera = object as StageCameraObject & { effectors?: unknown }
    return { ...camera, effectors: Array.isArray(camera.effectors) ? camera.effectors : [] }
  })
}

/** v2→v3：把整体 Vec3 值的轨道拆成 X/Y/Z 三条分量 scalar 轨道；非 Vec3 轨道原样保留 */
function splitVec3Track(track: StageTrack): StageTrack[] {
  const first = track.keyframes[0]?.value
  const isVec3 = !!first && typeof first === 'object' && 'x' in (first as StageVec3)
  if (!isVec3) return [track]
  return (['x', 'y', 'z'] as const).map((axis) => ({
    objectId: track.objectId,
    propertyPath: `${track.propertyPath}.${axis}`,
    keyframes: track.keyframes.map(
      (kf): StageKeyframe => ({ time: kf.time, value: (kf.value as StageVec3)[axis], easing: kf.easing }),
    ),
  }))
}

export function deserializeScene(sceneJson: string): StageSceneSnapshot {
  let parsed: unknown
  try {
    parsed = JSON.parse(sceneJson)
  } catch (error) {
    throw new Error(`[cameraStage] 场景数据不是合法 JSON：${(error as Error).message}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('[cameraStage] 场景数据结构无效')
  }

  const record = parsed as Record<string, unknown>
  const version = Number(record.schemaVersion)
  if (!Number.isFinite(version) || version < 1) {
    throw new Error('[cameraStage] 场景数据缺少有效的 schemaVersion')
  }
  if (version > CAMERA_STAGE_SCENE_SCHEMA_VERSION) {
    throw new Error(
      `[cameraStage] 场景数据版本 ${version} 高于当前支持的 ${CAMERA_STAGE_SCENE_SCHEMA_VERSION}，请升级应用后再打开`,
    )
  }

  let objects = Array.isArray(record.objects) ? (record.objects as StageObject[]) : []
  // v4 及以下工程的摄像机对象无 aspectRatio 字段 → 补默认 16:9
  if (version < 5) {
    objects = withDefaultCameraAspectRatio(objects)
  }
  objects = withNormalizedCharacterMotion(objects)
  // v10 及以下工程的摄像机对象无 effectors 字段 → 补空数组；同时顺手规范非法数据
  objects = withDefaultCameraEffectors(objects)
  const activeCameraId = typeof record.activeCameraId === 'string' ? record.activeCameraId : null
  // v1 工程无 animation 字段 → 视为无动画；v2+ 解析已有动画；v2 的整体 Vec3 轨道拆成分量轨道
  let animation = version >= 2 ? parseAnimation(record.animation) : createDefaultAnimation()
  if (version < 3 && animation.tracks.length > 0) {
    animation = { ...animation, tracks: animation.tracks.flatMap(splitVec3Track) }
  }
  // v3 及以下工程无 sceneSettings 字段 → 视为默认设置；v4/v5 的旧结构在 parseSceneSettings 中迁移
  const sceneSettings = version >= 4 ? parseSceneSettings(record.sceneSettings) : createDefaultSceneSettings()
  // v10 及以下工程无 editorMode/shots 字段 → 一律视为专业工程、无镜头卡
  const editorMode = version >= 11 ? normalizeEditorMode(record.editorMode) : 'pro'
  const shots = version >= 11 ? normalizeShots(record.shots) : []

  return {
    schemaVersion: CAMERA_STAGE_SCENE_SCHEMA_VERSION,
    objects,
    activeCameraId,
    animation,
    sceneSettings,
    editorMode,
    shots,
  }
}
