import { describe, expect, it } from 'vitest'
import {
  buildAudioEditTimeline,
  editedDurationFrames,
  findTranscriptBlockAtSourceFrame,
  nextRetainedSourceFrame,
  outputFrameToSourceFrame,
  sourceFrameToOutputFrame,
} from './timeline'
import { analyzeAudioEditTranscript } from './analysis'
import { buildAudioEditSrt } from './subtitles'
import type { AudioEditTranscriptBlock } from './types'

function block(id: string, startFrame: number, endFrame: number, included = true, text = id): AudioEditTranscriptBlock {
  return { id, text, startFrame, endFrame, included, locked: false, granularity: 'word' }
}

describe('audio edit timeline', () => {
  it('merges removed intervals and preserves source/output mapping', () => {
    const blocks = [block('a', 10, 20, false), block('b', 18, 30, false), block('c', 50, 60, false)]
    const spans = buildAudioEditTimeline(100, blocks)
    expect(spans).toEqual([
      { sourceStartFrame: 0, sourceEndFrame: 10, outputStartFrame: 0, outputEndFrame: 10 },
      { sourceStartFrame: 30, sourceEndFrame: 50, outputStartFrame: 10, outputEndFrame: 30 },
      { sourceStartFrame: 60, sourceEndFrame: 100, outputStartFrame: 30, outputEndFrame: 70 },
    ])
    expect(editedDurationFrames(spans)).toBe(70)
    expect(outputFrameToSourceFrame(15, spans)).toBe(35)
    expect(sourceFrameToOutputFrame(35, spans)).toBe(15)
    expect(sourceFrameToOutputFrame(20, spans)).toBeNull()
    expect(nextRetainedSourceFrame(20, spans)).toBe(30)
  })

  it('does not highlight removed blocks in edited mode', () => {
    const blocks = [block('kept', 0, 10), block('removed', 10, 20, false)]
    expect(findTranscriptBlockAtSourceFrame(15, blocks, false)).toBeNull()
    expect(findTranscriptBlockAtSourceFrame(15, blocks, true)?.id).toBe('removed')
  })

  it('detects fillers and long gaps without applying them', () => {
    const suggestions = analyzeAudioEditTranscript([
      block('a', 0, 100, true, '嗯'),
      block('b', 1_000, 1_100, true, '那个'),
    ], { sampleRate: 1_000 })
    expect(suggestions.map((item) => [item.kind, item.confidence, item.status])).toEqual([
      ['filler', 'high', 'pending'],
      ['long_silence', 'high', 'pending'],
      ['filler', 'low', 'pending'],
    ])
  })

  it('builds subtitles from the edited timeline', () => {
    const blocks = [block('保留', 0, 1_000), block('删除', 1_000, 2_000, false), block('继续', 2_000, 3_000)]
    const spans = buildAudioEditTimeline(3_000, blocks)
    const srt = buildAudioEditSrt(blocks, spans, 1_000)
    expect(srt).toContain('00:00:00,000 --> 00:00:01,000')
    expect(srt).toContain('00:00:01,000 --> 00:00:02,000')
    expect(srt).not.toContain('删除')
  })
})
