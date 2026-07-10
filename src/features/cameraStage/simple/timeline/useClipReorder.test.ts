import { describe, expect, it } from 'vitest'
import { computeInsertIndex } from './useClipReorder'

// 三个静止块（已排除被拖块自身）的中线分别在 x=50 / 150 / 250
const MIDPOINTS = [
  { shotId: 'a', centerX: 50 },
  { shotId: 'b', centerX: 150 },
  { shotId: 'c', centerX: 250 },
]

describe('computeInsertIndex', () => {
  it('指针在最左侧（早于第一个中线）→ 插到最前', () => {
    expect(computeInsertIndex(MIDPOINTS, -10)).toBe(0)
    expect(computeInsertIndex(MIDPOINTS, 0)).toBe(0)
  })

  it('指针在最右侧（晚于最后一个中线）→ 插到最后', () => {
    expect(computeInsertIndex(MIDPOINTS, 260)).toBe(3)
    expect(computeInsertIndex(MIDPOINTS, 1000)).toBe(3)
  })

  it('指针在相邻两个中线之间 → 插到后一个中线对应下标', () => {
    expect(computeInsertIndex(MIDPOINTS, 100)).toBe(1)
    expect(computeInsertIndex(MIDPOINTS, 200)).toBe(2)
  })

  it('指针恰好等于某中线（严格小于判定）→ 不插到该中线之前', () => {
    expect(computeInsertIndex(MIDPOINTS, 150)).toBe(2)
  })

  it('空数组（只有一个静止块时排除自身后为空）→ 恒为 0', () => {
    expect(computeInsertIndex([], 0)).toBe(0)
    expect(computeInsertIndex([], 999)).toBe(0)
  })

  it('单个候选中线：指针在其左/右分别得到 0/1', () => {
    const single = [{ shotId: 'only', centerX: 50 }]
    expect(computeInsertIndex(single, 10)).toBe(0)
    expect(computeInsertIndex(single, 90)).toBe(1)
  })
})
