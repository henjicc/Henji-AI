/**
 * 内置 Quaternius 角色动作片段清单。
 *
 * clipName 必须与 resources/camera-stage/UAL1_Standard.glb 中的 animation.name 完全一致。
 */

export const CHARACTER_POSE_MOTION_VALUE = 'pose'

export const CHARACTER_ANIMATION_CLIPS = [
  { clipName: 'A_TPose', label: 'T Pose' },
  { clipName: 'Crouch_Fwd_Loop', label: '蹲伏前进' },
  { clipName: 'Crouch_Idle_Loop', label: '蹲伏待机' },
  { clipName: 'Dance_Loop', label: '跳舞' },
  { clipName: 'Death01', label: '倒地' },
  { clipName: 'Driving_Loop', label: '驾驶' },
  { clipName: 'Fixing_Kneeling', label: '跪姿修理' },
  { clipName: 'Hit_Chest', label: '胸口受击' },
  { clipName: 'Hit_Head', label: '头部受击' },
  { clipName: 'Idle_Loop', label: '待机' },
  { clipName: 'Idle_Talking_Loop', label: '站立交谈' },
  { clipName: 'Idle_Torch_Loop', label: '火把待机' },
  { clipName: 'Interact', label: '互动' },
  { clipName: 'Jog_Fwd_Loop', label: '慢跑' },
  { clipName: 'Jump_Land', label: '跳跃落地' },
  { clipName: 'Jump_Loop', label: '跳跃滞空' },
  { clipName: 'Jump_Start', label: '起跳' },
  { clipName: 'PickUp_Table', label: '桌面拾取' },
  { clipName: 'Pistol_Aim_Down', label: '手枪下瞄' },
  { clipName: 'Pistol_Aim_Neutral', label: '手枪平瞄' },
  { clipName: 'Pistol_Aim_Up', label: '手枪上瞄' },
  { clipName: 'Pistol_Idle_Loop', label: '手枪待机' },
  { clipName: 'Pistol_Reload', label: '手枪换弹' },
  { clipName: 'Pistol_Shoot', label: '手枪射击' },
  { clipName: 'Punch_Cross', label: '交叉拳' },
  { clipName: 'Punch_Jab', label: '刺拳' },
  { clipName: 'Push_Loop', label: '推' },
  { clipName: 'Roll', label: '翻滚' },
  { clipName: 'Sitting_Enter', label: '坐下' },
  { clipName: 'Sitting_Exit', label: '起身' },
  { clipName: 'Sitting_Idle_Loop', label: '坐姿待机' },
  { clipName: 'Sitting_Talking_Loop', label: '坐姿交谈' },
  { clipName: 'Spell_Simple_Enter', label: '施法进入' },
  { clipName: 'Spell_Simple_Exit', label: '施法结束' },
  { clipName: 'Spell_Simple_Idle_Loop', label: '施法待机' },
  { clipName: 'Spell_Simple_Shoot', label: '施法发射' },
  { clipName: 'Sprint_Loop', label: '冲刺' },
  { clipName: 'Swim_Fwd_Loop', label: '游泳前进' },
  { clipName: 'Swim_Idle_Loop', label: '游泳待机' },
  { clipName: 'Sword_Attack', label: '挥剑攻击' },
  { clipName: 'Sword_Idle', label: '持剑待机' },
  { clipName: 'Walk_Formal_Loop', label: '正式走路' },
  { clipName: 'Walk_Loop', label: '走路' },
] as const

export type StageCharacterAnimationClipName = typeof CHARACTER_ANIMATION_CLIPS[number]['clipName']

export type StageCharacterMotion =
  | { mode: 'pose' }
  | { mode: 'clip'; clipName: StageCharacterAnimationClipName; speed: number }

export const DEFAULT_CHARACTER_MOTION: StageCharacterMotion = { mode: 'pose' }

export function isCharacterAnimationClipName(value: string): value is StageCharacterAnimationClipName {
  return CHARACTER_ANIMATION_CLIPS.some((clip) => clip.clipName === value)
}

export function createPoseMotion(): StageCharacterMotion {
  return { mode: 'pose' }
}

export function createClipMotion(
  clipName: StageCharacterAnimationClipName,
  speed = 1,
): StageCharacterMotion {
  return { mode: 'clip', clipName, speed: Math.max(0.1, Math.min(3, speed)) }
}

export function getCharacterMotionClipLabel(clipName: string): string {
  return CHARACTER_ANIMATION_CLIPS.find((clip) => clip.clipName === clipName)?.label ?? clipName
}

export function normalizeCharacterMotion(raw: unknown): StageCharacterMotion {
  if (!raw || typeof raw !== 'object') return createPoseMotion()
  const record = raw as Record<string, unknown>
  if (record.mode !== 'clip') return createPoseMotion()
  const clipName = record.clipName
  if (typeof clipName !== 'string' || !isCharacterAnimationClipName(clipName)) {
    return createPoseMotion()
  }
  const speed = Number(record.speed)
  return createClipMotion(clipName, Number.isFinite(speed) ? speed : 1)
}
