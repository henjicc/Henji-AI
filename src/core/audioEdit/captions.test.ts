import { describe, expect, it } from 'vitest'
import type { AudioEditTranscriptBlock } from './types'
import { buildAudioEditCaptionGroups, joinAudioEditText } from './captions'

/** 采样率 1000：帧即毫秒，词一个接一个 */
const blocksOf = (texts: string[]): AudioEditTranscriptBlock[] => texts.map((text, index) => ({
  id: `w${index}`, text, startFrame: index * 200, endFrame: index * 200 + 180, included: true, locked: false, granularity: 'word',
}))

describe('字幕文字拼接', () => {
  it('逐词识别拆开的数字拼回去不加空格，英文词之间仍隔开', () => {
    expect(['2', '0', '0', '0', '次'].reduce(joinAudioEditText, '')).toBe('2000次')
    expect(['发个', 'HTTP', '请求'].reduce(joinAudioEditText, '')).toBe('发个HTTP请求')
    expect(['API', 'Key'].reduce(joinAudioEditText, '')).toBe('API Key')
  })

  it('小数点不当句末断开字幕，句号照常断', () => {
    const groups = buildAudioEditCaptionGroups(blocksOf(['0', '.', '3', '秒', '就', '返回了。', '关键', '是']), 1000)
    expect(groups.map((group) => group.text)).toEqual(['0.3秒就返回了。', '关键是'])
  })
})
