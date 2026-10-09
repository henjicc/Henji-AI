import { describe, expect, it } from 'vitest'
import { planGaussian } from './gaussianPlan'

describe('后端无关的高斯计划', () => {
  it('极小 sigma 只复制到目标尺寸，不分配降采样工序', () => {
    expect(planGaussian({ width: 17, height: 19, sigmaX: 0.299, sigmaY: 0, repeatEdges: false, targetSize: { width: 31, height: 37 } })).toEqual({
      downsampleLevels: 0,
      passes: [{ kind: 'copy', sourceWidth: 17, sourceHeight: 19, width: 31, height: 37 }],
    })
  })
  it('保留 0.3 阈值，最终 blur 的目标尺寸不改变输入取样尺寸', () => {
    expect(planGaussian({ width: 17, height: 19, sigmaX: 0, sigmaY: 0.3, repeatEdges: false, targetSize: { width: 31, height: 37 } })).toEqual({
      downsampleLevels: 0,
      passes: [{ kind: 'blur', sourceWidth: 17, sourceHeight: 19, width: 31, height: 37, axis: 'y', sigma: 0.3, radius: 1, repeatEdges: false }],
    })
  })
  it('按轴降采样、奇数尺寸向上取整，扣除重采样方差并按 x/y 顺序滤波', () => {
    expect(planGaussian({ width: 33, height: 17, sigmaX: 6, sigmaY: 1, repeatEdges: true })).toEqual({
      downsampleLevels: 1,
      passes: [
        { kind: 'downsample', sourceWidth: 33, sourceHeight: 17, width: 17, height: 17 },
        { kind: 'blur', sourceWidth: 17, sourceHeight: 17, width: 17, height: 17, axis: 'x', sigma: Math.sqrt(36 - 0.25 - 4 / 6) / 2, radius: 9, repeatEdges: true },
        { kind: 'blur', sourceWidth: 17, sourceHeight: 17, width: 17, height: 17, axis: 'y', sigma: 1, radius: 3, repeatEdges: true },
        { kind: 'upsample', sourceWidth: 17, sourceHeight: 17, width: 33, height: 17 },
      ],
    })
  })
  it('单轴模糊不会缩小或滤波另一轴，仍回到指定目标尺寸', () => {
    const plan = planGaussian({ width: 1921, height: 1081, sigmaX: 0, sigmaY: 30, repeatEdges: false })
    expect(plan.downsampleLevels).toBe(4)
    expect(plan.passes.every(pass => pass.width === 1921 && pass.sourceWidth === 1921)).toBe(true)
    expect(plan.passes.filter(pass => pass.kind === 'blur').map(pass => pass.axis)).toEqual(['y'])
    expect(plan.passes.at(-1)).toEqual({ kind: 'upsample', sourceWidth: 1921, sourceHeight: 68, width: 1921, height: 1081 })
  })
  it('保留七级金字塔与核半径 32 的技术预算，小尺寸轴不能继续对半缩小', () => {
    const large = planGaussian({ width: 65537, height: 32769, sigmaX: 2000, sigmaY: 1000, repeatEdges: true })
    expect(large.downsampleLevels).toBe(7)
    expect(large.passes.filter(pass => pass.kind === 'blur').map(pass => pass.radius)).toEqual([32, 24])
    expect(large.passes).toHaveLength(10)
    const narrow = planGaussian({ width: 15, height: 2161, sigmaX: 60, sigmaY: 60, repeatEdges: true })
    expect(narrow.downsampleLevels).toBe(5)
    expect(narrow.passes.every(pass => pass.width === 15 && pass.sourceWidth === 15)).toBe(true)
    expect(narrow.passes.find(pass => pass.kind === 'blur')).toMatchObject({ axis: 'x', sigma: 60, radius: 32 })
  })
})
