import { describe, expect, it } from 'vitest'
import { videoEditEffectMask, videoEditShapeMask } from './videoEditEffectMasks'

describe('作用区域蒙版：Worker 分派', () => {
  it('手绘遮罩按片段画面的宽高比栅格化（长边 1024），同一组形状只算一次；智能区域没有素材时返回 undefined', async () => {
    const shapes = [{ id: 's', kind: 'rect' as const, box: [0, 0, 0.5, 1] as [number, number, number, number], feather: 0 }]
    const portrait = await videoEditEffectMask({ regionId: 'shapes', shapes }, { picture: { width: 1080, height: 1920 }, timeUs: 0 })
    expect(portrait).toMatchObject({ width: 576, height: 1024 })
    expect(portrait!.data[10 * 576 + 10]).toBe(255); expect(portrait!.data[10 * 576 + 400]).toBe(0)
    expect(videoEditShapeMask(shapes, { width: 1080, height: 1920 })).toBe(portrait)
    expect(await videoEditEffectMask({ regionId: 'face' }, { picture: { width: 1920, height: 1080 }, timeUs: 0 })).toBeUndefined()
  })
})
