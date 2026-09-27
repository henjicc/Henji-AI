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
  const words = blocks.flatMap((block) => {
    if (!block.included) return []
    const start = sourceFrameToOutputFrame(block.startFrame, spans)
    const end = sourceFrameToOutputFrame(Math.max(block.startFrame, block.endFrame - 1), spans)
    if (start === null || end === null) return []
    return [{ text: block.text.trim(), start, end: Math.max(start + 1, end + 1) }]
  }).filter((cue) => cue.text.length > 0)

  const cues: typeof words = []
  for (const word of words) {
    const previous = cues.at(-1)
    if (previous && !/[。！？.!?]$/.test(previous.text) && word.start - previous.end < sampleRate * 0.6 && word.end - previous.start <= sampleRate * 5 && previous.text.length + word.text.length <= 32) {
      const space = /[a-z0-9]$/i.test(previous.text) && /^[a-z0-9]/i.test(word.text) ? ' ' : ''
      previous.text += space + word.text; previous.end = word.end
    } else cues.push({ ...word })
  }
  return cues.map((cue, index) => [
    String(index + 1),
    `${formatSrtTimestamp(cue.start, sampleRate)} --> ${formatSrtTimestamp(cue.end, sampleRate)}`,
    cue.text,
    '',
  ].join('\n')).join('\n')
}
