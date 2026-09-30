import { expect, it, vi } from 'vitest'
import { VideoEditGpuFrame } from './videoEditGpuFrame'

it('淘汰缓存不能释放合成器借用的纹理，最后一个借用关闭后只释放一次', () => {
  const texture = { createView: vi.fn(), destroy: vi.fn() }
  const frame = new VideoEditGpuFrame({ timestamp: 1.037, duration: .053, displayWidth: 3840, displayHeight: 2160, rotation: 90, flip: true }, texture, texture, 3840 * 2160 * 4)
  const borrowed = frame.clone(); frame.close(); frame.close()
  expect(texture.destroy).not.toHaveBeenCalled(); expect(borrowed.texture).toBe(texture)
  expect(borrowed.timestamp).toBe(1.037); expect(borrowed.rotation).toBe(90)
  borrowed.close(); borrowed.close(); expect(texture.destroy).toHaveBeenCalledTimes(2)
  expect(() => borrowed.clone()).toThrow('释放')
})
