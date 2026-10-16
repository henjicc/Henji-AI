import { describe, expect, it } from 'vitest'
import { CodeVectorGeometry, dashVectorPaths, supportsCodeVector, vectorRadii, type CodeVector } from './videoEditCodeVectorGeometry'

describe('代码矢量几何', () => {
  it('奇数虚线周期翻倍，跨折点连续，每条子路径重新计相位', () => {
    expect(dashVectorPaths([[[0, 0], [4, 0], [4, 8]], [[10, 0], [18, 0]]], [3])).toEqual([
      [[0, 0], [3, 0]], [[4, 2], [4, 5]], [[10, 0], [13, 0]], [[16, 0], [18, 0]],
    ])
    expect(dashVectorPaths([[[0, 0], [3, 0], [3, 4]]], [5, 2])).toEqual([[[0, 0], [3, 0], [3, 2]]])
  })
  it('闭合路径的首尾可见虚线连接，不在接缝处增加两只线帽', () => {
    const result = dashVectorPaths([[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]], [12, 5], true)
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([[0, 6], [0, 0], [10, 0], [10, 2]])
  })
  it('极小的正虚线仍能向前推进，不能用固定 epsilon 跳过整个周期', () => {
    const result = dashVectorPaths([[[0, 0], [4e-12, 0]]], [1e-12, 1e-12])
    expect(result).toHaveLength(2)
    expect(result[0]).toEqual([[0, 0], [1e-12, 0]])
    expect(result[1][1][0]).toBeCloseTo(3e-12, 20)
  })
  it('几何复用不依赖颜色、透明度和效果，输入几何变动不会读到旧描边', () => {
    const cache = new CodeVectorGeometry()
    const command: CodeVector = { kind: 'path', points: [[[0, 0], [20, 0], [20, 20]]], closed: false, fill: [0, 0, 0, 0], stroke: [1, 0, 0, 1], strokeWidth: 4, lineJoin: 'round' }
    const first = cache.get(command)
    expect(cache.get({ ...command, stroke: [0, 1, 0, 1], opacity: .5, rotation: 45, blur: 3 })).toBe(first)
    expect(first.fill).toHaveLength(12)
    expect(first.stroke.every(Number.isFinite)).toBe(true)
    command.points[0][1][0] = 24
    expect(cache.get(command)).not.toBe(first)
    cache.clear(); expect(cache.get(command)).not.toBe(first)
  })
  it('圆角按 Canvas 四角规则整体缩放', () => {
    const actual = vectorRadii({ kind: 'rect', x: 0, y: 0, width: 40, height: 20, radius: 0, radii: [30, 10, 10, 30], fill: [0, 0, 0, 1] })
    actual.forEach((value, i) => expect(value).toBeCloseTo([10, 10 / 3, 10 / 3, 10][i], 12))
  })
  it('高密虚线和超长路径保留旧栅格回退，不新增作者预算拒绝', () => {
    const line: CodeVector = { kind: 'line', x1: 0, y1: 0, x2: 1000, y2: 0, width: 2, color: [1, 1, 1, 1] }
    expect(supportsCodeVector(line)).toBe(true)
    expect(supportsCodeVector({ ...line, dash: [.00001, .00001] })).toBe(false)
    expect(supportsCodeVector({ ...line, dash: [0, 5] })).toBe(false)
    expect(supportsCodeVector({ kind: 'path', points: [Array.from({ length: 513 }, (_, i) => [i, i % 2])], closed: false, fill: [1, 0, 0, 1] })).toBe(false)
  })
})
