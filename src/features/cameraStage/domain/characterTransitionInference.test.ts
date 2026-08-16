import { describe, expect, it } from 'vitest'
import { createCharacterObject, pickDefaultColor } from './sceneDefaults'
import { captureStateKeyframeObjectState } from './stateKeyframeTypes'
import {
  CHARACTER_JOG_MIN_SPEED,
  CHARACTER_MOVE_MIN_SPEED,
  CHARACTER_SPRINT_MIN_SPEED,
  inferCharacterTransition,
} from './characterTransitionInference'

function statesForSpeed(speed: number, duration = 1) {
  const character = createCharacterObject('角色', pickDefaultColor(0))
  const from = captureStateKeyframeObjectState(character)
  const to = captureStateKeyframeObjectState(character)
  to.transform = {
    ...to.transform,
    position: { ...to.transform.position, z: speed * duration },
  }
  return { from, to, duration }
}

describe('inferCharacterTransition', () => {
  it.each([
    [CHARACTER_MOVE_MIN_SPEED, 'Walk_Loop'],
    [CHARACTER_JOG_MIN_SPEED, 'Jog_Fwd_Loop'],
    [CHARACTER_SPRINT_MIN_SPEED, 'Sprint_Loop'],
  ] as const)('速度 %s 推断为 %s', (speed, clipName) => {
    const { from, to, duration } = statesForSpeed(speed)
    expect(inferCharacterTransition(from, to, duration).motion).toMatchObject({ mode: 'clip', clipName })
  })

  it('低于最小速度时不生成朝向或动作', () => {
    const { from, to, duration } = statesForSpeed(CHARACTER_MOVE_MIN_SPEED - 0.001)
    expect(inferCharacterTransition(from, to, duration)).toEqual({ facingYawKeyframes: [], motion: null })
  })

  it('朝向跨越 ±180° 时选择最短旋转路径', () => {
    const { from, to } = statesForSpeed(2)
    from.transform.rotation.y = 170
    to.transform.position = { x: -0.35, y: 0, z: -1.97 }
    const result = inferCharacterTransition(from, to, 1)
    expect(result.facingYawKeyframes[1].yaw).toBeGreaterThan(180)
    expect(result.facingYawKeyframes[1].yaw - 170).toBeLessThan(30)
  })

  it('motionOverride 优先于速度自动分级', () => {
    const { from, to, duration } = statesForSpeed(5)
    const override = { mode: 'clip', clipName: 'Walk_Formal_Loop', speed: 0.7 } as const
    expect(inferCharacterTransition(from, to, duration, override).motion).toEqual(override)
  })
})
