import { describe, expect, it } from 'vitest'
import { imageColorGradeRuntimeParams, parseImageColorGradeParams } from './schema'
import { LatestAdjustmentPreview } from './latestPreview'
import { applyImageColorGradeV3 } from '../../imageEdit/v3/effects/colorGrade'
import { createFloat32PremultipliedRgbaTile } from '../../imageEdit/v3/effects/contracts'
import { collectImageEditJsonResourceIdsV3 } from '../../imageEdit/v3/resourceReferences'
import { sampleCubeLut } from '../effects/cpu/colorGrade'
import { parseCubeLut } from '../lut/cube'

const source = (data: number[], workingSpace: 'srgb' | 'display-p3' | 'rec2020' = 'srgb') => createFloat32PremultipliedRgbaTile(data.length / 4, 1, 'linear-light', Float32Array.from(data), workingSpace, 'srgb')
describe('共享图片调整契约与 CPU 真值', () => {
  it('曝光按线性光翻倍，保留半透明与 HDR 高光', async () => {
    for (const space of ['srgb', 'display-p3', 'rec2020'] as const) {
      const input = source([.1, .2, .3, .5, 2, 3, 4, 1, 0, 0, 0, 0], space)
      const result = await applyImageColorGradeV3(input, { exposure: 1 })
      input.data.forEach((value, i) => expect(result.data[i]).toBeCloseTo(i % 4 === 3 ? value : value * 2, 5))
      expect(result.workingSpace).toBe(space)
    }
  })
  it('空曲线为中性，结构化曲线闭合校验；静态层拒绝观察和动画字段', () => {
    expect(parseImageColorGradeParams({}).curve_red_points).toEqual([])
    expect(() => parseImageColorGradeParams({ curve_red_points: [{ x: 50, y: 50 }, { x: 20, y: 20 }] })).toThrow()
    expect(() => parseImageColorGradeParams({ hsl_show_mask: true })).toThrow()
    expect(() => parseImageColorGradeParams({ curves: {} })).toThrow()
    expect(() => parseImageColorGradeParams({ exposure: 99 })).toThrow()
    expect(imageColorGradeRuntimeParams({ hsl_show_mask: true }).hsl_show_mask).toBe(true)
  })
  it('LUT 三线性插值、资源引用收集与不明确 HDR 域拒绝', async () => {
    const lut = parseCubeLut('LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1')
    sampleCubeLut(lut, [.23, .45, .78]).forEach((value, i) => expect(value).toBeCloseTo([.23, .45, .78][i], 6))
    const ref = `sha256:${'a'.repeat(64)}`
    const params = parseImageColorGradeParams({ input_lut: ref })
    expect(collectImageEditJsonResourceIdsV3(params)).toEqual([ref])
    const input = source([.2, .4, .1, .5])
    const output = await applyImageColorGradeV3(input, params, undefined, async () => lut)
    input.data.forEach((value, i) => expect(output.data[i]).toBeCloseTo(value, 6))
    await expect(applyImageColorGradeV3(source([.2, .4, .1, .5], 'display-p3'), params)).rejects.toThrow('sRGB')
  })
  it('晕影使用完整文档坐标，分块结果与整图一致', async () => {
    const input = source([.2, .3, .4, 1, .2, .3, .4, 1, .2, .3, .4, 1, .2, .3, .4, 1])
    const params = { vignette_amount: -40 }
    const whole = await applyImageColorGradeV3(input, params)
    const tile = source(Array.from(input.data.slice(8)))
    const region = await applyImageColorGradeV3(tile, params, undefined, undefined, { origin: [2, 0], size: [4, 1] })
    region.data.forEach((value, i) => expect(value).toBeCloseTo(whole.data[i + 8], 6))
  })
  it('一帧只发布最新参数；松手或取消丢弃排队预览', () => {
    const callbacks = new Map<number, () => void>(); const values: number[] = []; let sequence = 0
    const preview = new LatestAdjustmentPreview<number>(callback => { callbacks.set(++sequence, callback); return sequence }, id => { callbacks.delete(id) }, value => values.push(value))
    for (let i = 0; i < 100; i++) preview.update(i)
    expect(callbacks.size).toBe(1)
    callbacks.values().next().value?.(); callbacks.clear()
    expect(values).toEqual([99])
    preview.update(200); preview.cancel()
    expect(callbacks.size).toBe(0); expect(values).toEqual([99])
  })
})
