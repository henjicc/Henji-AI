import type { AudioEditBatchSettings, AudioEditProjectDocument, AudioEditRange, AudioEditSuggestion, AudioEditTranscriptBlock } from './types'
import { normalizeAudioEditFiller } from './analysis'

export const DEFAULT_AUDIO_EDIT_SETTINGS: AudioEditBatchSettings = {
  silenceThresholdMs: 800, retainedSilenceMs: 350, noiseDb: -40, trimEdges: false, fillers: ['嗯', '呃', '额'],
}
export const DEFAULT_AUDIO_EDIT_VIEW_SETTINGS = { textSize: 20, sidePadding: 48, timelineCaptions: true }

export type AudioEditSuggestionState = 'available' | 'removed' | 'dismissed' | 'locked' | 'stale'

/** Suggestions are optional clues. Current edits, not a stored pending flag, determine applicability. */
export function audioEditSuggestionState(project: AudioEditProjectDocument, suggestion: AudioEditSuggestion,
  blocks = new Map(project.transcript.map((block) => [block.id, block])),
  original = new Map(project.editBaseline?.transcript.map((block) => [block.id, block]) ?? []),
): AudioEditSuggestionState {
  const targets = suggestion.blockIds.map((id) => blocks.get(id)).filter((block): block is AudioEditTranscriptBlock => Boolean(block))
  if (suggestion.kind !== 'long_silence' && (!targets.length || targets.length !== suggestion.blockIds.length)) return 'stale'
  if (suggestion.kind === 'filler' && targets.some((block) => block.granularity !== 'word' || !normalizeAudioEditFiller(block.text)
    || (original.has(block.id) && original.get(block.id)!.text !== block.text))) return 'stale'
  if (suggestion.kind === 'filler') {
    const expected = suggestion.title.match(/[「“](.*?)[」”]/)?.[1]
    if (expected && normalizeAudioEditFiller(targets.map((block) => block.text).join('')) !== normalizeAudioEditFiller(expected)) return 'stale'
  }
  const retained = Math.round((project.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS).retainedSilenceMs * project.source.sampleRate / 1000)
  const ranges = suggestion.kind === 'long_silence'
    ? [{ startFrame: suggestion.startFrame + Math.floor(retained / 2), endFrame: suggestion.endFrame - Math.ceil(retained / 2) }]
    : targets.map((block) => ({ startFrame: block.startFrame, endFrame: block.endFrame }))
  if (suggestion.kind === 'long_silence' && suggestion.evidence !== 'audio') return 'stale'
  if (ranges.some((range) => range.endFrame <= range.startFrame || range.startFrame < 0 || range.endFrame > project.source.durationFrames)) return 'stale'
  if (project.transcript.some((block) => block.locked && ranges.some((range) => block.startFrame < range.endFrame && block.endFrame > range.startFrame))) return 'locked'
  const inaudible = [...project.transcript.filter((block) => !block.included && !block.locked), ...(project.cuts ?? []).filter((cut) => cut.enabled)]
  if (!subtractRanges(ranges, inaudible).length) return 'removed'
  if (suggestion.status === 'dismissed') return 'dismissed'
  // If the user restores any part of a previously applied edit, do not propose deleting it again.
  if (suggestion.status === 'applied') return 'stale'
  return 'available'
}

export function audioEditSuggestionStates(project: AudioEditProjectDocument): Map<string, AudioEditSuggestionState> {
  const blocks = new Map(project.transcript.map((block) => [block.id, block]))
  const original = new Map(project.editBaseline?.transcript.map((block) => [block.id, block]) ?? [])
  return new Map(project.suggestions.map((suggestion) => [suggestion.id, audioEditSuggestionState(project, suggestion, blocks, original)]))
}

export function dismissAudioEditSuggestion(project: AudioEditProjectDocument, id: string): AudioEditProjectDocument {
  const suggestion = project.suggestions.find((item) => item.id === id)
  if (!suggestion || audioEditSuggestionState(project, suggestion) !== 'available') return project
  return { ...project, suggestions: project.suggestions.map((item) => item.id === id ? { ...item, status: 'dismissed' } : item) }
}

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
  if (!suggestion || audioEditSuggestionState(project, suggestion) !== 'available') return project
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
    const fresh = subtractRanges([range], [...cuts.filter((cut) => cut.enabled), ...project.transcript.filter((block) => !block.included)])
    if (!fresh.length) return project
    next = { ...project, cuts: [...cuts.filter((cut) => cut.id !== id), ...fresh.map((part, index) => ({ ...part, id: index ? `${id}:${part.startFrame}` : id, reason: 'silence' as const, enabled: true }))] }
  } else {
    const targets = project.transcript.filter((block) => suggestion.blockIds.includes(block.id))
    if (suggestion.kind === 'filler' && targets.some((block) => block.granularity !== 'word')) return project
    if (!targets.length || targets.some((block) => block.locked) || targets.every((block) => !block.included)) return project
    next = setAudioEditBlocks(project, suggestion.blockIds, false)
  }
  return { ...next, suggestions: next.suggestions.map((item) => item.id === id ? { ...item, status: 'applied' } : item) }
}

export function cleanAudioEditFillers(project: AudioEditProjectDocument, words: readonly string[], range?: AudioEditRange): AudioEditProjectDocument {
  const fillers = new Set(words.map(normalizeAudioEditFiller))
  const ids = project.transcript.filter((block) => block.granularity === 'word' && block.included && !block.locked
    && (!range || (block.startFrame >= range.startFrame && block.endFrame <= range.endFrame))
    && fillers.has(normalizeAudioEditFiller(block.text))).map((block) => block.id)
  return ids.length ? setAudioEditBlocks(project, ids, false) : project
}

export function assertAudioEditLocks(previous: AudioEditProjectDocument, next: AudioEditProjectDocument): void {
  for (const cut of next.cuts ?? []) {
    const before = previous.cuts?.find((item) => item.id === cut.id)
    if (cut.enabled && JSON.stringify(before) !== JSON.stringify(cut) && previous.transcript.some((block) => block.locked && block.startFrame < cut.endFrame && block.endFrame > cut.startFrame)) throw new Error('裁切不能覆盖锁定内容。')
  }
  for (const block of previous.transcript.filter((item) => item.locked)) {
    const changed = next.transcript.find((item) => item.id === block.id)
    if (!changed || changed.text !== block.text || changed.included !== block.included || changed.startFrame !== block.startFrame || changed.endFrame !== block.endFrame || changed.captionBreakAfter !== block.captionBreakAfter) throw new Error('锁定内容不能修改，请先解锁。')
  }
}
