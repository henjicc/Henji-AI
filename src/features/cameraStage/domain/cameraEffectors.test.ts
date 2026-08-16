import { describe, expect, it } from 'vitest'
import { sampleEffectorOffset } from './cameraEffectors'
import type { StageCameraEffector } from './stateKeyframeTypes'

const HANDHELD: StageCameraEffector = {
  id: 'handheld', kind: 'handheld', enabled: true, intensity: 1, frequency: 1,
}

describe('cameraEffectors', () => {
  it('同一时间输入始终返回相同结果', () => {
    expect(sampleEffectorOffset(HANDHELD, 1.234)).toEqual(sampleEffectorOffset(HANDHELD, 1.234))
  })

  it('零强度与关闭状态返回零偏移', () => {
    const zero = { positionOffset: { x: 0, y: 0, z: 0 }, rotationOffset: { x: 0, y: 0, z: 0 } }
    expect(sampleEffectorOffset({ ...HANDHELD, intensity: 0 }, 0.5)).toEqual(zero)
    expect(sampleEffectorOffset({ ...HANDHELD, enabled: false }, 0.5)).toEqual(zero)
  })

  it('频率改变采样周期', () => {
    const slow = sampleEffectorOffset({ ...HANDHELD, frequency: 1 }, 0.37)
    const fast = sampleEffectorOffset({ ...HANDHELD, frequency: 2 }, 0.37)
    expect(fast).not.toEqual(slow)
    expect(sampleEffectorOffset({ ...HANDHELD, frequency: 2 }, 0.37)).toEqual(fast)
  })
})
