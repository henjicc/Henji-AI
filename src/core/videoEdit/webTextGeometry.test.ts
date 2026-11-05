import { expect, it } from 'vitest'
import { freezeWebText, webTextImageMapping, webTextSelectors, withWebTextCells, type WebTextGeometry, type WebTextResults } from './webTextGeometry'

const ready = (rects: [number, number, number, number][], writingMode = 'horizontal-tb'): WebTextResults[string] => ({
  status: 'ready',
  geometry: { fonts: [{ writingMode }], graphemes: rects.map(rect => ({ bounds: rect, rects: [{ rect, line: 0 }] })) } as unknown as WebTextGeometry,
})
const cellsOf = (result: WebTextResults[string]) => result.status === 'ready' ? result.geometry.cells! : []

it('格子互不重叠、铺满同一行，多个选择器一起算不会互相切到', () => {
  // 上面一行大标题，下面两个元素排在同一行：盒子之间有间隙，也有压盖。
  const results = withWebTextCells({
    '#title': ready([[100, 100, 80, 100], [170, 100, 80, 100]]),
    '#a': ready([[100, 260, 40, 50]]),
    '#b': ready([[150, 260, 40, 50]]),
  }, webTextImageMapping([0, 0, 1000, 1000], 2000, 2000))
  const title = cellsOf(results['#title']), a = cellsOf(results['#a'])[0]!, b = cellsOf(results['#b'])[0]!
  expect(title[0]![0] + title[0]![2]).toBe(title[1]![0])
  expect(a[0] + a[2]).toBe(b[0])
  // 行间从中点分开：标题的格子不伸进下一行的文字。
  expect(title[0]![1] + title[0]![3]).toBe(460)
  expect(a[1]).toBe(460)
  for (const cell of [...title, a, b]) expect(cell!.every(Number.isInteger)).toBe(true)
})

it('多栏错行、大小字混排、互相压盖时格子仍互不重叠，每个字都有格子且盖住自己', () => {
  const layouts: [number, number, number, number][][] = [
    // 大数字旁边两行小字
    [[100, 90, 100, 100], [210, 100, 80, 20], [210, 130, 80, 20]],
    // 错行的两栏
    [[100, 100, 100, 50], [100, 160, 100, 50], [300, 130, 100, 50]],
    // 互相压盖的宽字
    [[100, 100, 90, 50], [120, 100, 20, 50], [180, 100, 40, 50]],
  ]
  for (const rects of layouts) {
    const cells = cellsOf(withWebTextCells({ '#a': ready(rects) }, webTextImageMapping([0, 0, 1000, 1000], 1000, 1000))['#a'])
    cells.forEach((cell, index) => {
      expect(cell, JSON.stringify(rects)).not.toBeNull()
      cells.slice(index + 1).forEach(other => {
        const apart = cell![0] + cell![2] <= other![0] || other![0] + other![2] <= cell![0] || cell![1] + cell![3] <= other![1] || other![1] + other![3] <= cell![1]
        expect(apart, JSON.stringify({ rects, cell, other })).toBe(true)
      })
    })
  }
  // 没有压盖的布局里，每个字的盒子都完整落在自己的格子里。
  const staggered = layouts[1], cells = cellsOf(withWebTextCells({ '#a': ready(staggered) }, webTextImageMapping([0, 0, 1000, 1000], 1000, 1000))['#a'])
  staggered.forEach((rect, index) => {
    const cell = cells[index]!
    expect(cell[0] <= rect[0] && cell[1] <= rect[1] && cell[0] + cell[2] >= rect[0] + rect[2] && cell[1] + cell[3] >= rect[1] + rect[3]).toBe(true)
  })
})

it('几乎重合的字素切不开时格子归第一个，另一个没有格子，墨迹不会画两遍', () => {
  const [first, second] = cellsOf(withWebTextCells({ '#a': ready([[100, 100, 50, 50], [100, 100, 50, 50.5]]) }, webTextImageMapping([0, 0, 1000, 1000], 1000, 1000))['#a'])
  expect(first).not.toBeNull()
  expect(second).toBeNull()
})

it('紧贴的高窄字素竖着切开，不会被横着切', () => {
  const rects: [number, number, number, number][] = [[100, 100, 40, 170], [140, 100, 40, 170]]
  const [left, right] = cellsOf(withWebTextCells({ '#a': ready(rects) }, webTextImageMapping([0, 0, 1000, 1000], 1000, 1000))['#a'])
  expect(left![0] + left![2]).toBe(140)
  expect(right![0]).toBe(140)
  // 宽窄不一的紧贴字素：切线落在字距上，不落在两个中心的中点。
  const [wide, thin] = cellsOf(withWebTextCells({ '#a': ready([[100, 100, 56, 56], [156, 100, 16, 56]]) }, webTextImageMapping([0, 0, 1000, 1000], 1000, 1000))['#a'])
  expect(wide![0] + wide![2]).toBe(156)
  expect(thin![0]).toBe(156)
  expect(left![1]).toBe(right![1])
  expect(left![3]).toBe(right![3])
})

/** 格子盖住字素盒的比例。 */
const covered = (rect: readonly number[], cell: readonly number[]): number => {
  const w = Math.min(rect[0] + rect[2], cell[0] + cell[2]) - Math.max(rect[0], cell[0]), h = Math.min(rect[1] + rect[3], cell[1] + cell[3]) - Math.max(rect[1], cell[1])
  return Math.max(0, w) * Math.max(0, h) / (rect[2] * rect[3])
}

it('行距比字盒小、宽窄差很多的紧贴字素都不会被切穿', () => {
  const mapping = webTextImageMapping([0, 0, 2000, 2000], 2000, 2000)
  const layouts: [number, number, number, number][][] = [
    // “7%”“100%”：高窄字紧贴宽字
    [[100, 100, 120, 170], [220, 100, 30, 170]],
    [[100, 100, 60, 170], [160, 100, 60, 170], [220, 100, 60, 170], [280, 100, 30, 170]],
    // 两行标题，行距 1.1、字盒 1.32em：上下两行的盒子互相压盖
    Array.from({ length: 16 }, (_, i): [number, number, number, number] => [100 + (i % 8) * 100, 100 + Math.floor(i / 8) * 110, 100, 132]),
    // 三行正文，行距 1.2，错开半个字
    Array.from({ length: 30 }, (_, i): [number, number, number, number] => [100 + (i % 10) * 40 + (Math.floor(i / 10) % 2) * 20, 100 + Math.floor(i / 10) * 48, 40, 53]),
  ]
  for (const rects of layouts) {
    const cells = cellsOf(withWebTextCells({ '#a': ready(rects) }, mapping)['#a'])
    rects.forEach((rect, index) => {
      expect(cells[index], JSON.stringify(rect)).not.toBeNull()
      expect(covered(rect, cells[index]!), JSON.stringify({ rect, cell: cells[index] })).toBeGreaterThan(.8)
    })
  }
})

it('选择器嵌套时同一个字只归第一个，不会画两遍', () => {
  const results = withWebTextCells({ '#a': ready([[100, 100, 50, 50]]), '#a em': ready([[100, 100, 50, 50]]) }, webTextImageMapping([0, 0, 1000, 1000], 1000, 1000))
  expect(cellsOf(results['#a'])[0]).not.toBeNull()
  expect(cellsOf(results['#a em'])).toEqual([null])
})

it('格子限制在画面内；没有位置的字素没有格子，未就绪的结果原样返回', () => {
  const mapping = webTextImageMapping([0, 0, 100, 100], 100, 100)
  const [cell] = cellsOf(withWebTextCells({ '#a': ready([[5, 5, 20, 20]]) }, mapping)['#a'])
  expect(cell![0]).toBe(0); expect(cell![1]).toBe(0)
  expect(cellsOf(withWebTextCells({ '#a': ready([[5, 5, 20, 20]], 'vertical-rl') }, mapping)['#a'])[0]).not.toBeNull()
  expect(cellsOf(withWebTextCells({ '#a': ready([[5, 5, 0, 20]]) }, mapping)['#a'])).toEqual([null])
  expect(withWebTextCells({ '#a': { status: 'not-found' } }, mapping)['#a']).toEqual({ status: 'not-found' })
})

it('使用实际有效图像尺寸换算非零取景，不把 DPR 或名义倍率再乘一次', () => {
  expect(webTextImageMapping([100, 50, 800, 400], 1200, 600).viewportToImage).toEqual([1.5, 0, 0, 1.5, -150, -75])
  const { viewportToImage: m } = webTextImageMapping([100, 50, 801, 401], 1201, 601)
  expect(120 * m[0] + m[4]).toBeCloseTo(20 * 1201 / 801)
  expect(70 * m[3] + m[5]).toBeCloseTo(20 * 601 / 401)
  const value = freezeWebText({ '#a': { status: 'not-found' as const } })
  expect(() => Object.assign(value['#a'], { status: 'ready' })).toThrow()
  expect(webTextSelectors(Array.from({ length: 100 }, (_, i) => `#id${i}`))).toHaveLength(100)
  expect(() => webTextSelectors([null])).toThrow('text')
})
