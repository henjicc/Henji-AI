import { describe, expect, it } from 'vitest'

import {
  classifyUiAvailableSpace,
  shouldUseCompactGenerationLayout,
} from './uiAvailableSpace'

describe('uiAvailableSpace', () => {
  it('按宽高分别给出稳定的空间档位', () => {
    expect(classifyUiAvailableSpace(1180, 920)).toEqual({
      widthBand: 'narrow',
      heightBand: 'short',
    })
    expect(classifyUiAvailableSpace(1181, 1050)).toEqual({
      widthBand: 'regular',
      heightBand: 'constrained',
    })
    expect(classifyUiAvailableSpace(1600, 1051)).toEqual({
      widthBand: 'regular',
      heightBand: 'spacious',
    })
  })

  it('生成页保持短高度或窄且受限时进入紧凑模式', () => {
    expect(shouldUseCompactGenerationLayout(1470, 920)).toBe(true)
    expect(shouldUseCompactGenerationLayout(1180, 1050)).toBe(true)
    expect(shouldUseCompactGenerationLayout(1181, 1050)).toBe(false)
    expect(shouldUseCompactGenerationLayout(1180, 1051)).toBe(false)
  })
})
