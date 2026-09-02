import { describe, expect, it } from 'vitest'

import {
  FAST_BLUR_MAX_PAIRED_TAPS,
  compileFastBlurRecipe,
} from './fastBlurRecipe'

describe('快速模糊 GPU 配方', () => {
  it('零半径编译为直通，不创建无意义采样', () => {
    expect(compileFastBlurRecipe(0, 1_920, 1_080)).toMatchObject({
      schemaVersion: 3,
      pyramidLevel: 0,
      sigmaAtPyramidLevel: 0,
      centerWeight: 1,
      pairedTaps: [],
    })
  })

  it('大半径进入连续金字塔，并把一维采样固定在 8 个合并 tap 内', () => {
    const recipe = compileFastBlurRecipe(160, 2_048, 1_024)
    expect(recipe.pyramidLevel).toBe(5)
    expect(recipe.sigmaAtPyramidLevel).toBe(5)
    expect(recipe.pairedTaps.length).toBeLessThanOrEqual(FAST_BLUR_MAX_PAIRED_TAPS)
    const normalized = recipe.centerWeight
      + recipe.pairedTaps.reduce((sum, tap) => sum + tap.weight * 2, 0)
    expect(normalized).toBeCloseTo(1, 10)
    expect(recipe.pairedTaps.every((tap) => tap.offset > 0 && tap.weight > 0)).toBe(true)
  })
})
