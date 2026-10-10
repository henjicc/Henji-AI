import { describe, expect, it } from 'vitest'
import { executeMosaicCpu } from './cpu/mosaic'
import { MOSAIC_EFFECT, mosaicInputRegion, mosaicParameterSchema, resolveMosaicPlan } from './mosaic'
import { requireImagingEffect } from './registry'

describe('共享马赛克', () => {
  it('按完整画面高度表达，两个质量档保持同一网格，拒绝内部像素参数', () => {
    const context = { referenceSize: { width: 3840, height: 2160 }, outputSize: { width: 1920, height: 1080 }, quality: 'interactive' as const }
    expect(resolveMosaicPlan({ block_fraction_height: .02 }, context).blockSize).toBe(22)
    expect(resolveMosaicPlan({ block_fraction_height: .02 }, { ...context, quality: 'final' })).toEqual(resolveMosaicPlan({ block_fraction_height: .02 }, context))
    expect(mosaicParameterSchema.safeParse({ blockSize: 20 }).success).toBe(false)
    expect(requireImagingEffect('mosaic')).toBe(MOSAIC_EFFECT)
  })
  it('零强度保持浮点像素，透明边缘按预乘平均', () => {
    const input = { x: 0, y: 0, width: 2, height: 1, data: new Float32Array([.8,.2,.1,1, 0,0,0,0]) }
    expect(executeMosaicCpu({ blockSize: 1, width: 2, height: 1 }, input, input)).toEqual(input.data)
    expect([...executeMosaicCpu({ blockSize: 2, width: 2, height: 1 }, input, input)]).toEqual([...new Float32Array([.4,.1,.05,.5,.4,.1,.05,.5])])
  })
  it('奇数画面和跨瓦片色块的局部执行等于全图，不允许缺失色块输入', () => {
    const input = { x: 0, y: 0, width: 13, height: 9, data: Float32Array.from({ length: 13 * 9 * 4 }, (_, index) => index % 19 / 19) }
    const plan = { width: 13, height: 9, blockSize: 4 }
    const output = { x: 5, y: 3, width: 7, height: 5 }
    const required = mosaicInputRegion(plan, output)
    const cropped = new Float32Array(required.width * required.height * 4)
    for (let y = 0; y < required.height; y++) cropped.set(input.data.subarray(((required.y + y) * input.width + required.x) * 4, ((required.y + y) * input.width + required.x + required.width) * 4), y * required.width * 4)
    const full = executeMosaicCpu(plan, input, input)
    const partial = executeMosaicCpu(plan, { ...required, data: cropped }, output)
    for (let y = 0; y < output.height; y++) expect(partial.subarray(y * output.width * 4, (y + 1) * output.width * 4)).toEqual(full.subarray(((y + output.y) * input.width + output.x) * 4, ((y + output.y) * input.width + output.x + output.width) * 4))
    expect(() => executeMosaicCpu(plan, { ...output, data: new Float32Array(output.width * output.height * 4) }, output)).toThrow('完整色块')
  })
})
