/**
 * 运镜控制场景核心数据模型（纯数据定义，禁止引入 UI/渲染依赖）。
 *
 * 场景 = 对象列表；对象分三类：几何体（primitive）、角色（character，含体型/姿态）、
 * 机位相机（camera，2.3 扩展取景字段）。旋转统一用角度制存储（UI 友好），
 * 渲染层负责与 three.js 的弧度制互转。
 */

import type { StageBodyVariantId } from './bodyVariants'
import type { StageCharacterPose } from './poseTypes'

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
}

/** 机位相机对象：2.1 阶段仅占位渲染，取景/注视目标字段由 2.3 扩展 */
export interface StageCameraObject extends StageObjectBase {
  type: 'camera'
  /** 视野角（度） */
  fov: number
  /** 机位实际取景朝向：手动坐标或锁定角色对象 */
  lookAt: StageCameraLookAt
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
  /** 仅 character 对象有效 */
  variant?: StageBodyVariantId
  /** 仅 character 对象有效 */
  pose?: StageCharacterPose
}

export type StageGizmoMode = 'translate' | 'rotate' | 'scale'
export type StageViewMode = 'director' | 'camera'
