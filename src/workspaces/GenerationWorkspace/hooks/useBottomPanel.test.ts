import { describe, expect, it } from 'vitest'

import { shouldUseCompactGenerationLayout } from '@/core/layout/uiAvailableSpace'

describe('shouldUseCompactGenerationLayout', () => {
  it('按缩放后的实际工作区高度进入紧凑模式', () => {
    expect(shouldUseCompactGenerationLayout(1470, 848)).toBe(true)
    expect(shouldUseCompactGenerationLayout(1470, 1000)).toBe(false)
  })

  it('窄工作区为参数换行预留更多历史区域', () => {
    expect(shouldUseCompactGenerationLayout(1100, 1000)).toBe(true)
    expect(shouldUseCompactGenerationLayout(1100, 1100)).toBe(false)
  })
})
