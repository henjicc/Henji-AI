import { expect, it } from 'vitest'
import { VIDEO_EDIT_DEFAULT_PLAYBACK_RESOLUTION, videoEditOutputRenderDivisor, videoEditPlaybackResolutionSchema, videoEditPreviewDivisor, videoEditRenderSize } from './playbackResolution'

it('播放用所选分辨率，暂停默认回到完整；选“暂停时也用此分辨率”后暂停也保持', () => {
  expect(videoEditPreviewDivisor(VIDEO_EDIT_DEFAULT_PLAYBACK_RESOLUTION, true)).toBe(1)
  expect(videoEditPreviewDivisor({ resolution: 'quarter', fullWhenPaused: true }, true)).toBe(4)
  expect(videoEditPreviewDivisor({ resolution: 'quarter', fullWhenPaused: true }, false)).toBe(1)
  expect(videoEditPreviewDivisor({ resolution: 'eighth', fullWhenPaused: false }, false)).toBe(8)
  expect(videoEditPreviewDivisor({ resolution: 'half', fullWhenPaused: false }, true)).toBe(2)
})

it('渲染尺寸按倍数缩小并保持比例，至少 1 像素；未知取值被拒绝', () => {
  expect(videoEditRenderSize(3840, 2160, 1)).toEqual({ width: 3840, height: 2160 })
  expect(videoEditRenderSize(3840, 2160, 8)).toEqual({ width: 480, height: 270 })
  expect(videoEditRenderSize(1080, 1920, 4)).toEqual({ width: 270, height: 480 })
  expect(videoEditRenderSize(4, 4, 8)).toEqual({ width: 1, height: 1 })
  expect(videoEditPlaybackResolutionSchema.safeParse({ resolution: '1/3', fullWhenPaused: true }).success).toBe(false)
  expect(videoEditPlaybackResolutionSchema.safeParse({ resolution: 'half', fullWhenPaused: true, extra: 1 }).success).toBe(false)
})

it('连续输出比例支持非整数缩小与放大，舍入后至少一个像素', () => {
  expect(videoEditRenderSize(3840, 2160, 1.5)).toEqual({ width: 2560, height: 1440 })
  expect(videoEditRenderSize(4096, 2160, 4.096)).toEqual({ width: 1000, height: 527 })
  expect(videoEditRenderSize(1920, 1080, .5)).toEqual({ width: 3840, height: 2160 })
  for (const divisor of [0, -1, NaN, Infinity]) expect(() => videoEditRenderSize(1920, 1080, divisor)).toThrow()
})

it('放大高分辨率作者和子序列时保持纹理能力范围内的采样', () => {
  expect(videoEditOutputRenderDivisor(1920, 1080, 2)).toBe(.5)
  expect(videoEditRenderSize(8192, 4320, videoEditOutputRenderDivisor(8192, 4320, 2))).toEqual({ width: 8192, height: 4320 })
  expect(videoEditRenderSize(4320, 8192, videoEditOutputRenderDivisor(4320, 8192, 2))).toEqual({ width: 4320, height: 8192 })
  expect(videoEditRenderSize(7680, 4320, videoEditOutputRenderDivisor(7680, 4320, 2))).toEqual({ width: 7680, height: 4320 })
  expect(videoEditOutputRenderDivisor(8192, 4320, 2 / 3)).toBe(1.5)
})
