import { expect, it, vi } from 'vitest'

vi.mock('../../video/ffmpeg-loader', () => ({ loadFfmpegPath: async () => 'ffmpeg' }))
import { keyframeInterval, rawFrameBytes } from './encoder'

it('关键帧每半秒一个，剪辑里跳转最多从半秒前解起', () => {
  expect([24, 30, 60].map(keyframeInterval)).toEqual([12, 15, 30])
})

it('原始帧字节数：BGRA 每像素 4 字节，NV12 1.5 字节', () => {
  expect(rawFrameBytes(3840, 2462, 'bgra')).toBe(3840 * 2462 * 4)
  expect(rawFrameBytes(3842, 2466, 'nv12')).toBe(3842 * 2466 * 3 / 2)
})
