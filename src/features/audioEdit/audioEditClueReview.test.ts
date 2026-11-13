import { describe, expect, it } from 'vitest'
import { applyAudioEditSuggestion, chooseAudioEditSuggestionOption } from '@/core/audioEdit/edits'
import type { AudioEditProjectDocument, AudioEditSuggestion, AudioEditTranscriptBlock } from '@/core/audioEdit/types'
import { audioEditClueOptionLabel, audioEditClueReason, buildAudioEditClueRows, chooseAudioEditClueOption, countAudioEditClues } from './audioEditClueReview'
import { describeAudioEditStep } from './workspace/audioEditHistory'

const word = (id: string, text: string, startFrame: number): AudioEditTranscriptBlock => ({ id, text, startFrame, endFrame: startFrame + 400, included: true, locked: false, granularity: 'word' })
const retake = (id: string, blockIds: string[], startFrame: number, endFrame: number): AudioEditSuggestion => ({ id, kind: 'retake', evidence: 'audio', title: '重念', detail: '', startFrame, endFrame, blockIds, confidence: 'high', status: 'pending' })

/**
 * 四处重念加一个语气词：A 待确认（换了说法）、B 已自动删但像口吃、C 已自动删且有把握、E 已自动删但助手标给用户，D 是“嗯”。
 */
function document(): AudioEditProjectDocument {
  const base: AudioEditProjectDocument = {
    id: 'p', name: '口播', source: { mediaType: 'audio', sourcePath: 'D:/a.wav', audioPath: 'D:/a.wav', durationFrames: 6000, sampleRate: 1000, channels: 1 },
    referenceScript: '', createdAt: 0, updatedAt: 0, revision: 1,
    transcript: [word('a1', '我们', 0), word('a2', '先看', 400), word('a3', '我们', 1000), word('a4', '再看', 1400), word('b1', '这个', 2000), word('b2', '这个', 2500),
      word('c1', '然后', 3000), word('c2', '然后', 3500), word('e1', '所以', 4000), word('e2', '所以', 4500), word('f', '嗯', 5000), word('g', '结束', 5400)],
    suggestions: [retake('A', ['a1', 'a2'], 0, 1000), retake('B', ['b1'], 2000, 2500), retake('C', ['c1'], 3000, 3500), retake('E', ['e1'], 4000, 4500),
      { id: 'D', kind: 'filler', title: '嗯', detail: '', startFrame: 5000, endFrame: 5400, blockIds: ['f'], confidence: 'medium', status: 'pending' }],
    suggestionHandoff: {
      A: { reason: 'reworded', score: 0.4, options: [{ id: 'keep_later', blockIds: ['a1', 'a2'], startFrame: 0, endFrame: 1000 }, { id: 'keep_earlier', blockIds: ['a3', 'a4'], startFrame: 900, endFrame: 1800 }, { id: 'keep_both', blockIds: [], startFrame: 0, endFrame: 1000 }] },
      B: { reason: 'stutter', score: 0.9, options: [{ id: 'keep_later', blockIds: ['b1'], startFrame: 2000, endFrame: 2500 }, { id: 'keep_both', blockIds: [], startFrame: 2000, endFrame: 2500 }] },
      C: { reason: 'repeated', score: 0.95, options: [{ id: 'keep_later', blockIds: ['c1'], startFrame: 3000, endFrame: 3500 }, { id: 'keep_both', blockIds: [], startFrame: 3000, endFrame: 3500 }] },
      E: { reason: 'brand_new_reason', score: 0.95, audience: 'user', options: [{ id: 'keep_later', blockIds: ['e1'], startFrame: 4000, endFrame: 4500 }, { id: 'keep_both', blockIds: [], startFrame: 4000, endFrame: 4500 }] },
    },
  }
  return ['B', 'C', 'E'].reduce((draft, id) => applyAudioEditSuggestion(draft, id), base)
}

describe('口播线索面板的分层与改判', () => {
  it('要人定的在最前（助手没处理的待确认、标给用户的），抽看次之，已自动处理与语气词在后；层内按时间', () => {
    const rows = buildAudioEditClueRows(document())
    expect(rows.map((row) => [row.id, row.tier])).toEqual([['A', 'decide'], ['E', 'decide'], ['B', 'check'], ['C', 'auto'], ['D', 'hint']])
    expect(countAudioEditClues(document())).toEqual({ decide: 2, check: 1 })
    expect(rows[0].text).toBe('我们先看')
    expect(rows[0].current).toBeUndefined()
    expect(rows.find((row) => row.id === 'C')?.current).toBe('keep_later')
  })

  it('原因用用户的话说，不认识的原因落到线索类型的通用说法，不露原始值', () => {
    const rows = buildAudioEditClueRows(document())
    expect(rows.find((row) => row.id === 'A')?.reason.label).toBe('念到一半改口')
    expect(rows.find((row) => row.id === 'B')?.reason.label).toBe('口吃或叠词')
    expect(rows.find((row) => row.id === 'E')?.reason.label).toBe('重念')
    expect(rows.find((row) => row.id === 'D')?.reason.label).toBe('语气词')
    expect(audioEditClueReason('long_silence', undefined).label).toBe('停顿过长')
    for (const row of rows) expect(row.reason.label).not.toMatch(/[a-z_]/)
  })

  it('做法按结果命名，换切点有几种时编号', () => {
    expect(buildAudioEditClueRows(document())[0].options.map((option) => option.label)).toEqual(['留后一遍', '留前一遍', '两遍都留'])
    expect(audioEditClueOptionLabel('splice_ab', 1, 2)).toBe('换个切点 2')
    expect(audioEditClueOptionLabel('splice_ab')).toBe('换个切点')
    expect(audioEditClueOptionLabel('something_else')).toBe('另一种剪法')
  })

  it('改判重念与助手写 chosen_option 是同一份操作；人定了标给用户的那条就不再等人', () => {
    const original = document()
    const earlier = chooseAudioEditClueOption(original, 'A', 'keep_earlier')
    expect(earlier).toEqual(chooseAudioEditSuggestionOption(original, 'A', 'keep_earlier'))
    expect(earlier.transcript.filter((block) => !block.included).map((block) => block.id)).toEqual(['a3', 'a4', 'b1', 'c1', 'e1'])
    const both = chooseAudioEditClueOption(original, 'E', 'keep_both')
    expect(both.suggestionHandoff?.E?.audience).toBeUndefined()
    expect(both.suggestionHandoff?.E?.chosen).toBe('keep_both')
    expect(both.transcript.find((block) => block.id === 'e1')?.included).toBe(true)
    expect(countAudioEditClues(both)).toEqual({ decide: 1, check: 1 })
    expect(buildAudioEditClueRows(both).find((row) => row.id === 'E')).toMatchObject({ tier: 'auto', current: 'keep_both' })
  })

  it('语气词只有删掉与保留；做不成时原样返回', () => {
    const original = document()
    const [, deleteOption, keepOption] = [null, ...buildAudioEditClueRows(original).find((row) => row.id === 'D')!.options]
    const removed = chooseAudioEditClueOption(original, 'D', deleteOption!.id)
    expect(removed.transcript.find((block) => block.id === 'f')?.included).toBe(false)
    expect(chooseAudioEditClueOption(removed, 'D', keepOption!.id)).toBe(removed)
    expect(chooseAudioEditClueOption(original, 'missing', 'keep_later')).toBe(original)
  })

  it('这次改判过的行固定在原来那一层，不随改判跳走；计数仍按真实分层', () => {
    const changed = chooseAudioEditClueOption(document(), 'A', 'keep_earlier')
    expect(buildAudioEditClueRows(changed).find((row) => row.id === 'A')?.tier).toBe('check')
    expect(buildAudioEditClueRows(changed, new Map([['A', 'decide']]))[0]).toMatchObject({ id: 'A', tier: 'decide', current: 'keep_earlier' })
    expect(countAudioEditClues(changed)).toEqual({ decide: 1, check: 2 })
  })

  it('历史记录里改判一步按做法命名，不叫“删除”“恢复”', () => {
    const original = document()
    expect(describeAudioEditStep(original, chooseAudioEditClueOption(original, 'A', 'keep_earlier'))).toBe('线索改为留前一遍')
    expect(describeAudioEditStep(original, chooseAudioEditClueOption(original, 'C', 'keep_both'))).toBe('线索改为两遍都留')
    expect(describeAudioEditStep(original, chooseAudioEditClueOption(original, 'D', 'hint:apply'))).toBe('线索改为删掉')
  })
})
