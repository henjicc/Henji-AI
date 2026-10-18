import { describe, expect, it } from 'vitest'
import { mediaContentRecordSchema, mergeMediaContentRanges, queryMediaContentIndex, type MediaContentFact } from './contentIndex'

function word(text: string, index: number, group = 'voice'): MediaContentFact {
  return { id: `word:${index}`, kind: 'transcript', text, ranges: [{ fromUs: index * 100000, toUs: (index + 1) * 100000 }], basis: 'saved', precision: 'word', originRef: { kind: 'audio_edit.document', id: 'voice' }, recordId: `${index}`, transcriptGroup: group }
}

describe('素材内容统一查询', () => {
  it('跨词规范化检索保留原文与不连续源范围，不串接被排除的内容', () => {
    const facts = [word('打开，', 0), word('ＡＩ', 2), word('后台', 3), word('打开', 4, 'after-exclusion'), word('后台', 6, 'another-source')]
    expect(queryMediaContentIndex(facts, { text: '打开 ai 后台' })).toMatchObject([{ text: '打开，ＡＩ后台', ranges: [{ fromUs: 0, toUs: 100000 }, { fromUs: 200000, toUs: 400000 }], precision: 'word' }])
    expect(queryMediaContentIndex(facts, { text: '后台打开' })).toEqual([])
    expect(() => queryMediaContentIndex(facts, { text: '，。' })).toThrow('文字或数字')
  })
  it('浏览长转录自动分块，不改变事实或混淆重复句', () => {
    const facts = Array.from({ length: 1000 }, (_, i) => word('你好', i))
    const before = structuredClone(facts)
    const chunks = queryMediaContentIndex(facts, {})
    expect(chunks.length).toBe(32)
    expect(chunks.every(chunk => chunk.text.length <= 180)).toBe(true)
    expect(chunks.map(chunk => chunk.text).join('')).toBe('你好'.repeat(1000))
    expect(queryMediaContentIndex(facts, { text: '你好' })).toHaveLength(1000)
    expect(facts).toEqual(before)
  })
  it('半开时间范围同时适用于点和区间，只返回指定类型', () => {
    const pause: MediaContentFact = { ...word('静音', 0), kind: 'pause', precision: 'interval' }
    const point: MediaContentFact = { ...word('镜头', 1), kind: 'scene', precision: 'point', ranges: [{ fromUs: 100000, toUs: 100000 }] }
    expect(queryMediaContentIndex([pause, point], { fromUs: 100000, toUs: 200000 })).toMatchObject([{ kind: 'scene' }])
    expect(queryMediaContentIndex([pause, point], { toUs: 100000 })).toMatchObject([{ kind: 'pause' }])
    expect(queryMediaContentIndex([pause, point], { kinds: ['caption'] })).toEqual([])
  })
  it('大正文与大量分散区间显式截断，保留原始数量', () => {
    const fact = { ...word('长'.repeat(5000), 0), kind: 'caption' as const, ranges: Array.from({ length: 200 }, (_, i) => ({ fromUs: i * 10, toUs: i * 10 + 5 })) }
    const result = queryMediaContentIndex([fact], {})[0]
    expect(result).toMatchObject({ textTruncated: true, rangeCount: 200 })
    expect(result.text).toHaveLength(4000); expect(result.ranges).toHaveLength(128)
    expect(mediaContentRecordSchema.safeParse(result).success).toBe(true)
    expect(mergeMediaContentRanges([{ fromUs: 3, toUs: 5 }, { fromUs: 0, toUs: 3 }, { fromUs: 7, toUs: 9 }])).toEqual([{ fromUs: 0, toUs: 5 }, { fromUs: 7, toUs: 9 }])
  })
})
