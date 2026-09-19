import { sourceFrameToOutputFrame } from './timeline'
import type { AudioEditTimelineSpan, AudioEditTranscriptBlock } from './types'

function formatSrtTimestamp(frame: number, sampleRate: number): string {
  const totalMs = Math.max(0, Math.round(frame * 1_000 / Math.max(1, sampleRate)))
  const hours = Math.floor(totalMs / 3_600_000)
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000)
  const seconds = Math.floor((totalMs % 60_000) / 1_000)
  const milliseconds = totalMs % 1_000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`
}

export function buildAudioEditSrt(
  blocks: readonly AudioEditTranscriptBlock[],
  spans: readonly AudioEditTimelineSpan[],
  sampleRate: number,
): string {
  const cues = blocks.flatMap((block) => {
    if (!block.included) return []
    const start = sourceFrameToOutputFrame(block.startFrame, spans)
    const end = sourceFrameToOutputFrame(Math.max(block.startFrame, block.endFrame - 1), spans)
    if (start === null || end === null) return []
    return [{ text: block.text.trim(), start, end: Math.max(start + 1, end + 1) }]
  }).filter((cue) => cue.text.length > 0)

  return cues.map((cue, index) => [
    String(index + 1),
    `${formatSrtTimestamp(cue.start, sampleRate)} --> ${formatSrtTimestamp(cue.end, sampleRate)}`,
    cue.text,
    '',
  ].join('\n')).join('\n')
}
