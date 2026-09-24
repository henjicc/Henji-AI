import { describe, expect, it } from 'vitest'
import { compareModelsBySeries, type SeriesSortable } from './modelSortOrder'

describe('模型系列排序', () => {
  it('保留系列顺序、版本降序、缺省版本和同名稳定顺序', () => {
    const models: SeriesSortable[] = [
      { id: 'b-old', name: 'Old', seriesId: 'b', seriesRank: 1 },
      { id: 'a-missing', name: 'Zulu', seriesId: 'a' },
      { id: 'a-new', name: 'New', seriesId: 'a', seriesRank: 2 },
      { id: 'standalone', name: 'Aardvark' },
      { id: 'a-zero', name: 'Alpha', seriesId: 'a', seriesRank: 0 },
      { id: 'a-tie', name: 'new', seriesId: 'a', seriesRank: 2 },
    ]
    expect(models.sort(compareModelsBySeries).map(model => model.id)).toEqual([
      'a-new', 'a-tie', 'a-zero', 'a-missing', 'b-old', 'standalone',
    ])
  })

  it('系列及名称比较均保留原有英语 base 排序的 Unicode 语义', () => {
    const names = ['Alpha', 'alpha', 'álpha', 'ä', 'a', 'Z', '10', '2', '中', '😀', 'a-b', 'a_b', '']
    for (const left of names) for (const right of names) {
      const expected = Math.sign(left.localeCompare(right, 'en', { sensitivity: 'base' }))
      expect(Math.sign(compareModelsBySeries({ id: left, name: '' }, { id: right, name: '' }))).toBe(expected)
      expect(Math.sign(compareModelsBySeries(
        { id: 'first', name: left, seriesId: 'same' },
        { id: 'second', name: right, seriesId: 'same' },
      ))).toBe(expected)
    }
  })
})
