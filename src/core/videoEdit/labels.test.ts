import { describe, expect, it } from 'vitest'
import { videoEditClipLabel, videoEditLabelOf } from './labels'

describe('片段标签色（重要记录 019）', () => {
  const document = {
    items: [
      { id: 'v', kind: 'video' }, { id: 'labelled', kind: 'video', label: 'rose' as const }, { id: 'g', kind: 'graphic' },
      { id: 'nest', kind: 'sequence', sequenceId: 's' }, { id: 'nest-plain', kind: 'sequence', sequenceId: 'plain' },
    ],
    sequences: [{ id: 's', label: 'yellow' as const }, { id: 'plain' }],
  }
  it('没设标签时按片段类型取默认：链接的声音部分取音频色，图形洋红，字幕芒果黄', () => {
    expect(videoEditClipLabel(document, { itemId: 'v', kind: 'video' })).toBe('iris')
    expect(videoEditClipLabel(document, { itemId: 'v', kind: 'video', sourceComponent: 'audio' })).toBe('caribbean')
    expect(videoEditClipLabel(document, { itemId: 'g', kind: 'graphic' })).toBe('magenta')
    expect(videoEditClipLabel(document, { itemId: 'nest-plain', kind: 'sequence' })).toBe('forest')
    expect(videoEditLabelOf('caption')).toBe('mango')
  })
  it('素材或嵌套的序列设了标签时，画面与声音部分都跟着它', () => {
    expect(videoEditClipLabel(document, { itemId: 'labelled', kind: 'video' })).toBe('rose')
    expect(videoEditClipLabel(document, { itemId: 'labelled', kind: 'audio', sourceComponent: 'audio' })).toBe('rose')
    expect(videoEditClipLabel(document, { itemId: 'nest', kind: 'sequence' })).toBe('yellow')
  })
})
