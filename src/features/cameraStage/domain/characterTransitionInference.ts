import type { StageCharacterMotion } from './characterMotion'
import type { StageStateKeyframeObjectState } from './stateKeyframeTypes'

export const CHARACTER_MOVE_MIN_SPEED = 0.1
export const CHARACTER_JOG_MIN_SPEED = 1.8
export const CHARACTER_SPRINT_MIN_SPEED = 4
export const CHARACTER_TURN_FRACTION = 0.15

export interface CharacterFacingKeyframe {
  /** 在过渡区间内的归一化时间（0~1） */
  timeRatio: number
  /** 角度制；为保证最短旋转，值可能超出 [-180, 180] */
  yaw: number
}

export interface CharacterTransitionInference {
  facingYawKeyframes: CharacterFacingKeyframe[]
  motion: StageCharacterMotion | null
}

function normalizeAngle(angle: number): number {
  return ((angle + 180) % 360 + 360) % 360 - 180
}

/** 把目标角展开到 reference 附近，确保旋转走最短路径。 */
function unwrapNearest(target: number, reference: number): number {
  return reference + normalizeAngle(target - reference)
}

function inferMotion(speed: number): StageCharacterMotion {
  if (speed >= CHARACTER_SPRINT_MIN_SPEED) {
    return { mode: 'clip', clipName: 'Sprint_Loop', speed: 1 }
  }
  if (speed >= CHARACTER_JOG_MIN_SPEED) {
    return { mode: 'clip', clipName: 'Jog_Fwd_Loop', speed: 1 }
  }
  return { mode: 'clip', clipName: 'Walk_Loop', speed: 1 }
}

export function inferCharacterTransition(
  fromState: StageStateKeyframeObjectState,
  toState: StageStateKeyframeObjectState,
  transitionDuration: number,
  motionOverride?: StageCharacterMotion,
): CharacterTransitionInference {
  const dx = toState.transform.position.x - fromState.transform.position.x
  const dz = toState.transform.position.z - fromState.transform.position.z
  const distance = Math.hypot(dx, dz)
  const duration = Math.max(0, transitionDuration)
  const speed = duration > 0 ? distance / duration : 0
  if (distance <= 1e-3 || speed < CHARACTER_MOVE_MIN_SPEED) {
    return { facingYawKeyframes: [], motion: null }
  }

  const fromYaw = fromState.transform.rotation.y
  const facingYaw = unwrapNearest(Math.atan2(dx, dz) * 180 / Math.PI, fromYaw)
  const targetYaw = unwrapNearest(toState.transform.rotation.y, facingYaw)
  return {
    facingYawKeyframes: [
      { timeRatio: 0, yaw: fromYaw },
      { timeRatio: CHARACTER_TURN_FRACTION, yaw: facingYaw },
      { timeRatio: 1 - CHARACTER_TURN_FRACTION, yaw: facingYaw },
      { timeRatio: 1, yaw: targetYaw },
    ],
    motion: motionOverride ?? inferMotion(speed),
  }
}
