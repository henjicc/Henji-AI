import { describe, expect, it } from 'vitest'
import { selectTakeSegments } from './takePath'

const segment = (first: number, last: number, weight: number) => ({ first, last, weight })

describe('全局选择删除段', () => {
  it('互相重叠的只选一个，取总分最高的组合，而不是先拿单个最高分', () => {
    // 中间那段单独最高（5），但它挡住了两边加起来更高（4 + 4）的两段
    const chosen = selectTakeSegments(10, [segment(0, 4, 4), segment(3, 7, 5), segment(6, 10, 4)])
    expect(chosen.map(({ first, last }) => [first, last])).toEqual([[0, 4], [6, 10]])
  })

  it('首尾相接的几段可以同时选中（连念几遍），与覆盖同样范围的一整段比总分', () => {
    expect(selectTakeSegments(9, [segment(0, 3, 2), segment(3, 6, 2), segment(0, 6, 3)]).map(({ first, last }) => [first, last])).toEqual([[0, 3], [3, 6]])
    expect(selectTakeSegments(9, [segment(0, 3, 2), segment(3, 6, 2), segment(0, 6, 5)]).map(({ first, last }) => [first, last])).toEqual([[0, 6]])
  })

  it('没有分数、越界或空的段不选，返回的是传入的同一个对象', () => {
    const good = { ...segment(1, 2, 0.05), note: 'keep' }
    const chosen = selectTakeSegments(4, [good, segment(2, 2, 3), segment(2, 6, 3), segment(0, 1, 0), segment(3, 4, -1)])
    expect(chosen).toEqual([good])
    expect(chosen[0]).toBe(good)
  })
})
