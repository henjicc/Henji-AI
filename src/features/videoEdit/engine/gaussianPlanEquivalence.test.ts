import { describe, expect, it } from 'vitest'
import { planColorGrade, type AdjustmentPlan } from '../../../core/imaging/adjustments/plan'
import { colorGradeDefaults } from '../../../core/imaging/adjustments/schema'
import { planVideoEditBuiltinEffect, planVideoEditBuiltinTransition, type VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'

// 固定旧规划器的全部输出字段；每道 pass 单行展示，便于审查数值和纹理编号。
function snapshotPlan(plan: AdjustmentPlan | VideoEditBuiltinPlan): string {
  return [
    JSON.stringify({ width: plan.width, height: plan.height, scratch: plan.scratch }),
    ...plan.passes.map(pass => JSON.stringify({ ...pass, uniforms: Array.from(pass.uniforms) })),
  ].join('\n')
}

const sizes = [
  [1, 1], [15, 17], [17, 19], [15, 2161], [1920, 1080], [1921, 1081], [4097, 2161], [65537, 32769],
] as const

describe('同输入 sigma 的两调用方规划一致性', () => {
  it.each(sizes)('%d×%d 的锐化高斯只有宿主预分配纹理编号不同', (width, height) => {
    const image = planColorGrade({ ...colorGradeDefaults(), sharpen: 30 }, width, height)
    const video = planVideoEditBuiltinEffect({ id: 'sharpen', params: { amount: 30 } }, { width, height, frame: 0 })
    // 图片先分配两个调色 ping/pong，剪辑只分配 blurred；平移编号后比较所有高斯字段。
    const texture = (value: 'input' | 'output' | number): 'input' | 'output' | number => typeof value === 'number' ? value - 2 : value
    const imageGaussian = image.passes.slice(0, image.passes.findIndex(pass => pass.entry === 'unsharp'))
      .map(pass => ({ ...pass, source: texture(pass.source), target: texture(pass.target) }))
    const videoGaussian = video.passes.slice(0, video.passes.findIndex(pass => pass.entry === 'unsharp'))
    expect(imageGaussian).toEqual(videoGaussian)
    expect(image.scratch.slice(2)).toEqual(video.scratch)
  })
})

describe('旧高斯规划逐字段快照（重构前采集，禁止随重构更新）', () => {
  for (const [width, height] of sizes) {
    it(`图片调整 ${width}×${height}：锐化、键控清理及局部锐化`, () => {
      const params = { ...colorGradeDefaults(), sharpen: 30, hsl_temperature: 20, hsl_sharpen: 30, hsl_denoise: 20, hsl_blur: 100 }
      expect(snapshotPlan(planColorGrade(params, width, height))).toMatchSnapshot()
    })
    for (const repeatEdges of [true, false]) {
      it(`剪辑高斯 ${width}×${height}：repeatEdges=${repeatEdges}`, () => {
        expect(snapshotPlan(planVideoEditBuiltinEffect({ id: 'gaussian_blur', params: { strength: 100, repeat_edges: repeatEdges } }, { width, height, frame: 0 }))).toMatchSnapshot()
      })
    }
  }
  for (const strength of [0, 0.001, 0.9, 1, 10, 10.001]) {
    it(`剪辑极小 sigma/直接滤波阈值：strength=${strength}`, () => {
      expect(snapshotPlan(planVideoEditBuiltinEffect({ id: 'gaussian_blur', params: { strength } }, { width: 1001, height: 1000, frame: 0 }))).toMatchSnapshot()
    })
  }
  for (const dimensions of ['horizontal', 'vertical']) {
    it(`非整除尺寸单轴高斯：${dimensions}`, () => {
      expect(snapshotPlan(planVideoEditBuiltinEffect({ id: 'gaussian_blur', params: { strength: 100, dimensions, repeat_edges: false } }, { width: 1921, height: 1081, frame: 0 }))).toMatchSnapshot()
    })
  }
  for (const hslBlur of [0.001, 14.95, 15]) {
    it(`图片键控 sigma=0.3 附近：hsl_blur=${hslBlur}`, () => {
      expect(snapshotPlan(planColorGrade({ ...colorGradeDefaults(), hsl_temperature: 20, hsl_blur: hslBlur }, 101, 100))).toMatchSnapshot()
    })
  }
  for (const id of ['sharpen', 'glow']) {
    it(`剪辑 ${id}：数字源/目标纹理包装`, () => {
      expect(snapshotPlan(planVideoEditBuiltinEffect({ id, params: { radius: 100 } }, { width: 4097, height: 2161, frame: 0 }))).toMatchSnapshot()
    })
  }
  for (const [emptyOutgoing, emptyIncoming] of [[false, false], [true, false], [false, true], [true, true]]) {
    it(`模糊溶解：emptyOutgoing=${emptyOutgoing}, emptyIncoming=${emptyIncoming}`, () => {
      expect(snapshotPlan(planVideoEditBuiltinTransition({ kind: 'blur_dissolve', params: { blur: 100 }, progress: 0.5, emptyOutgoing, emptyIncoming }, { width: 1921, height: 1081 }))).toMatchSnapshot()
    })
  }
})
