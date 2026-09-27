import type { AudioEditBatchSettings, AudioEditProjectDocument, AudioEditRange } from './types'

export const DEFAULT_AUDIO_EDIT_SETTINGS: AudioEditBatchSettings = {
  silenceThresholdMs: 800, retainedSilenceMs: 350, noiseDb: -40, trimEdges: false, fillers: ['嗯', '呃', '额'],
}
export const DEFAULT_AUDIO_EDIT_VIEW_SETTINGS = { textSize: 20, sidePadding: 48, timelineCaptions: true }

export function editAudioEditRange(project: AudioEditProjectDocument, range: AudioEditRange, mode: 'delete' | 'mute' | 'restore'): AudioEditProjectDocument {
  const startFrame = Math.max(0, Math.round(Math.min(range.startFrame, range.endFrame)))
  const endFrame = Math.min(project.source.durationFrames, Math.round(Math.max(range.startFrame, range.endFrame)))
  if (!Number.isFinite(startFrame + endFrame) || endFrame <= startFrame) return project
  const parts = subtractRanges([{ startFrame, endFrame }], project.transcript.filter((block) => block.locked))
  if (mode === 'restore') {
    return { ...project, cuts: (project.cuts ?? []).flatMap((cut) => !cut.enabled ? [cut] : subtractRanges([cut], parts).map((part, index) => ({ ...cut, ...part, id: index ? `${cut.id}:${part.startFrame}` : cut.id }))),
      transcript: project.transcript.map((block) => !block.locked && block.startFrame >= startFrame && block.endFrame <= endFrame ? { ...block, included: true } : block) }
  }
  const fresh = subtractRanges(parts, (project.cuts ?? []).filter((cut) => cut.enabled && (cut.mode ?? 'delete') === mode))
  return fresh.length ? { ...project, cuts: [...(project.cuts ?? []), ...fresh.map((part) => ({ ...part, id: crypto.randomUUID(), enabled: true, reason: 'manual' as const, mode }))] } : project
}

/** All edits, including assistant mutations, respect the same protected ranges. */
export function subtractRanges(ranges: readonly AudioEditRange[], protectedRanges: readonly AudioEditRange[]): AudioEditRange[] {
  return protectedRanges.reduce<AudioEditRange[]>((result, protectedRange) => result.flatMap((range) => {
    if (protectedRange.endFrame <= range.startFrame || protectedRange.startFrame >= range.endFrame) return [range]
    return [
      { startFrame: range.startFrame, endFrame: Math.min(range.endFrame, protectedRange.startFrame) },
      { startFrame: Math.max(range.startFrame, protectedRange.endFrame), endFrame: range.endFrame },
    ].filter((part) => part.endFrame > part.startFrame)
  }), [...ranges])
}

export function setAudioEditBlocks(project: AudioEditProjectDocument, ids: readonly string[], included: boolean): AudioEditProjectDocument {
  const selected = new Set(ids)
  return { ...project, transcript: project.transcript.map((block) => selected.has(block.id) && !block.locked ? { ...block, included } : block) }
}

export function applyAudioEditSuggestion(project: AudioEditProjectDocument, id: string): AudioEditProjectDocument {
  const suggestion = project.suggestions.find((item) => item.id === id)
  if (!suggestion || suggestion.status !== 'pending') return project
  let next = project
  if (suggestion.kind === 'long_silence') {
    if (suggestion.evidence !== 'audio') return project
    const settings = project.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
    const retained = Math.round(settings.retainedSilenceMs * project.source.sampleRate / 1000)
    const range = { startFrame: suggestion.startFrame + Math.floor(retained / 2), endFrame: suggestion.endFrame - Math.ceil(retained / 2) }
    if (range.endFrame <= range.startFrame) return project
    // Suggestions intersecting protected speech cannot claim successful application.
    if (project.transcript.some((block) => block.locked && block.startFrame < range.endFrame && block.endFrame > range.startFrame)) return project
    const cuts = project.cuts ?? []
    if (cuts.some((cut) => cut.id === id && cut.enabled)) return project
    next = { ...project, cuts: [...cuts.filter((cut) => cut.id !== id), { ...range, id, reason: 'silence', enabled: true }] }
  } else {
    const targets = project.transcript.filter((block) => suggestion.blockIds.includes(block.id))
    if (suggestion.kind === 'filler' && targets.some((block) => block.granularity !== 'word')) return project
    if (!targets.length || targets.some((block) => block.locked) || targets.every((block) => !block.included)) return project
    next = setAudioEditBlocks(project, suggestion.blockIds, false)
  }
  return { ...next, suggestions: next.suggestions.map((item) => item.id === id ? { ...item, status: 'applied' } : item) }
}

export function cleanAudioEditFillers(project: AudioEditProjectDocument, words: readonly string[], range?: AudioEditRange): AudioEditProjectDocument {
  const fillers = new Set(words.map((word) => word.trim()))
  const ids = project.transcript.filter((block) => block.granularity === 'word' && block.included && !block.locked
    && (!range || (block.startFrame >= range.startFrame && block.endFrame <= range.endFrame))
    && fillers.has(block.text.trim().replace(/[，。！？、,.!?]/g, ''))).map((block) => block.id)
  return ids.length ? setAudioEditBlocks(project, ids, false) : project
}

export function assertAudioEditLocks(previous: AudioEditProjectDocument, next: AudioEditProjectDocument): void {
  for (const cut of next.cuts ?? []) {
    const before = previous.cuts?.find((item) => item.id === cut.id)
    if (cut.enabled && JSON.stringify(before) !== JSON.stringify(cut) && previous.transcript.some((block) => block.locked && block.startFrame < cut.endFrame && block.endFrame > cut.startFrame)) throw new Error('裁切不能覆盖锁定内容。')
  }
  for (const block of previous.transcript.filter((item) => item.locked)) {
    const changed = next.transcript.find((item) => item.id === block.id)
    if (!changed || changed.text !== block.text || changed.included !== block.included || changed.startFrame !== block.startFrame || changed.endFrame !== block.endFrame) throw new Error('锁定内容不能修改，请先解锁。')
  }
}
