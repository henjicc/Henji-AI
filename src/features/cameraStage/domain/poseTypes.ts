import type { StageVec3 } from './sceneTypes'

/**
 * 角色姿态数据模型（FK：逐关节欧拉偏移，不引入 IK）。
 *
 * 每个受控关节存一个"相对绑定姿态的欧拉偏移"（角度制，XYZ 序），
 * 渲染层按 bone.quaternion = rest * offset 应用；未记录的关节保持绑定姿态。
 */

export type StagePoseJointId =
  | 'body'
  | 'torso'
  | 'head'
  | 'shoulderL'
  | 'elbowL'
  | 'wristL'
  | 'shoulderR'
  | 'elbowR'
  | 'wristR'
  | 'hipL'
  | 'kneeL'
  | 'ankleL'
  | 'hipR'
  | 'kneeR'
  | 'ankleR'

/** 受控关节 → 内置角色 GLB（UE Mannequin 命名骨架）的骨骼节点名 */
export const POSE_JOINT_BONES: Record<StagePoseJointId, string> = {
  body: 'pelvis',
  torso: 'spine_02',
  head: 'Head',
  shoulderL: 'upperarm_l',
  elbowL: 'lowerarm_l',
  wristL: 'hand_l',
  shoulderR: 'upperarm_r',
  elbowR: 'lowerarm_r',
  wristR: 'hand_r',
  hipL: 'thigh_l',
  kneeL: 'calf_l',
  ankleL: 'foot_l',
  hipR: 'thigh_r',
  kneeR: 'calf_r',
  ankleR: 'foot_r',
}

export interface StageCharacterPose {
  joints: Partial<Record<StagePoseJointId, StageVec3>>
  /** 骨盆平移偏移（模型局部单位）：坐姿/蹲伏等预设需要整体降低身体，纯旋转表达不出来 */
  hipsOffset?: StageVec3
}

export interface StagePosePreset {
  id: string
  name: string
  joints: Partial<Record<StagePoseJointId, StageVec3>>
  hipsOffset?: StageVec3
}

/** 姿态面板的滑杆分组（对齐参考产品"身体/躯干/头部/四肢"的分组结构） */
export const POSE_JOINT_GROUPS: Array<{
  id: string
  name: string
  joints: Array<{ id: StagePoseJointId; name: string }>
}> = [
  { id: 'core', name: '身体', joints: [{ id: 'body', name: '骨盆' }] },
  { id: 'torso', name: '躯干', joints: [{ id: 'torso', name: '脊柱' }] },
  { id: 'head', name: '头部', joints: [{ id: 'head', name: '头' }] },
  {
    id: 'armL',
    name: '左臂',
    joints: [
      { id: 'shoulderL', name: '肩' },
      { id: 'elbowL', name: '肘' },
      { id: 'wristL', name: '腕' },
    ],
  },
  {
    id: 'armR',
    name: '右臂',
    joints: [
      { id: 'shoulderR', name: '肩' },
      { id: 'elbowR', name: '肘' },
      { id: 'wristR', name: '腕' },
    ],
  },
  {
    id: 'legL',
    name: '左腿',
    joints: [
      { id: 'hipL', name: '髋' },
      { id: 'kneeL', name: '膝' },
      { id: 'ankleL', name: '踝' },
    ],
  },
  {
    id: 'legR',
    name: '右腿',
    joints: [
      { id: 'hipR', name: '髋' },
      { id: 'kneeR', name: '膝' },
      { id: 'ankleR', name: '踝' },
    ],
  },
]

export function createEmptyPose(): StageCharacterPose {
  return { joints: {} }
}

/** 深拷贝一份姿态数据，避免多个角色/预设常量之间共享同一份关节对象 */
export function clonePose(source: {
  joints: Partial<Record<StagePoseJointId, StageVec3>>
  hipsOffset?: StageVec3
}): StageCharacterPose {
  const joints: StageCharacterPose['joints'] = {}
  for (const [jointId, euler] of Object.entries(source.joints)) {
    if (euler) {
      joints[jointId as StagePoseJointId] = { ...euler }
    }
  }
  return {
    joints,
    ...(source.hipsOffset ? { hipsOffset: { ...source.hipsOffset } } : {}),
  }
}
