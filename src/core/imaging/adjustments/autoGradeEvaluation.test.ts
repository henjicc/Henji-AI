import { describe, expect, it } from 'vitest'
import { evaluateAutoGrade, evaluationCases, summarizeEvaluation } from './autoGradeEvaluation'

describe('自动调色评测集', () => {
  const cases = evaluationCases()
  it('覆盖 5 类画面 × 6 种已知偏差，理想反解只剩相机裁切误差', () => {
    expect(cases).toHaveLength(30)
    const oracle = summarizeEvaluation(cases.map(item => evaluateAutoGrade(() => ({ temperature_kelvin: item.cast.kelvin, tint: item.cast.tint, exposure: -item.cast.ev }), [item])[0]))
    expect(oracle.meanAbsEv).toBeLessThan(1e-4)
    expect(oracle.meanDeltaE).toBeLessThan(1)
    const none = summarizeEvaluation(evaluateAutoGrade(() => ({}), cases))
    expect(none.meanDeltaE).toBeGreaterThan(8)
  })
  it('算法失败计入失败数而不是中断评测', () => {
    const result = summarizeEvaluation(evaluateAutoGrade(() => { throw new Error('无法分析') }, cases.slice(0, 2)))
    expect(result.failures).toBe(2)
  })
})
