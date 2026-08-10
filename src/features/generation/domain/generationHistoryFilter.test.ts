import { describe, expect, it } from 'vitest'

import {
  matchesGenerationHistoryFilter,
  resolveGenerationHistoryTimeRange,
  toGenerationHistoryTimestamp,
  type GenerationHistorySubject,
} from './generationHistoryFilter'

/*
 * 这个谓词由生成页筛选栏与 list_generation_history 共用。
 *
 * 它存在的理由是防止两套语义漂移：补助手侧筛选时若在能力层另写一份判断，关键词搜哪些字段、
 * 时间预设的边界、自定义区间起止填反怎么办这几处早晚不一致，用户会撞上「我筛出 3 条、
 * 助手说只有 1 条」这种谁都说不清的问题。
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-08-11T12:00:00Z').getTime()

function subject(patch: Partial<GenerationHistorySubject> = {}): GenerationHistorySubject {
  return {
    prompt: '一只橘猫坐在窗台上',
    modelId: 'flux-pro',
    modelDisplayName: 'FLUX Pro',
    providerId: 'fal',
    errorText: null,
    mediaType: 'image',
    createdAt: NOW - DAY,
    ...patch,
  }
}

describe('生成历史筛选谓词', () => {
  it('不给任何条件时一律通过', () => {
    expect(matchesGenerationHistoryFilter(subject(), {}, NOW)).toBe(true)
  })

  it('关键词大小写不敏感，且覆盖提示词/模型/供应商/错误信息', () => {
    expect(matchesGenerationHistoryFilter(subject(), { keyword: '橘猫' }, NOW)).toBe(true)
    expect(matchesGenerationHistoryFilter(subject(), { keyword: 'FLUX' }, NOW)).toBe(true)
    expect(matchesGenerationHistoryFilter(subject(), { keyword: 'flux pro' }, NOW)).toBe(true)
    expect(matchesGenerationHistoryFilter(subject(), { keyword: 'FAL' }, NOW)).toBe(true)
    expect(matchesGenerationHistoryFilter(
      subject({ errorText: '余额不足' }), { keyword: '余额' }, NOW,
    )).toBe(true)
    expect(matchesGenerationHistoryFilter(subject(), { keyword: '狗' }, NOW)).toBe(false)
  })

  it('关键词只有空白时视为不筛', () => {
    expect(matchesGenerationHistoryFilter(subject(), { keyword: '   ' }, NOW)).toBe(true)
  })

  it('供应商、模型、媒体类型是精确匹配', () => {
    expect(matchesGenerationHistoryFilter(subject(), { providerId: 'fal' }, NOW)).toBe(true)
    expect(matchesGenerationHistoryFilter(subject(), { providerId: 'ppio' }, NOW)).toBe(false)
    expect(matchesGenerationHistoryFilter(subject(), { modelId: 'flux-pro' }, NOW)).toBe(true)
    expect(matchesGenerationHistoryFilter(subject(), { modelId: 'flux' }, NOW)).toBe(false)
    expect(matchesGenerationHistoryFilter(subject(), { mediaType: 'video' }, NOW)).toBe(false)
  })

  it('相对时间预设按 now 往回算', () => {
    expect(matchesGenerationHistoryFilter(subject({ createdAt: NOW - 3 * DAY }), { timePreset: '7d' }, NOW)).toBe(true)
    expect(matchesGenerationHistoryFilter(subject({ createdAt: NOW - 10 * DAY }), { timePreset: '7d' }, NOW)).toBe(false)
    expect(matchesGenerationHistoryFilter(subject({ createdAt: NOW - 10 * DAY }), { timePreset: '30d' }, NOW)).toBe(true)
  })

  it('自定义区间的起止填反时按用户本意理解，而不是返回空结果', () => {
    const range = resolveGenerationHistoryTimeRange(
      { timePreset: 'custom', startDate: '2026-08-10', endDate: '2026-08-01' }, NOW,
    )
    expect(range.start).not.toBeNull()
    expect(range.end).not.toBeNull()
    expect(range.start as number).toBeLessThan(range.end as number)
  })

  it('自定义区间含首尾整天', () => {
    const criteria = { timePreset: 'custom' as const, startDate: '2026-08-10', endDate: '2026-08-10' }
    const dayStart = new Date(2026, 7, 10, 0, 0, 0, 0).getTime()
    const dayEnd = new Date(2026, 7, 10, 23, 59, 59, 999).getTime()
    expect(matchesGenerationHistoryFilter(subject({ createdAt: dayStart }), criteria, NOW)).toBe(true)
    expect(matchesGenerationHistoryFilter(subject({ createdAt: dayEnd }), criteria, NOW)).toBe(true)
    expect(matchesGenerationHistoryFilter(subject({ createdAt: dayStart - 1 }), criteria, NOW)).toBe(false)
    expect(matchesGenerationHistoryFilter(subject({ createdAt: dayEnd + 1 }), criteria, NOW)).toBe(false)
  })

  it('时间戳读不出来的记录，在有时间条件时被排除、无时间条件时保留', () => {
    expect(matchesGenerationHistoryFilter(subject({ createdAt: null }), { timePreset: '7d' }, NOW)).toBe(false)
    expect(matchesGenerationHistoryFilter(subject({ createdAt: null }), { keyword: '橘猫' }, NOW)).toBe(true)
  })

  it('时间戳能从 Date、数字、字符串三种形态读出来', () => {
    expect(toGenerationHistoryTimestamp(new Date(NOW))).toBe(NOW)
    expect(toGenerationHistoryTimestamp(NOW)).toBe(NOW)
    expect(toGenerationHistoryTimestamp('2026-08-11T12:00:00Z')).toBe(NOW)
    expect(toGenerationHistoryTimestamp('不是时间')).toBeNull()
    expect(toGenerationHistoryTimestamp(undefined)).toBeNull()
  })

  it('多个条件是与的关系', () => {
    const criteria = { keyword: '橘猫', providerId: 'fal', mediaType: 'image' as const, timePreset: '7d' as const }
    expect(matchesGenerationHistoryFilter(subject(), criteria, NOW)).toBe(true)
    expect(matchesGenerationHistoryFilter(subject({ providerId: 'ppio' }), criteria, NOW)).toBe(false)
  })
})
