import { describe, expect, it } from 'vitest'
import { REGISTRATION_QUALITY_PROFILES } from './quality-profiles'

describe('局部重绘 PS 配准档位', () => {
  it('保留 PS 插件的帧预算、特征预算和细化层级', () => {
    expect(REGISTRATION_QUALITY_PROFILES.fast).toMatchObject({ frameMaxEdge: 640, featureMaxEdge: 480, maxKeypoints: 360, ransacIterations: 600 })
    expect(REGISTRATION_QUALITY_PROFILES.precise).toMatchObject({ frameMaxEdge: 1024, featureMaxEdge: 640, maxKeypoints: 540, ransacIterations: 900 })
    expect(REGISTRATION_QUALITY_PROFILES.extreme).toMatchObject({ frameMaxEdge: 1536, featureMaxEdge: 768, maxKeypoints: 700, ransacIterations: 1200 })
    expect(REGISTRATION_QUALITY_PROFILES.fast.refinementSchedule.translationSteps).toHaveLength(4)
    expect(REGISTRATION_QUALITY_PROFILES.precise.refinementSchedule.translationSteps).toHaveLength(6)
    expect(REGISTRATION_QUALITY_PROFILES.extreme.refinementSchedule.translationSteps).toHaveLength(8)
    expect(REGISTRATION_QUALITY_PROFILES.extreme.refinementSchedule.translationOnlyFromLevel).toBe(6)
  })
})
