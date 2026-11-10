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
import type { StageRenderStyle } from './renderStyles'
import type { StageCameraEffector } from './stateKeyframeTypes'
import type { CameraStageSetParams } from '@/core/application-control/domains/cameraStage/cameraStageSetSchemas'

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
  /** 由哪片布景生成；成员是普通对象，可以逐个修改，重新生成或删除布景时整体替换。 */
  setId?: string
}

/** 一片布景：生成参数（已补齐默认值）。成员对象通过 setId 指回它，没有成员的布景视为已不存在。 */
export interface StageSet {
  id: string
  name: string
  params: CameraStageSetParams
  /** 生成时一并算好的地面铺装与比例参照物；关掉参照物或旧版本生成的布景没有。 */
  decor?: StageSetDecor
}

export const STAGE_SET_SURFACE_KINDS = ['road', 'sidewalk', 'curb', 'median', 'lawn', 'plaza'] as const
export type StageSetSurfaceKind = typeof STAGE_SET_SURFACE_KINDS[number]
export const STAGE_SET_MARKING_KINDS = ['laneDashed', 'edgeLine', 'centerLine', 'stopLine', 'crosswalk'] as const
export type StageSetMarkingKind = typeof STAGE_SET_MARKING_KINDS[number]

/** 任意形状的铺装：自然路网的人行道铺装、中央分隔带、草地与水面。 */
export const STAGE_SET_AREA_KINDS = ['sidewalk', 'median', 'lawn', 'water'] as const
export type StageSetAreaKind = typeof STAGE_SET_AREA_KINDS[number]

/** 布景装饰数组每一项占几个数。 */
export const STAGE_SET_DECOR_STRIDE = { surface: 4, marking: 4, tree: 5, lamp: 4, vehicle: 5 } as const

/** 车道虚线的节奏（米）：每 period 一段、画 on 长。弯路上逐段写出，渲染按同一节奏丢片元。 */
export const LANE_DASH = { period: 9, on: 3 } as const

/**
 * 布景的地面铺装与比例参照物。不是场景对象：不能点选、不参与碰撞，成千上万个也只占几次绘制；
 * 生成时算好存下来，以后改了生成算法，已有文件的画面也不变。坐标是布景局部坐标（米，绕布景中心与朝向）。
 */
export interface StageSetDecor {
  /** 每项 [中心 x, 中心 z, x 向宽, z 向深] */
  surfaces: Record<StageSetSurfaceKind, number[]>
  /** 每项 [起点 x, 起点 z, 终点 x, 终点 z]；线宽与虚线节奏按种类固定 */
  markings: Record<StageSetMarkingKind, number[]>
  /** 行道树，每项 [x, z, 朝向（度）, 缩放, 树种序号] */
  trees: number[]
  /** 路灯，每项 [x, z, 灯臂朝向（度）, 杆高（米）] */
  lamps: number[]
  /** 车辆，每项 [x, z, 车头朝向（度）, 车型序号, 颜色序号] */
  vehicles: number[]
  /**
   * 任意形状的铺装（v5 起，只有自然路网有）。每块依次写 [圈数, 第一圈点数, x, z, x, z…, 第二圈点数, …]，
   * 第一圈是外轮廓，其余是洞；路缘沿人行道铺装的每条边生成。
   */
  areas?: Record<StageSetAreaKind, number[]>
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
  /** 运镜设备：决定运动上限、惯性手感与自带晃动；缺省 = 不模拟设备。 */
  rig?: StageCameraRig
  /** 注视跟随滞后（秒，匀速摇镜时镜头晚多久）；缺省取设备默认，0 = 不滞后。 */
  aimLag?: number
}

export type StageCameraRig = 'free' | 'dolly' | 'crane' | 'steadicam' | 'drone' | 'handheld'

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
  /** 仅 camera 对象有效 */
  rig?: StageCameraRig
  /** 仅 camera 对象有效 */
  aimLag?: number
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

interface StageSkySettings {
  color: string
  environmentImageUrl: string | null
}

interface StageSunlightSettings {
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

/** 最终渲染设置：摄像机画面与导出成片共用的成像方式 */
interface StageRenderSettings {
  style: StageRenderStyle
}

interface StageDisplaySettings {
  showNameLabels: boolean
  nameLabel: StageNameLabelSettings
}

/** 场景级设置（未选中对象时的属性面板展示，随镜头参考持久化） */
export interface StageSceneSettings {
  ground: StageGroundSettings
  sky: StageSkySettings
  sunlight: StageSunlightSettings
  fog: StageFogSettings
  display: StageDisplaySettings
  render: StageRenderSettings
}
