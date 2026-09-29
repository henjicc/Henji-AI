import type { AudioEditBaseline, AudioEditProjectDocument } from './types'
import { DEFAULT_AUDIO_EDIT_SETTINGS } from './edits'

/** Old documents have no trustworthy original spelling; never invent it. */
export function createAudioEditBaseline(project: AudioEditProjectDocument, kind: AudioEditBaseline['kind']): AudioEditBaseline {
  return {
    kind,
    transcript: project.transcript.map(({ captionBreakAfter: _boundary, ...block }) => ({ ...block, included: true, locked: false })),
    suggestions: project.suggestions.filter((item) => item.kind !== 'long_silence').map((item) => ({ ...item, status: 'pending' })),
  }
}

export function restoreAudioEditBaseline(project: AudioEditProjectDocument): AudioEditProjectDocument {
  const baseline = project.editBaseline ?? createAudioEditBaseline(project, 'legacy')
  return {
    ...project, editBaseline: baseline,
    transcript: baseline.transcript.map((block) => ({ ...block })),
    suggestions: baseline.suggestions.map((item) => ({ ...item, blockIds: [...item.blockIds] })),
    cuts: [], batchSettings: { ...DEFAULT_AUDIO_EDIT_SETTINGS, fillers: [...DEFAULT_AUDIO_EDIT_SETTINGS.fillers] },
    vstEnabled: false, processorChain: [],
  }
}

/** IPC/schema normalization may reorder object keys; that is not an edit. */
export function audioEditContentKey(value: AudioEditProjectDocument): string {
  return JSON.stringify({
    transcript: value.transcript, suggestions: value.suggestions, cuts: value.cuts ?? [],
    batchSettings: value.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS,
    vstEnabled: value.vstEnabled, processorChain: value.processorChain ?? [],
  }, (_key: string, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
    : item)
}

export function hasAudioEditModifications(project: AudioEditProjectDocument): boolean {
  return audioEditContentKey(project) !== audioEditContentKey(restoreAudioEditBaseline(project))
}
