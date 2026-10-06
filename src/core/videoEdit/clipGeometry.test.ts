import { describe, expect, it } from 'vitest'
import { videoEditClipPictureSize, videoEditClipToFrame, videoEditFrameToClip } from './clipGeometry'

const frame = { width: 1920, height: 1080 }

describe('片段画面坐标 ↔ 序列画面坐标', () => {
  it('没有移动缩放时，同宽高比的画面坐标就是序列坐标；竖版素材按“适合”居中', () => {
    expect(videoEditClipToFrame({ x: 0, y: 0, scale: 1, rotation: 0 }, frame, frame, 0.25, 0.75)).toEqual({ x: 0.25, y: 0.75 })
    const portrait = videoEditClipToFrame({ x: 0, y: 0, scale: 1, rotation: 0 }, { width: 1080, height: 1920 }, frame, 0, 0)
    // 1080×1920 放进 1920×1080：高 1080，宽 607.5，左边在 (1920 − 607.5) / 2
    expect(portrait.x).toBeCloseTo((1920 - 607.5) / 2 / 1920); expect(portrait.y).toBeCloseTo(0)
  })

  it('与合成器一致：平移按序列宽高比例，顺时针旋转（y 向下），往返一致', () => {
    const placement = { x: 0.1, y: -0.2, scale: 0.5, rotation: 90 }
    // 画面中心在 (0.6, 0.3)；右边中点旋转 90° 后到中心正下方 0.25 × 1920 / 2 像素处
    const center = videoEditClipToFrame(placement, frame, frame, 0.5, 0.5)
    expect(center.x).toBeCloseTo(0.6); expect(center.y).toBeCloseTo(0.3)
    const right = videoEditClipToFrame(placement, frame, frame, 1, 0.5)
    expect(right.x).toBeCloseTo(0.6); expect(right.y).toBeCloseTo(0.3 + 480 / 1080)
    for (const [u, v] of [[0.1, 0.9], [0.7, 0.2], [1.3, -0.4]]) {
      const point = videoEditClipToFrame({ ...placement, rotation: 33 }, { width: 1280, height: 720 }, frame, u, v)
      const back = videoEditFrameToClip({ ...placement, rotation: 33 }, { width: 1280, height: 720 }, frame, point.x, point.y)
      expect(back.u).toBeCloseTo(u); expect(back.v).toBeCloseTo(v)
    }
  })

  it('片段画面尺寸：视频与图片按素材，图形按画布，其余按序列', () => {
    const document = { width: 1920, height: 1080, items: [{ id: 'i', name: 'i', kind: 'video' as const, mediaId: 'm' }], media: [{ id: 'm', name: 'm', path: '/a.mp4', kind: 'video' as const, durationSeconds: 1, width: 720, height: 1280 }] }
    expect(videoEditClipPictureSize(document, { itemId: 'i', kind: 'video' })).toEqual({ width: 720, height: 1280 })
    expect(videoEditClipPictureSize(document, { itemId: 'x', kind: 'text' })).toEqual({ width: 1920, height: 1080 })
  })
})
