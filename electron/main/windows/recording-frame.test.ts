import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ BrowserWindow: class {}, screen: {} }))
vi.mock('../services/logging', () => ({ createMainLogger: () => ({ warn: vi.fn(), info: vi.fn() }) }))
vi.mock('../services/media-permissions', () => ({ mediaPermissions: { protectSource: () => () => undefined } }))
vi.mock('../security/main-renderer-url', () => ({ installRendererNavigationGuards: vi.fn() }))
vi.mock('../development-launch', () => ({ resolveSecondaryWindowLaunchQuery: () => ({}) }))

import { recordingFrameShape } from './recording-frame'

describe('录制范围提示窗口形状', () => {
  it('录制中只保留四条边框，中间区域不属于窗口（鼠标穿过且不需要穿透属性）', () => {
    const rects = recordingFrameShape(1920, 1040, 'recording')
    expect(rects).toEqual([{ x: 0, y: 0, width: 1920, height: 4 }, { x: 0, y: 1036, width: 1920, height: 4 }, { x: 0, y: 0, width: 4, height: 1040 }, { x: 1916, y: 0, width: 4, height: 1040 }])
    const covers = (x: number, y: number): boolean => rects.some(rect => x >= rect.x && x < rect.x + rect.width && y >= rect.y && y < rect.y + rect.height)
    expect(covers(960, 520)).toBe(false)
    expect(covers(1919, 1039)).toBe(true)
  })
  it('倒计时加入中间数字区域，暂停加入顶部标签区域', () => {
    expect(recordingFrameShape(1920, 1040, 'countdown').at(-1)).toEqual({ x: 850, y: 450, width: 220, height: 140 })
    expect(recordingFrameShape(1920, 1040, 'paused').at(-1)).toEqual({ x: 860, y: 0, width: 200, height: 32 })
  })
  it('很小的窗口来源不越界', () => {
    for (const rect of recordingFrameShape(100, 60, 'countdown')) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(100)
      expect(rect.y + rect.height).toBeLessThanOrEqual(60)
    }
  })
})
