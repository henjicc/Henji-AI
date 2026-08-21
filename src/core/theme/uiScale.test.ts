import { describe, expect, it } from 'vitest'

import {
  normalizeUiScaleMode,
  resolveUiScaleFactor,
  uiScaleFactorPercent,
} from './uiScale'

describe('uiScale', () => {
  it('自动模式按未缩放的窗口逻辑尺寸选择 90% 或 100%', () => {
    expect(resolveUiScaleFactor('auto', { width: 1439, height: 1200 })).toBe(0.9)
    expect(resolveUiScaleFactor('auto', { width: 1600, height: 999 })).toBe(0.9)
    expect(resolveUiScaleFactor('auto', { width: 1440, height: 1000 })).toBe(1)
  })

  it('手动模式不受窗口尺寸影响', () => {
    expect(resolveUiScaleFactor('90', { width: 3000, height: 2000 })).toBe(0.9)
    expect(resolveUiScaleFactor('100', { width: 960, height: 640 })).toBe(1)
    expect(resolveUiScaleFactor('110', { width: 960, height: 640 })).toBe(1.1)
  })

  it('非法模式和不可用尺寸安全回退', () => {
    expect(normalizeUiScaleMode('85')).toBe('auto')
    expect(resolveUiScaleFactor('invalid', { width: 1440, height: 1000 })).toBe(1)
    expect(resolveUiScaleFactor('auto', { width: Number.NaN, height: 800 })).toBe(1)
  })

  it('把缩放因子转换为稳定的界面诊断值', () => {
    expect(uiScaleFactorPercent(0.9)).toBe(90)
    expect(uiScaleFactorPercent(1)).toBe(100)
    expect(uiScaleFactorPercent(1.1)).toBe(110)
  })
})
