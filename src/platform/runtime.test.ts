import { describe, expect, it } from 'vitest'
import { isImageEditorV3Enabled } from './runtime'

describe('图片编辑器 V3 运行时开关', () => {
  it('默认关闭，只有明确布尔值 true 才开启', () => {
    expect(isImageEditorV3Enabled({})).toBe(false)
    expect(isImageEditorV3Enabled({ featureFlags: { imageEditorV3: false } })).toBe(false)
    expect(isImageEditorV3Enabled({ featureFlags: { imageEditorV3: true } })).toBe(true)
  })
})
