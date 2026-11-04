/**
 * 内置 Quaternius 角色动作片段清单。
 *
 * clipName 必须与 resources/camera-stage/UAL1_Standard.glb 中的 animation.name 完全一致（程序生成的手势除外）。
 */

import { CHARACTER_CLIP_FACTS, type CharacterClipFacts } from './characterClips.gen'

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
  // 动作库里没有挥手：渲染层以待机为底、右臂按 characterGestures 的关节曲线挥手生成这一段。
  { clipName: 'Wave', label: '挥手' },
] as const

export type StageCharacterAnimationClipName = typeof CHARACTER_ANIMATION_CLIPS[number]['clipName']

/** 程序生成的手势片段；时长决定动作何时做完、回到待机。 */
const PROCEDURAL_CLIP_FACTS: Record<string, CharacterClipFacts> = {
  Wave: { duration: 2.4, loop: false },
}

export function characterClipFacts(clipName: string): CharacterClipFacts | undefined {
  return CHARACTER_CLIP_FACTS[clipName] ?? PROCEDURAL_CLIP_FACTS[clipName]
}

/**
 * 一次性动作做完后接着做什么：坐下之后坐着，挥手、拾取、受击之后回到待机。不在表里的一次性动作
 * （倒地、T 姿势、跪姿修理）停在最后一帧。
 */
export const CHARACTER_CLIP_FOLLOW_UPS: Partial<Record<StageCharacterAnimationClipName, StageCharacterAnimationClipName>> = {
  Sitting_Enter: 'Sitting_Idle_Loop',
  Sitting_Exit: 'Idle_Loop',
  Wave: 'Idle_Loop',
  Interact: 'Idle_Loop',
  PickUp_Table: 'Idle_Loop',
  Hit_Chest: 'Idle_Loop',
  Hit_Head: 'Idle_Loop',
  Punch_Jab: 'Idle_Loop',
  Punch_Cross: 'Idle_Loop',
  Jump_Start: 'Jump_Land',
  Jump_Land: 'Idle_Loop',
  Roll: 'Idle_Loop',
  Pistol_Reload: 'Pistol_Idle_Loop',
  Pistol_Shoot: 'Pistol_Idle_Loop',
  Spell_Simple_Enter: 'Spell_Simple_Idle_Loop',
  Spell_Simple_Shoot: 'Spell_Simple_Idle_Loop',
  Spell_Simple_Exit: 'Idle_Loop',
  Sword_Attack: 'Sword_Idle',
}

/** 原地走跑片段：按走过的路程推进，脚才钉在地上。 */
export function isLocomotionClip(clipName: string): boolean {
  return characterClipFacts(clipName)?.groundSpeed !== undefined
}

/**
 * 按平均速度选步态。动作库的慢跑按约 5.9 米/秒制作（落地时脚往后扫得很快），走路约 1 米/秒：
 * 走路放到 2.25 倍还像快走，再快就换慢跑（这时慢跑放慢到四成多，步频偏慢但脚不滑），冲刺同理。
 */
export const CHARACTER_JOG_MIN_SPEED = 2.2
export const CHARACTER_SPRINT_MIN_SPEED = 7
export const CHARACTER_MOVE_MIN_SPEED = 0.1

export function locomotionClipForSpeed(speed: number): StageCharacterAnimationClipName {
  if (speed >= CHARACTER_SPRINT_MIN_SPEED) return 'Sprint_Loop'
  if (speed >= CHARACTER_JOG_MIN_SPEED) return 'Jog_Fwd_Loop'
  return 'Walk_Loop'
}

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
