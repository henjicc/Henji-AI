/**
 * 3D 镜头参考场景的序列化 / 反序列化（工程持久化用）。
 *
 * 开发阶段只接受当前 schema。旧记录可以继续留在数据库中，但不会进入工程列表、反射枚举、
 * 编辑器、复制或渲染链路；这里不再承担旧模式迁移，避免历史第二真相源污染当前模型。
 */

import { normalizeCharacterMotion } from './characterMotion'
import { normalizeStageRenderStyle } from './renderStyles'
import type { StageSceneAnimation } from './animationTypes'
import { createDefaultSceneSettings } from './sceneDefaults'
import { rotationFromPositionAndTarget } from './cameraUtils'
import { normalizeStateKeyframes } from './stateKeyframeTypes'
import type { StageStateKeyframe } from './stateKeyframeTypes'
import { compileStateKeyframesToAnimation } from './stateKeyframeCompiler'
import type { StageCameraObject, StageCharacterObject, StageObject, StageSceneSettings } from './sceneTypes'

/** 当前场景数据版本；结构不兼容变更时递增并补迁移分支 */
export const CAMERA_STAGE_SCENE_SCHEMA_VERSION = 13

export const UNSUPPORTED_CAMERA_STAGE_SCHEMA = 'UNSUPPORTED_CAMERA_STAGE_SCHEMA'

export interface StageSceneSnapshotInput {
  objects: StageObject[]
  /** 当前取景摄像机（自由/摄像机视角切换用），无摄像机时为 null */
  activeCameraId: string | null
  /** 场景级设置（v4 引入） */
  sceneSettings: StageSceneSettings
  /** 唯一可编辑时间轴真相源。 */
  stateKeyframes: StageStateKeyframe[]
}

export interface StageSceneSnapshot extends StageSceneSnapshotInput {
  schemaVersion: number
  /** 由状态关键帧即时编译，只存在于运行态。 */
  animation: StageSceneAnimation
}

export type StageSceneRuntimeSnapshot = Omit<StageSceneSnapshot, 'schemaVersion'>

export function serializeScene(input: StageSceneSnapshotInput): string {
  const snapshot = {
    schemaVersion: CAMERA_STAGE_SCENE_SCHEMA_VERSION,
    objects: input.objects,
    activeCameraId: input.activeCameraId,
    sceneSettings: input.sceneSettings,
    stateKeyframes: input.stateKeyframes,
  }
  return JSON.stringify(snapshot)
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
    const renderRecord = record.render as Record<string, unknown> | undefined
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
      render: {
        style: normalizeStageRenderStyle(renderRecord?.style),
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

  return fallback
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

/** 统一旧工程摄像机的手动注视点与 XYZ 旋转；Z 轴 roll 无法由 lookAt 推导，因此原样保留。 */
function withNormalizedCameraRotations(objects: StageObject[]): StageObject[] {
  return objects.map((object) => {
    if (object.type !== 'camera' || object.lookAt.mode !== 'manual') return object
    return {
      ...object,
      transform: {
        ...object.transform,
        rotation: rotationFromPositionAndTarget(
          object.transform.position,
          object.lookAt.target,
          object.transform.rotation.z,
        ),
      },
    }
  })
}

export function isCurrentCameraStageScene(sceneJson: string): boolean {
  try {
    const parsed = JSON.parse(sceneJson) as Record<string, unknown> | null
    return parsed !== null && Number(parsed.schemaVersion) === CAMERA_STAGE_SCENE_SCHEMA_VERSION
  } catch {
    return false
  }
}

/** 只读取当前 schema；派生动画始终从状态关键帧重新编译。 */
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
  if (version !== CAMERA_STAGE_SCENE_SCHEMA_VERSION) {
    throw new Error(`${UNSUPPORTED_CAMERA_STAGE_SCHEMA}:${version}`)
  }

  let objects = Array.isArray(record.objects) ? (record.objects as StageObject[]) : []
  objects = withNormalizedCharacterMotion(objects)
  objects = withDefaultCameraEffectors(objects)
  objects = withNormalizedCameraRotations(objects)
  const activeCameraId = typeof record.activeCameraId === 'string' ? record.activeCameraId : null
  const sceneSettings = parseSceneSettings(record.sceneSettings)
  const stateKeyframes = normalizeStateKeyframes(record.stateKeyframes)
  const animation = compileStateKeyframesToAnimation(stateKeyframes, objects)

  return {
    schemaVersion: CAMERA_STAGE_SCENE_SCHEMA_VERSION,
    objects,
    activeCameraId,
    animation,
    sceneSettings,
    stateKeyframes,
  }
}
