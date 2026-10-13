import { afterEach, describe, expect, it, vi } from 'vitest'
import { formatReleaseDate } from './updateChecker'
afterEach(() => { vi.useRealTimers() })
describe('发布日期按界面语言格式化', () => {
  it.each(['en-US', 'zh-CN'])('%s 的天、周、月与绝对日期', (locale) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-13T12:00:00Z'))
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    for (const [days, amount, unit] of [[0, 0, 'day'], [1, -1, 'day'], [3, -3, 'day'], [14, -2, 'week'], [60, -2, 'month']] as const) {
      const date = new Date(Date.now() - days * 86400000)
      expect(formatReleaseDate(date.toISOString(), locale)).toBe(relative.format(amount, unit))
    }
    const old = new Date('2025-03-01T12:00:00Z')
    expect(formatReleaseDate(old.toISOString(), locale)).toBe(old.toLocaleDateString(locale))
  })
})
