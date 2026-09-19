import type { AudioEditSuggestion, AudioEditTranscriptBlock } from './types'

const HIGH_CONFIDENCE_FILLERS = new Set(['嗯', '呃', '啊', '额'])
const LOW_CONFIDENCE_FILLERS = new Set(['那个', '就是'])

export interface AudioEditAnalysisOptions {
  sampleRate: number
  silenceThresholdMs?: number
}

export function analyzeAudioEditTranscript(
  blocks: readonly AudioEditTranscriptBlock[],
  options: AudioEditAnalysisOptions,
): AudioEditSuggestion[] {
  const sampleRate = Math.max(1, Math.round(options.sampleRate))
  const silenceFrames = Math.round((options.silenceThresholdMs ?? 800) * sampleRate / 1_000)
  const ordered = [...blocks].sort((left, right) => left.startFrame - right.startFrame)
  const suggestions: AudioEditSuggestion[] = []

  for (let index = 0; index < ordered.length; index += 1) {
    const block = ordered[index]
    const normalized = block.text.trim().replace(/[，。！？、,.!?]/g, '')
    const fillerConfidence = HIGH_CONFIDENCE_FILLERS.has(normalized)
      ? 'high'
      : LOW_CONFIDENCE_FILLERS.has(normalized)
        ? 'low'
        : null
    if (fillerConfidence) {
      suggestions.push({
        id: `filler:${block.id}`,
        kind: 'filler',
        title: `语气词“${normalized}”`,
        detail: fillerConfidence === 'high' ? '可试听后删除。' : '可能承担真实语义，建议人工确认。',
        startFrame: block.startFrame,
        endFrame: block.endFrame,
        blockIds: [block.id],
        confidence: fillerConfidence,
        status: 'pending',
      })
    }

    const next = ordered[index + 1]
    if (!next) continue
    const gapFrames = next.startFrame - block.endFrame
    if (gapFrames >= silenceFrames) {
      suggestions.push({
        id: `silence:${block.id}:${next.id}`,
        kind: 'long_silence',
        title: '长停顿',
        detail: `停顿约 ${Math.round(gapFrames * 1_000 / sampleRate)} 毫秒，可压缩到约 350 毫秒。`,
        startFrame: block.endFrame,
        endFrame: next.startFrame,
        blockIds: [],
        confidence: 'high',
        status: 'pending',
      })
    }
  }
  return suggestions
}
