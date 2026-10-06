import { expect, it } from 'vitest'
import { VIDEO_EDIT_DEFAULT_PLAYBACK_RESOLUTION, videoEditPlaybackResolutionSchema, videoEditPreviewDivisor, videoEditRenderSize } from './playbackResolution'

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
