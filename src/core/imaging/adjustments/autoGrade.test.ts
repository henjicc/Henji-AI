import { describe, expect, it } from 'vitest'
import { analyzeAutoGrade, combineIlluminantVotes, suggestAutoGrade, suggestColorGradeMklMatch } from './autoGrade'
import { suggestColorGradeMatch } from './analysis'
import { applyEvaluationCast, createEvaluationScenes, evaluateAutoGrade, evaluationCases, summarizeEvaluation } from './autoGradeEvaluation'

describe('本地自动校色（评测集验收）', () => {
  it('曝光与白平衡投票优于不校正，也优于旧的灰世界+百分位拉伸（基线 15.85 / 不校正 11.18）', () => {
    const cases = evaluationCases()
    const result = summarizeEvaluation(evaluateAutoGrade(pixels => suggestAutoGrade(pixels, { scale: 1, width: 96 }), cases))
    const none = summarizeEvaluation(evaluateAutoGrade(() => ({}), cases))
    expect(result.failures).toBe(0)
    expect(result.meanDeltaE).toBeLessThan(7.5); expect(result.meanDeltaE).toBeLessThan(none.meanDeltaE * .7)
    expect(result.meanAbsEv).toBeLessThan(.4)
  })
  it('估计器一致时全量校正，分歧大时只做部分校正；低调夜景不被硬拉到中灰', () => {
    expect(combineIlluminantVotes([{ method: 'gray_world', kelvin: 3200, duv: 0 }, { method: 'white_patch', kelvin: 3250, duv: 0 }, { method: 'gray_edge', kelvin: 3180, duv: 0 }]).strength).toBeGreaterThan(.9)
    expect(combineIlluminantVotes([{ method: 'gray_world', kelvin: 2600, duv: 0 }, { method: 'white_patch', kelvin: 9000, duv: .01 }, { method: 'gray_edge', kelvin: 5000, duv: -.01 }]).strength).toBeLessThan(.6)
    const night = createEvaluationScenes()[3]
    const analysis = analyzeAutoGrade(applyEvaluationCast(night, { kelvin: 6500, tint: 0, ev: 0 }), { scale: 1, width: night.width })
    expect(analysis.key).toBe('low'); expect(analysis.exposure).toBeLessThan(1.5)
  })
  it('OkLab MKL 匹配反拟合为可编辑滑块，比逐通道曲线匹配更接近参考', () => {
    const scenes = createEvaluationScenes(); const casts = [{ kelvin: 3200, tint: 0, ev: 0 }, { kelvin: 9000, tint: 10, ev: -.7 }, { kelvin: 6500, tint: 0, ev: 1 }]
    const cases = scenes.flatMap(scene => casts.map(cast => ({ scene, cast })))
    const run = (match: (pixels: Float32Array, reference: Float32Array) => Record<string, unknown>) => summarizeEvaluation(cases.map(item => {
      const reference = applyEvaluationCast(item.scene, { kelvin: 6500, tint: 0, ev: 0 })
      return evaluateAutoGrade(pixels => match(pixels, reference), [item])[0]
    }))
    const mkl = run((pixels, reference) => suggestColorGradeMklMatch(pixels, reference, 1))
    const moments = run((pixels, reference) => suggestColorGradeMatch(pixels, reference, 'moments', 1))
    expect(mkl.meanDeltaE).toBeLessThan(2.5); expect(mkl.meanDeltaE).toBeLessThan(moments.meanDeltaE)
    const params = suggestColorGradeMklMatch(applyEvaluationCast(scenes[0], casts[0]), applyEvaluationCast(scenes[0], { kelvin: 6500, tint: 0, ev: 0 }), 1)
    expect(params.temperature_kelvin).toBeLessThan(4500)
    expect(Object.keys(params).filter(key => key.startsWith('curve_') && Array.isArray(params[key]) && (params[key] as unknown[]).length)).toEqual([])
  })
})
