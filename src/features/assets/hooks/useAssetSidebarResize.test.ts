import { describe, expect, it } from 'vitest'
import { ASSET_SIDEBAR_MAX_WIDTH, ASSET_SIDEBAR_MIN_WIDTH, clampAssetSidebarWidth } from './useAssetSidebarResize'

describe('clampAssetSidebarWidth', () => {
  it('限制在登记的最小与最大宽度内', () => {
    expect(clampAssetSidebarWidth(80, 1600)).toBe(ASSET_SIDEBAR_MIN_WIDTH)
    expect(clampAssetSidebarWidth(800, 1600)).toBe(ASSET_SIDEBAR_MAX_WIDTH)
  })

  it('窄窗口下为主内容保留空间', () => {
    expect(clampAssetSidebarWidth(360, 640)).toBe(192)
  })
})
