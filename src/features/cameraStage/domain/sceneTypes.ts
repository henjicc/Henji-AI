/**
 * 3D 镜头参考场景核心数据模型（纯数据定义，禁止引入 UI/渲染依赖）。
 *
 * 场景 = 对象列表；对象分三类：几何体（primitive）、角色（character，含体型/姿态）、
 * 摄像机（camera，2.3 扩展取景字段）。旋转统一用角度制存储（UI 友好），
 * 渲染层负责与 three.js 的弧度制互转。
 */

import type { StageBodyVariantId } from './bodyVariants'
import type { StageCharacterMotion } from './characterMotion'
import type { StageCharacterPose } from './poseTypes'
import type { StageCameraEffector } from './stateKeyframeTypes'

export interface StageVec3 {
  x: number
  y: number
  z: number
}

export interface StageTransform {
  position: StageVec3
  /** 欧拉角，角度制 */
  rotation: StageVec3
  scale: StageVec3
}

export type StagePrimitiveKind = 'box' | 'sphere' | 'cylinder' | 'cone' | 'pyramid' | 'torus'

export type StageObjectType = 'primitive' | 'character' | 'camera'

export type StageCameraLookAt =
  | { mode: 'manual'; target: StageVec3 }
  | { mode: 'object'; objectId: string; fallbackTarget: StageVec3 }

export type StageCameraAspectRatioPreset = '16:9' | '4:3' | '1:1' | '9:16' | 'custom'

/** 摄像机画幅比例：preset 供 UI 回显选中项，ratio 是宽/高的解析结果，渲染层只需要 ratio */
export interface StageCameraAspectRatio {
  preset: StageCameraAspectRatioPreset
  ratio: number
}

interface StageObjectBase {
  id: string
  type: StageObjectType
  name: string
  transform: StageTransform
  /** 纯色材质颜色（hex），符合一期"纯色渲染"美术方向 */
  color: string
  visible: boolean
}

export interface StagePrimitiveObject extends StageObjectBase {
  type: 'primitive'
  kind: StagePrimitiveKind
}

/** 角色对象：内置骨骼模型渲染，姿态为 FK 逐关节欧拉偏移，体型为同骨架比例变体 */
export interface StageCharacterObject extends StageObjectBase {
  type: 'character'
  variant: StageBodyVariantId
  pose: StageCharacterPose
  motion: StageCharacterMotion
}

/** 摄像机对象：2.1 阶段仅占位渲染，取景/注视目标字段由 2.3 扩展 */
export interface StageCameraObject extends StageObjectBase {
  type: 'camera'
  /** 视野角（度） */
  fov: number
  /** 摄像机实际取景朝向：手动坐标或锁定任意场景对象 */
  lookAt: StageCameraLookAt
  /** 画幅比例（宽/高），驱动取景框线框与摄像机视角压暗遮罩 */
  aspectRatio: StageCameraAspectRatio
  /** 挂载的效果器（手持晃动等），采样层按 time 纯函数叠加，不产生关键帧（3.1 实装） */
  effectors: StageCameraEffector[]
}

export type StageObject = StagePrimitiveObject | StageCharacterObject | StageCameraObject

/** 对象通用可编辑字段补丁（含各类型专属字段的可选并集，写入时不改变对象类型） */
export interface StageObjectPatch {
  name?: string
  color?: string
  visible?: boolean
  transform?: StageTransform
  /** 仅 camera 对象有效 */
  fov?: number
  /** 仅 camera 对象有效 */
  lookAt?: StageCameraLookAt
  /** 仅 camera 对象有效 */
  aspectRatio?: StageCameraAspectRatio
  /** 仅 character 对象有效 */
  variant?: StageBodyVariantId
  /** 仅 character 对象有效 */
  pose?: StageCharacterPose
  /** 仅 character 对象有效 */
  motion?: StageCharacterMotion
  /** 仅 camera 对象有效 */
  effectors?: StageCameraEffector[]
}

export type StageGizmoMode = 'translate' | 'rotate' | 'scale'
export type StageViewMode = 'director' | 'camera'
export type StageGroundPattern = 'none' | 'grid' | 'checker'

export interface StageGroundSettings {
  color: string
  pattern: StageGroundPattern
  density: number
  gridLineColor: string
  gridLineThickness: number
  checkerLightColor: string
  checkerDarkColor: string
}

export interface StageSkySettings {
  color: string
}

export interface StageSunlightSettings {
  enabled: boolean
  intensity: number
  timeOfDay: number
}

export interface StageFogSettings {
  enabled: boolean
  distance: number
}

export interface StageNameLabelSettings {
  textColor: string
  backgroundColor: string
  backgroundOpacity: number
  followObjectColor: boolean
  scale: number
  offset: StageVec3
  shadowColor: string
  shadowOpacity: number
  shadowBlur: number
  shadowDistance: number
  shadowAngle: number
}

export interface StageDisplaySettings {
  showNameLabels: boolean
  nameLabel: StageNameLabelSettings
}

/** 场景级设置（未选中对象时的属性面板展示，随工程持久化） */
export interface StageSceneSettings {
  ground: StageGroundSettings
  sky: StageSkySettings
  sunlight: StageSunlightSettings
  fog: StageFogSettings
  display: StageDisplaySettings
}
