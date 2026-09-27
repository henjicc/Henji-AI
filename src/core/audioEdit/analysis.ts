import type { AudioEditSuggestion, AudioEditTranscriptBlock } from './types'

const HIGH_CONFIDENCE_FILLERS = new Set(['嗯', '呃', '额'])
const LOW_CONFIDENCE_FILLERS = new Set(['那个', '就是', '啊'])

export interface AudioEditAnalysisOptions {
  sampleRate: number
  silenceThresholdMs?: number
}

export function analyzeAudioEditTranscript(
  blocks: readonly AudioEditTranscriptBlock[],
  _options: AudioEditAnalysisOptions,
): AudioEditSuggestion[] {
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
    if (fillerConfidence && block.granularity === 'word') {
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


  }
  return suggestions
}
