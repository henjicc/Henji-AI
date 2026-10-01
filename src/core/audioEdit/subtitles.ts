import { sourceFrameToOutputFrame } from './timeline'
import { buildAudioEditCaptionGroups, joinAudioEditText } from './captions'
import type { AudioEditTimelineSpan, AudioEditTranscriptBlock } from './types'
import { formatSubtitleTimestampUs } from '../media/subtitleFormat'

function formatSrtTimestamp(frame: number, sampleRate: number): string {
  return formatSubtitleTimestampUs(frame * 1e6 / Math.max(1, sampleRate))
}

export function buildAudioEditSrt(
  blocks: readonly AudioEditTranscriptBlock[],
  spans: readonly AudioEditTimelineSpan[],
  sampleRate: number,
): string {
  const cues = buildAudioEditCaptionGroups(blocks, sampleRate).flatMap((group) => {
    const words = group.blocks.flatMap((block) => {
      if (!block.included) return []
      const start = sourceFrameToOutputFrame(block.startFrame, spans)
      const end = sourceFrameToOutputFrame(Math.max(block.startFrame, block.endFrame - 1), spans)
      if (start === null || end === null) return []
      return [{ text: block.text.trim(), startFrame: start, endFrame: Math.max(start + 1, end + 1) }]
    })
    const first = words[0]
    const last = words.at(-1)
    const text = words.reduce((value, word) => joinAudioEditText(value, word.text), '')
    return first && last && text ? [{ startFrame: first.startFrame, endFrame: last.endFrame, text }] : []
  })
  return cues.map((cue, index) => [
    String(index + 1),
    `${formatSrtTimestamp(cue.startFrame, sampleRate)} --> ${formatSrtTimestamp(cue.endFrame, sampleRate)}`,
    cue.text,
    '',
  ].join('\n')).join('\n')
}
