import { describe, expect, it } from 'vitest'
import { videoEditEffectMask, videoEditShapeMask } from './videoEditEffectMasks'
import { createVideoEditMaskShape } from '@/core/videoEdit/effectMasks'

describe('作用区域蒙版：Worker 分派', () => {
  it('preview/export dispatch samples animated paths independently of a still image analysis clock', async () => {
    const shape = { ...createVideoEditMaskShape('rect', 'animated'), feather: 0 }
    const moved = shape.points.map(p => [p[0] + .2, ...p.slice(1)] as typeof p)
    const pathAnimation = { pointIds: ['a', 'b', 'c', 'd'], keys: [{ sourceTimeUs: 0, points: shape.points, interpolation: 'linear' as const }, { sourceTimeUs: 1e6, points: moved, interpolation: 'linear' as const }] }
    const mask = { regionId: 'shapes' as const, shapes: [{ ...shape, pathAnimation }] }
    const context = { picture: { width: 100, height: 100 }, timeUs: 0 }
    const start = await videoEditEffectMask(mask, { ...context, pathTimeUs: 0 })
    const end = await videoEditEffectMask(mask, { ...context, pathTimeUs: 1e6 })
    const pixel = Math.floor(start!.height * .5) * start!.width + Math.floor(start!.width * .35)
    expect(start!.data[pixel]).toBe(255)
    expect(end!.data[pixel]).toBe(0)
    expect(end!.data).toEqual(videoEditShapeMask([{ ...shape, points: moved }], context.picture).data)
  })
  it('手绘遮罩按片段画面的宽高比栅格化（长边 1024），同一组形状只算一次；智能区域没有素材时返回 undefined', async () => {
    const shapes = [{ id: 's', kind: 'rect' as const, points: [[0,0,0,0,0,0],[.5,0,0,0,0,0],[.5,1,0,0,0,0],[0,1,0,0,0,0]] as import('@/core/videoEdit/effectMasks').VideoEditMaskPoint[], feather: 0 }]
    const portrait = await videoEditEffectMask({ regionId: 'shapes', shapes }, { picture: { width: 1080, height: 1920 }, timeUs: 0 })
    expect(portrait).toMatchObject({ width: 576, height: 1024 })
    expect(portrait!.data[10 * 576 + 10]).toBe(255); expect(portrait!.data[10 * 576 + 400]).toBe(0)
    expect(videoEditShapeMask(shapes, { width: 1080, height: 1920 })).toBe(portrait)
    expect(await videoEditEffectMask({ regionId: 'face' }, { picture: { width: 1920, height: 1080 }, timeUs: 0 })).toBeUndefined()
  })
})
