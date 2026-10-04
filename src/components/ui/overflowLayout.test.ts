import { describe, expect, it } from 'vitest'

import { resolveOverflowHiddenIds } from './overflowLayout'

const items = [
  { id: 'model', priority: 4000, pinned: true },
  { id: 'mode', priority: 3000, pinned: true },
  { id: 'ratio', priority: 2000 },
  { id: 'duration', priority: 1000 },
  { id: 'audio', priority: 1000 },
  { id: 'search', priority: 1000 },
  { id: 'advanced', priority: 100 },
]
const widths = new Map(items.map((item) => [item.id, 100]))

describe('单行溢出收纳（任务 4.3）', () => {
  it('放得下时不收起', () => {
    expect(resolveOverflowHiddenIds({ items, widths, available: 7 * 100 + 6 * 12, gap: 12, overflowWidth: 80 })).toEqual([])
  })

  it('放不下时先收低优先级的展示分组，再从同档尾部收起，并为“更多”入口预留宽度', () => {
    // 可用 560：pinned 两项 212，再放 ratio(→324)、duration(→436)；audio 需 548 + 入口 92 > 560 → 收起
    expect(resolveOverflowHiddenIds({ items, widths, available: 560, gap: 12, overflowWidth: 80 }))
      .toEqual(['audio', 'search', 'advanced'])
  })

  it('一旦某项放不下，后续低优先级项即使更窄也收起，保持优先级顺序', () => {
    const narrowTail = new Map(widths)
    narrowTail.set('advanced', 10)
    expect(resolveOverflowHiddenIds({ items, widths: narrowTail, available: 560, gap: 12, overflowWidth: 80 }))
      .toEqual(['audio', 'search', 'advanced'])
  })

  it('pinned 项永不收起，即使只剩它们也放不下', () => {
    expect(resolveOverflowHiddenIds({ items, widths, available: 150, gap: 12, overflowWidth: 80 }))
      .toEqual(['ratio', 'duration', 'audio', 'search', 'advanced'])
  })

  it('固定显示“更多”入口时，全部放得下也要给入口留位', () => {
    const available = 7 * 100 + 6 * 12
    expect(resolveOverflowHiddenIds({ items, widths, available, gap: 12, overflowWidth: 80, alwaysShowOverflow: true }))
      .toEqual(['advanced'])
  })
})
