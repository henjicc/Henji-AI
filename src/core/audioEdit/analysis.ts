import type { AudioEditSuggestion, AudioEditTranscriptBlock } from './types'

const HIGH_CONFIDENCE_FILLERS = new Set(['嗯', '呃', '额'])
const LOW_CONFIDENCE_FILLERS = new Set(['那个', '就是', '啊'])

export function normalizeAudioEditFiller(text: string): string {
  return text.replace(/[\s\p{P}]/gu, '')
}

export function audioEditFillerConfidence(text: string): 'high' | 'low' | null {
  const normalized = normalizeAudioEditFiller(text)
  return HIGH_CONFIDENCE_FILLERS.has(normalized) ? 'high' : LOW_CONFIDENCE_FILLERS.has(normalized) ? 'low' : null
}

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
    const normalized = normalizeAudioEditFiller(block.text)
    const fillerConfidence = audioEditFillerConfidence(block.text)
    if (fillerConfidence && block.granularity === 'word' && block.included && !block.locked) {
      suggestions.push({
        id: `filler:${block.id}`,
        kind: 'filler',
        title: `语气词“${normalized}”`,
        detail: '关键词匹配线索；是否删除由实际上下文决定，不是审批步骤。',
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
