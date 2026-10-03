import { describe, expect, it } from 'vitest'
import { formatMediaDuration, formatTaskCreatedAt, joinTaskMeta } from './taskMeta'

describe('生成记录辅助信息行', () => {
  const now = new Date(2026, 9, 3, 18, 0, 0)

  it('今天、昨天用相对日期，今年内省略年份，更早带年份，均不显示秒', () => {
    expect(formatTaskCreatedAt(new Date(2026, 9, 3, 6, 29, 41), 'zh-CN', now)).toBe('今天 06:29')
    expect(formatTaskCreatedAt(new Date(2026, 9, 2, 23, 5, 0), 'zh-CN', now)).toBe('昨天 23:05')
    expect(formatTaskCreatedAt(new Date(2026, 6, 15, 9, 0, 0), 'zh-CN', now)).toBe('7月15日 09:00')
    expect(formatTaskCreatedAt(new Date(2023, 10, 15, 6, 29, 57), 'zh-CN', now)).toBe('2023年11月15日 06:29')
    expect(formatTaskCreatedAt(new Date(2026, 9, 3, 6, 29), 'en-US', now)).toBe('Today 06:29')
    expect(formatTaskCreatedAt(undefined, 'zh-CN', now)).toBe('')
  })

  it('时长读数为 m:ss / h:mm:ss', () => {
    expect(formatMediaDuration(6.2)).toBe('0:06')
    expect(formatMediaDuration(75)).toBe('1:15')
    expect(formatMediaDuration(3723)).toBe('1:02:03')
    expect(formatMediaDuration(Number.NaN)).toBe('')
  })

  it('只连接有值的片段', () => {
    expect(joinTaskMeta(['图片', 'Z-Image Turbo', undefined, '', false, '今天 06:29'])).toBe('图片 · Z-Image Turbo · 今天 06:29')
  })
})
