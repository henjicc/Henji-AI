import { describe, expect, it } from 'vitest'

import { shouldUseCompactBottomPanelLayout } from './useBottomPanel'

describe('shouldUseCompactBottomPanelLayout', () => {
  it('按缩放后的实际工作区高度进入紧凑模式', () => {
    expect(shouldUseCompactBottomPanelLayout(1470, 848)).toBe(true)
    expect(shouldUseCompactBottomPanelLayout(1470, 1000)).toBe(false)
  })

  it('窄工作区为参数换行预留更多历史区域', () => {
    expect(shouldUseCompactBottomPanelLayout(1100, 1000)).toBe(true)
    expect(shouldUseCompactBottomPanelLayout(1100, 1100)).toBe(false)
  })
})
