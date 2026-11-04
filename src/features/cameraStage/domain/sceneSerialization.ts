/**
 * 3D 镜头参考场景与文档内容（`.hjstg` 文件的 content）之间的转换：`sceneToDocumentContent` / `sceneFromDocumentContent`。
 * 格式版本由文档外壳的 kindVersion 表达；读取时逐字段规范化（`normalizeSceneRecord`），派生动画始终从状态关键帧重新编译。
 */

import { normalizeCharacterMotion } from './characterMotion'
import { normalizeStageRenderStyle } from './renderStyles'
import type { StageSceneAnimation } from './animationTypes'
import { createDefaultSceneSettings, STAGE_FOG_DISTANCE_RANGE } from './sceneDefaults'
import { rotationFromPositionAndTarget } from './cameraUtils'
import { isStageCameraRig, STAGE_CAMERA_AIM_LAG_MAX } from './cameraRigs'
import { normalizeStateKeyframes } from './stateKeyframeTypes'
import type { StageStateKeyframe } from './stateKeyframeTypes'
import { compileStateKeyframesToAnimation } from './stateKeyframeCompiler'
import type { StageCameraObject, StageCharacterObject, StageObject, StageSceneSettings, StageSet } from './sceneTypes'
import { liveStageSets } from './stageSets'
import { normalizeCameraCuts, type StageCameraCut } from './renderCameraSchedule'
import { liveCoverages, normalizeCoverages, type StageCoverage } from './coverage'

export interface StageSceneSnapshotInput {
  objects: StageObject[]
  /** 当前取景摄像机（自由/摄像机视角切换用），无摄像机时为 null */
  activeCameraId: string | null
  /** 场景级设置（v4 引入） */
  sceneSettings: StageSceneSettings
  /** 唯一可编辑时间轴真相源。 */
  stateKeyframes: StageStateKeyframe[]
  /** 生成过的布景（文档格式 v2 引入）；成员对象在 objects 里用 setId 指回。省略等于没有布景。 */
  sets?: StageSet[]
  /** 机位切换点（文档格式 v8 引入），按时间排好；省略等于没有切机位。 */
  cameraCuts?: StageCameraCut[]
  /** 多机位覆盖（文档格式 v8 引入）。 */
  coverages?: StageCoverage[]
}

export interface StageSceneRuntimeSnapshot extends StageSceneSnapshotInput {
  /** 由状态关键帧即时编译，只存在于运行态。 */
  animation: StageSceneAnimation
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
        environmentImageUrl:
          typeof skyRecord?.environmentImageUrl === 'string' && skyRecord.environmentImageUrl.trim()
            ? skyRecord.environmentImageUrl
            : null,
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
          Number.isFinite(fogDistance) && fogDistance >= STAGE_FOG_DISTANCE_RANGE.min && fogDistance <= STAGE_FOG_DISTANCE_RANGE.max
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

/** 运镜设备与注视跟随滞后（镜头参考 v6 起）：不认识的设备或非法滞后值去掉，回到“不模拟设备、取设备默认滞后”。 */
function withNormalizedCameraRig(objects: StageObject[]): StageObject[] {
  return objects.map((object) => {
    if (object.type !== 'camera') return object
    const { rig, aimLag, ...rest } = object as StageCameraObject & { rig?: unknown; aimLag?: unknown }
    const normalized: StageCameraObject = { ...rest }
    if (isStageCameraRig(rig)) normalized.rig = rig
    if (typeof aimLag === 'number' && Number.isFinite(aimLag) && aimLag >= 0 && aimLag <= STAGE_CAMERA_AIM_LAG_MAX) normalized.aimLag = aimLag
    return normalized
  })
}

/** 统一旧镜头参考摄像机的手动注视点与 XYZ 旋转；Z 轴 roll 无法由 lookAt 推导，因此原样保留。 */
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

/** 文档里存的场景内容：持久字段，不含版本号（由文档外壳的 kindVersion 表达）与派生动画。 */
export type CameraStageSceneContent = StageSceneSnapshotInput

export function sceneToDocumentContent(input: StageSceneSnapshotInput): CameraStageSceneContent {
  return {
    objects: input.objects,
    activeCameraId: input.activeCameraId,
    sceneSettings: input.sceneSettings,
    stateKeyframes: input.stateKeyframes,
    // 成员被逐个删光的布景不写进文件。
    sets: liveStageSets(input.sets ?? [], input.objects),
    cameraCuts: liveCameraCuts(input.cameraCuts ?? [], input.objects),
    coverages: liveCoverages(input.coverages ?? [], input.objects),
  }
}

/** 摄像机被删掉的切换点不再生效，也不写进文件。 */
export function liveCameraCuts(cuts: readonly StageCameraCut[], objects: readonly StageObject[]): StageCameraCut[] {
  const cameras = new Set(objects.filter((object) => object.type === 'camera').map((object) => object.id))
  return cuts.filter((cut) => cut.cameraId === null || cameras.has(cut.cameraId))
}

/** 文档内容 → 运行时快照：与旧镜头参考数据相同的逐字段规范化，非法字段回退默认值。 */
export function sceneFromDocumentContent(content: unknown): StageSceneRuntimeSnapshot {
  if (!content || typeof content !== 'object') throw new Error('[cameraStage] 场景数据结构无效')
  const { objects, activeCameraId, animation, sceneSettings, stateKeyframes, sets, cameraCuts, coverages } = normalizeSceneRecord(content as Record<string, unknown>)
  return { objects, activeCameraId, animation, sceneSettings, stateKeyframes, sets, cameraCuts, coverages }
}

/** 场景是否完全空白（新建文档的空内容）：工具打开时补上默认摄像机与第一张状态关键帧。 */
export function isBlankSceneContent(snapshot: StageSceneSnapshotInput): boolean {
  return snapshot.objects.length === 0 && snapshot.stateKeyframes.length === 0
}

/**
 * 布景记录：结构不对的整条丢掉。类型不认识的（更新版本新增的布景类型）原样保留，保存时不丢。
 * 记录被丢掉的成员去掉 setId，回到普通对象，不会从观察和列表里消失。
 */
function normalizeStageSets(raw: unknown, objects: StageObject[]): { sets: StageSet[]; objects: StageObject[] } {
  const sets = Array.isArray(raw) ? raw.filter((item): item is StageSet => {
    if (!item || typeof item !== 'object') return false
    const record = item as Record<string, unknown>
    const params = record.params as Record<string, unknown> | undefined
    return typeof record.id === 'string' && typeof record.name === 'string'
      && !!params && typeof params === 'object' && typeof params.preset === 'string' && params.preset.length > 0
  }) : []
  const known = new Set(sets.map((set) => set.id))
  if (!objects.some((object) => object.setId !== undefined && !known.has(object.setId))) return { sets, objects }
  return {
    sets,
    objects: objects.map((object) => {
      if (object.setId === undefined || known.has(object.setId)) return object
      const { setId: _orphan, ...rest } = object
      return rest as StageObject
    }),
  }
}

function normalizeSceneRecord(record: Record<string, unknown>): StageSceneRuntimeSnapshot {
  let objects = Array.isArray(record.objects) ? (record.objects as StageObject[]) : []
  const normalizedSets = normalizeStageSets(record.sets, objects)
  const sets = normalizedSets.sets
  objects = normalizedSets.objects
  objects = withNormalizedCharacterMotion(objects)
  objects = withDefaultCameraEffectors(objects)
  objects = withNormalizedCameraRig(objects)
  objects = withNormalizedCameraRotations(objects)
  const activeCameraId = typeof record.activeCameraId === 'string' ? record.activeCameraId : null
  const sceneSettings = parseSceneSettings(record.sceneSettings)
  const stateKeyframes = normalizeStateKeyframes(record.stateKeyframes)
  const animation = compileStateKeyframesToAnimation(stateKeyframes, objects)

  return {
    objects,
    activeCameraId,
    animation,
    sceneSettings,
    stateKeyframes,
    sets,
    cameraCuts: liveCameraCuts(normalizeCameraCuts(record.cameraCuts), objects),
    coverages: liveCoverages(normalizeCoverages(record.coverages), objects),
  }
}
