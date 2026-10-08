import { expect, it } from 'vitest'
import { colorGradeSampleFrames, suggestColorGradeMatch } from './colorGradeMatch'
import { colorGradeCurvePoints, colorGradeSpline } from './colorGradeCurves'
it('均匀采样不出片段，短片段去重，数量有界', () => { expect(colorGradeSampleFrames(10, 100, 5)).toEqual([20, 40, 60, 80, 100]); expect(colorGradeSampleFrames(2, 2, 9)).toEqual([2, 3]); expect(() => colorGradeSampleFrames(0, 100, 10)).toThrow() })
it.each(['moments', 'histogram'] as const)('%s匹配让合成偏色与反差收敛，平坦/透明统计处理有界', method => {
  const source = Array.from({ length: 1024 }, (_, i) => { const v = .3 + i / 1023 * .3; return [v, v * .8, v * 1.1, 1] }).flat()
  const reference = Array.from({ length: 1024 }, (_, i) => { const v = .2 + i / 1023 * .6; return [v, v, v, 1] }).flat()
  const params = suggestColorGradeMatch(source, reference, method, 1)
  const curves = ['red', 'green', 'blue'].map(channel => colorGradeSpline(colorGradeCurvePoints(params, channel)))
  let before = 0; let after = 0
  source.forEach((value, i) => { if (i % 4 === 3) return; before += (value - reference[i]) ** 2; after += (curves[i % 4](value * 100) / 100 - reference[i]) ** 2 })
  expect(after).toBeLessThan(before * .02)
  expect(() => suggestColorGradeMatch(new Float32Array(32), reference, method, 1)).toThrow('可见')
  expect(Object.values(suggestColorGradeMatch(Array.from({ length: 16 }, () => [.4, .4, .4, 1]).flat(), reference, method, 1)).every(value => typeof value !== 'number' || Number.isFinite(value))).toBe(true)
})
