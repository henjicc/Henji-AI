/**
 * 运镜控制场景核心数据模型（纯数据定义，禁止引入 UI/渲染依赖）。
 *
 * 场景 = 对象列表；对象分三类：几何体（primitive）、角色（character，2.2 扩展姿态字段）、
 * 机位相机（camera，2.3 扩展取景字段）。旋转统一用角度制存储（UI 友好），
 * 渲染层负责与 three.js 的弧度制互转。
 */

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

/** 角色对象：2.1 阶段仅占位渲染，体型/姿态字段由 2.2 扩展 */
export interface StageCharacterObject extends StageObjectBase {
  type: 'character'
}

/** 机位相机对象：2.1 阶段仅占位渲染，取景/注视目标字段由 2.3 扩展 */
export interface StageCameraObject extends StageObjectBase {
  type: 'camera'
  /** 视野角（度） */
  fov: number
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
}

export type StageGizmoMode = 'translate' | 'rotate' | 'scale'
