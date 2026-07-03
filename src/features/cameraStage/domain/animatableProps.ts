/**
 * 可动画属性注册表（纯数据，禁止 UI/渲染依赖）。
 *
 * 集中声明「哪些属性路径可打关键帧、值类型、取值/写值函数」，供采样应用、码表按钮、
 * 轨道树共用，禁止在各处散落 propertyPath 判断。属性以「Vec3 逐属性行」为粒度
 * （对齐属性面板每行一个码表：位置/旋转/缩放各一行，姿态每关节一行）。
 */

import { POSE_JOINT_GROUPS } from './poseTypes'
import type { StagePoseJointId } from './poseTypes'
import type { StageAnimatableValueType, StageKeyframeValue } from './animationTypes'
import type { StageObject, StageVec3 } from './sceneTypes'

export interface AnimatablePropDescriptor {
  /** 稳定属性路径，作为轨道主键的一部分 */
  path: string
  /** 中文标签（时间轴轨道树、属性面板复用） */
  label: string
  valueType: StageAnimatableValueType
  /** 该对象是否支持此属性（如 fov 仅相机、pose 仅角色） */
  isAvailable: (object: StageObject) => boolean
  /** 读取对象当前值 */
  getValue: (object: StageObject) => StageKeyframeValue
  /** 以采样值返回更新后的对象（纯函数，供 scrub/暂停时落回 store） */
  applyToObject: (object: StageObject, value: StageKeyframeValue) => StageObject
}

const ZERO_VEC3: StageVec3 = { x: 0, y: 0, z: 0 }

function asVec3(value: StageKeyframeValue): StageVec3 {
  return value as StageVec3
}

const POSE_JOINT_PATH_PREFIX = 'pose.joints.'

/** 关节路径 → 关节 id；非关节路径返回 undefined */
export function parsePoseJointPath(path: string): StagePoseJointId | undefined {
  if (!path.startsWith(POSE_JOINT_PATH_PREFIX)) return undefined
  return path.slice(POSE_JOINT_PATH_PREFIX.length) as StagePoseJointId
}

export function poseJointPath(jointId: StagePoseJointId): string {
  return `${POSE_JOINT_PATH_PREFIX}${jointId}`
}

/** 关节 id → 中文标签（组名 + 关节名，如「左臂·肘」） */
const POSE_JOINT_LABELS: Partial<Record<StagePoseJointId, string>> = (() => {
  const map: Partial<Record<StagePoseJointId, string>> = {}
  for (const group of POSE_JOINT_GROUPS) {
    for (const joint of group.joints) {
      map[joint.id] = group.joints.length > 1 ? `${group.name}·${joint.name}` : group.name
    }
  }
  return map
})()

/** 三个变换属性（位置/旋转/缩放）以 Vec3 逐行为粒度 */
const TRANSFORM_DESCRIPTORS: AnimatablePropDescriptor[] = [
  {
    path: 'transform.position',
    label: '位置',
    valueType: 'vec3',
    isAvailable: () => true,
    getValue: (object) => object.transform.position,
    applyToObject: (object, value) => ({
      ...object,
      transform: { ...object.transform, position: asVec3(value) },
    }),
  },
  {
    path: 'transform.rotation',
    label: '旋转',
    valueType: 'vec3',
    // 相机朝向由注视目标决定，不开放旋转动画
    isAvailable: (object) => object.type !== 'camera',
    getValue: (object) => object.transform.rotation,
    applyToObject: (object, value) => ({
      ...object,
      transform: { ...object.transform, rotation: asVec3(value) },
    }),
  },
  {
    path: 'transform.scale',
    label: '缩放',
    valueType: 'vec3',
    isAvailable: (object) => object.type !== 'camera',
    getValue: (object) => object.transform.scale,
    applyToObject: (object, value) => ({
      ...object,
      transform: { ...object.transform, scale: asVec3(value) },
    }),
  },
]

const COLOR_DESCRIPTOR: AnimatablePropDescriptor = {
  path: 'color',
  label: '颜色',
  valueType: 'color',
  isAvailable: () => true,
  getValue: (object) => object.color,
  applyToObject: (object, value) => ({ ...object, color: value as string }),
}

const FOV_DESCRIPTOR: AnimatablePropDescriptor = {
  path: 'fov',
  label: '视野角',
  valueType: 'scalar',
  isAvailable: (object) => object.type === 'camera',
  getValue: (object) => (object.type === 'camera' ? object.fov : 0),
  applyToObject: (object, value) =>
    object.type === 'camera' ? { ...object, fov: value as number } : object,
}

function poseJointDescriptor(jointId: StagePoseJointId): AnimatablePropDescriptor {
  return {
    path: poseJointPath(jointId),
    label: `姿态·${POSE_JOINT_LABELS[jointId] ?? jointId}`,
    valueType: 'vec3',
    isAvailable: (object) => object.type === 'character',
    getValue: (object) =>
      object.type === 'character' ? object.pose.joints[jointId] ?? ZERO_VEC3 : ZERO_VEC3,
    applyToObject: (object, value) =>
      object.type === 'character'
        ? {
            ...object,
            pose: {
              ...object.pose,
              joints: { ...object.pose.joints, [jointId]: asVec3(value) },
            },
          }
        : object,
  }
}

/** 全部关节描述子（按分组顺序） */
const POSE_JOINT_DESCRIPTORS: AnimatablePropDescriptor[] = POSE_JOINT_GROUPS.flatMap((group) =>
  group.joints.map((joint) => poseJointDescriptor(joint.id)),
)

/** 全部静态描述子（不含按对象过滤，仅用于按路径解析） */
const ALL_DESCRIPTORS: AnimatablePropDescriptor[] = [
  ...TRANSFORM_DESCRIPTORS,
  COLOR_DESCRIPTOR,
  FOV_DESCRIPTOR,
  ...POSE_JOINT_DESCRIPTORS,
]

const DESCRIPTOR_BY_PATH = new Map(ALL_DESCRIPTORS.map((d) => [d.path, d]))

/** 按路径解析描述子（与对象无关，用于采样应用/求值） */
export function getAnimatablePropByPath(path: string): AnimatablePropDescriptor | undefined {
  return DESCRIPTOR_BY_PATH.get(path)
}

/** 列出某对象可打关键帧的全部属性（属性面板码表按钮、轨道树消费） */
export function listAnimatableProps(object: StageObject): AnimatablePropDescriptor[] {
  return ALL_DESCRIPTORS.filter((descriptor) => descriptor.isAvailable(object))
}
