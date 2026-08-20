import { describe, expect, it } from 'vitest'
import {
  assertCameraStageRenderOutputKind,
  assertCameraStageVideoRenderable,
} from './cameraStageRenderValidation'

describe('assertCameraStageRenderOutputKind', () => {
  it('rejects a missing output kind instead of falling through to video', () => {
    expect(() => assertCameraStageRenderOutputKind(undefined)).toThrow('缺少有效的输出类型')
  })

  it('accepts image and video output kinds', () => {
    expect(() => assertCameraStageRenderOutputKind('image')).not.toThrow()
    expect(() => assertCameraStageRenderOutputKind('video')).not.toThrow()
  })
})

describe('assertCameraStageVideoRenderable', () => {
  it('accepts a timed project with at least two state keyframes', () => {
    expect(() => assertCameraStageVideoRenderable(2, 3)).not.toThrow()
  })

  it('rejects a single-frame project instead of creating a zero-second video', () => {
    expect(() => assertCameraStageVideoRenderable(1, 3)).toThrow('应输出图片')
  })

  it('rejects non-positive and invalid video durations', () => {
    expect(() => assertCameraStageVideoRenderable(2, 0)).toThrow('视频时长无效')
    expect(() => assertCameraStageVideoRenderable(2, Number.NaN)).toThrow('视频时长无效')
  })
})
