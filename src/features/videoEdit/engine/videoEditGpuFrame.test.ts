import { expect, it, vi } from 'vitest'
import { VideoEditGpuFrame, videoEditGpuFrameFormat, videoEditGpuFrameUsesChroma, videoEditPictureHighPrecision } from './videoEditGpuFrame'

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

it('自有格式政策：不透明且不超过10位用 rgb10a2unorm，透明、12位或未知用 rgba16float，浏览器无格式硬解帧与八位不变', () => {
  const format = (value: string | null, native?: { bitDepth: number | null; hasAlpha: boolean }) => videoEditGpuFrameFormat({ format: value as VideoFrame['format'] }, native)
  expect(['I420P10', 'I422P10', 'I444P10'].map(value => format(value))).toEqual(['rgb10a2unorm', 'rgb10a2unorm', 'rgb10a2unorm'])
  expect(['I420AP10', 'I444AP10', 'I420P12', 'I444AP12'].map(value => format(value))).toEqual(['rgba16float', 'rgba16float', 'rgba16float', 'rgba16float'])
  for (const value of ['I420', 'NV12', 'RGBA', 'BGRX', 'I420A']) expect(format(value, { bitDepth: 10, hasAlpha: false })).toBe('rgba8unorm')
  // Native rgbaf16 pictures (no format, record 007) by the decoder's details.
  expect(format(null, { bitDepth: 10, hasAlpha: false })).toBe('rgb10a2unorm')
  expect(format(null, { bitDepth: 8, hasAlpha: false })).toBe('rgb10a2unorm')
  expect(format(null, { bitDepth: 12, hasAlpha: false })).toBe('rgba16float')
  expect(format(null, { bitDepth: 10, hasAlpha: true })).toBe('rgba16float')
  expect(format(null, { bitDepth: null, hasAlpha: false })).toBe('rgba16float')
  // Chromium imports 10-bit hardware frames at 8-bit precision: no gain on the browser fallback.
  expect(format(null)).toBe('rgba8unorm')
})

it('高精度标记随共享资源克隆，未知输入不算高精度', () => {
  const texture = { createView: vi.fn(), destroy: vi.fn() }
  const frame = new VideoEditGpuFrame({ timestamp: 0, duration: .02, displayWidth: 4, displayHeight: 4, rotation: 0, flip: false }, texture, undefined, 4 * 4 * 8, undefined, undefined, true)
  const copy = frame.clone()
  expect(frame.highPrecision).toBe(true); expect(copy.highPrecision).toBe(true); expect(videoEditPictureHighPrecision(copy)).toBe(true)
  expect(new VideoEditGpuFrame(frame, texture, undefined, 64).highPrecision).toBe(false)
  for (const value of [null, undefined, {}, { highPrecision: 'yes' }]) expect(videoEditPictureHighPrecision(value)).toBe(false)
  frame.close(); copy.close(); expect(texture.destroy).toHaveBeenCalledOnce()
})
