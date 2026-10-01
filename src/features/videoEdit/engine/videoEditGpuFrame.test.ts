import { expect, it, vi } from 'vitest'
import { VideoEditGpuFrame, videoEditGpuFrameUsesChroma } from './videoEditGpuFrame'

it('定位、播放与导出共用格式政策，不把已知高位深或RGBA转换为八位色度缓存', () => {
  expect(videoEditGpuFrameUsesChroma({ format: 'I420' })).toBe(true)
  expect(videoEditGpuFrameUsesChroma({ format: 'NV12' })).toBe(true)
  expect(videoEditGpuFrameUsesChroma({ format: null }, 'avc1.640033')).toBe(true)
  for (const codec of ['hev1', 'av01', undefined]) expect(videoEditGpuFrameUsesChroma({ format: null }, codec)).toBe(false)
  for (const format of ['RGBA', 'I420P10'] as const) expect(videoEditGpuFrameUsesChroma({ format }, 'avc1.640033')).toBe(false)
})

it('淘汰缓存不能释放合成器借用的纹理，最后一个借用关闭后只释放一次', () => {
  const texture = { createView: vi.fn(), destroy: vi.fn() }
  const frame = new VideoEditGpuFrame({ timestamp: 1.037, duration: .053, displayWidth: 3840, displayHeight: 2160, rotation: 90, flip: true }, texture, texture, 3840 * 2160 * 4)
  const borrowed = frame.clone(); frame.close(); frame.close()
  expect(texture.destroy).not.toHaveBeenCalled(); expect(borrowed.texture).toBe(texture)
  expect(borrowed.timestamp).toBe(1.037); expect(borrowed.rotation).toBe(90)
  borrowed.close(); borrowed.close(); expect(texture.destroy).toHaveBeenCalledTimes(2)
  expect(() => borrowed.clone()).toThrow('释放')
})
