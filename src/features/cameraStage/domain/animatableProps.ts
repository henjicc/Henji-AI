/**
 * 可动画属性注册表（纯数据，禁止 UI/渲染依赖）。
 *
 * 粒度分两层：
 * - 轨道层（scalar/color 描述子）：每个可打关键帧的最小单元一条轨道，位置/旋转/缩放/关节
 *   各拆成 X/Y/Z 三条 scalar 轨道，颜色一条 color 轨道，FOV 一条 scalar 轨道。轨道层供
 *   store 打点、scrub 落回对象、时间轴子轨道消费。
 * - 分组层（AnimatableGroup）：把同一属性的分量聚合成一个可展开分组（如「位置」含 X/Y/Z），
 *   供属性面板/时间轴父行、码表整体打点、播放驱动按组聚合采样共用。
 */

import { POSE_JOINT_GROUPS } from './poseTypes'
import type { StagePoseJointId } from './poseTypes'
import type { StageAnimatableValueType, StageKeyframeValue } from './animationTypes'
import type { StageObject, StageVec3 } from './sceneTypes'

type Vec3Axis = 'x' | 'y' | 'z'
const VEC3_AXES: Vec3Axis[] = ['x', 'y', 'z']
const ZERO_VEC3: StageVec3 = { x: 0, y: 0, z: 0 }

/** 轨道层描述子：一条可打关键帧轨道的取值/写值 */
export interface AnimatablePropDescriptor {
  path: string
  /** 分量轨道的中文/轴标签（时间轴子轨道显示） */
  label: string
  valueType: StageAnimatableValueType
  /** vec3 分量轨道所属轴；scalar/color 轨道为 undefined */
  axis?: Vec3Axis
  isAvailable: (object: StageObject) => boolean
  getValue: (object: StageObject) => StageKeyframeValue
  applyToObject: (object: StageObject, value: StageKeyframeValue) => StageObject
}

/** 分组层：可展开属性（vec3 含 3 分量子轨道；scalar/color 只有 1 条） */
export interface AnimatableGroup {
  groupPath: string
  label: string
  valueType: StageAnimatableValueType
  children: AnimatablePropDescriptor[]
  isAvailable: (object: StageObject) => boolean
  /** 当前基准值（vec3 用于播放期填充未打帧的分量） */
  getBaseValue: (object: StageObject) => StageKeyframeValue
}

const POSE_JOINT_PATH_PREFIX = 'pose.joints.'

export function poseJointPath(jointId: StagePoseJointId): string {
  return `${POSE_JOINT_PATH_PREFIX}${jointId}`
}

/** 关节 id → 中文标签（分组名 + 关节名） */
const POSE_JOINT_LABELS: Partial<Record<StagePoseJointId, string>> = (() => {
  const map: Partial<Record<StagePoseJointId, string>> = {}
  for (const group of POSE_JOINT_GROUPS) {
    for (const joint of group.joints) {
      map[joint.id] = group.joints.length > 1 ? `${group.name}·${joint.name}` : group.name
    }
  }
  return map
})()

/** 构造一个 vec3 分组（3 条分量 scalar 轨道 + 整体基准取值） */
function vec3Group(
  groupPath: string,
  label: string,
  isAvailable: (object: StageObject) => boolean,
  getVec: (object: StageObject) => StageVec3,
  setVec: (object: StageObject, vec: StageVec3) => StageObject,
): AnimatableGroup {
  const children: AnimatablePropDescriptor[] = VEC3_AXES.map((axis) => ({
    path: `${groupPath}.${axis}`,
    label: axis.toUpperCase(),
    valueType: 'scalar',
    axis,
    isAvailable,
    getValue: (object) => getVec(object)[axis],
    applyToObject: (object, value) => setVec(object, { ...getVec(object), [axis]: value as number }),
  }))
  return { groupPath, label, valueType: 'vec3', children, isAvailable, getBaseValue: getVec }
}

function scalarGroup(
  groupPath: string,
  label: string,
  valueType: StageAnimatableValueType,
  isAvailable: (object: StageObject) => boolean,
  getValue: (object: StageObject) => StageKeyframeValue,
  applyToObject: (object: StageObject, value: StageKeyframeValue) => StageObject,
): AnimatableGroup {
  const child: AnimatablePropDescriptor = { path: groupPath, label, valueType, isAvailable, getValue, applyToObject }
  return { groupPath, label, valueType, children: [child], isAvailable, getBaseValue: getValue }
}

const notCamera = (object: StageObject): boolean => object.type !== 'camera'
const isCharacter = (object: StageObject): boolean => object.type === 'character'

const TRANSFORM_GROUPS: AnimatableGroup[] = [
  vec3Group(
    'transform.position',
    '位置',
    () => true,
    (object) => object.transform.position,
    (object, vec) => ({ ...object, transform: { ...object.transform, position: vec } }),
  ),
  vec3Group(
    'transform.rotation',
    '旋转',
    () => true,
    (object) => object.transform.rotation,
    (object, vec) => ({ ...object, transform: { ...object.transform, rotation: vec } }),
  ),
  vec3Group(
    'transform.scale',
    '缩放',
    notCamera,
    (object) => object.transform.scale,
    (object, vec) => ({ ...object, transform: { ...object.transform, scale: vec } }),
  ),
]

const COLOR_GROUP: AnimatableGroup = scalarGroup(
  'color',
  '颜色',
  'color',
  () => true,
  (object) => object.color,
  (object, value) => ({ ...object, color: value as string }),
)

const FOV_GROUP: AnimatableGroup = scalarGroup(
  'fov',
  '视野角',
  'scalar',
  (object) => object.type === 'camera',
  (object) => (object.type === 'camera' ? object.fov : 0),
  (object, value) => (object.type === 'camera' ? { ...object, fov: value as number } : object),
)

function poseJointGroup(jointId: StagePoseJointId): AnimatableGroup {
  const getVec = (object: StageObject): StageVec3 =>
    object.type === 'character' ? object.pose.joints[jointId] ?? ZERO_VEC3 : ZERO_VEC3
  const setVec = (object: StageObject, vec: StageVec3): StageObject =>
    object.type === 'character'
      ? { ...object, pose: { ...object.pose, joints: { ...object.pose.joints, [jointId]: vec } } }
      : object
  return vec3Group(poseJointPath(jointId), `姿态·${POSE_JOINT_LABELS[jointId] ?? jointId}`, isCharacter, getVec, setVec)
}

const POSE_JOINT_GROUP_LIST: AnimatableGroup[] = POSE_JOINT_GROUPS.flatMap((group) =>
  group.joints.map((joint) => poseJointGroup(joint.id)),
)

/** 全部分组（固定顺序：变换 → 颜色 → FOV → 姿态各关节） */
const ALL_GROUPS: AnimatableGroup[] = [
  ...TRANSFORM_GROUPS,
  COLOR_GROUP,
  FOV_GROUP,
  ...POSE_JOINT_GROUP_LIST,
]

const GROUP_BY_PATH = new Map(ALL_GROUPS.map((group) => [group.groupPath, group]))
const DESCRIPTOR_BY_PATH = new Map(
  ALL_GROUPS.flatMap((group) => group.children).map((descriptor) => [descriptor.path, descriptor]),
)

/** 按轨道路径解析描述子（scalar/color；采样应用、求值用） */
export function getAnimatablePropByPath(path: string): AnimatablePropDescriptor | undefined {
  return DESCRIPTOR_BY_PATH.get(path)
}

/** 按分组路径解析分组（码表整体打点、播放聚合用） */
export function getAnimatableGroupByPath(groupPath: string): AnimatableGroup | undefined {
  return GROUP_BY_PATH.get(groupPath)
}

/** 列出某对象可打关键帧的全部分组（属性面板码表、时间轴父行消费） */
export function listAnimatableGroups(object: StageObject): AnimatableGroup[] {
  return ALL_GROUPS.filter((group) => group.isAvailable(object))
}
