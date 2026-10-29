import type { AudioEditBatchSettings, AudioEditCut, AudioEditProjectDocument, AudioEditRange, AudioEditSuggestion, AudioEditTranscriptBlock } from './types'
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
    ? silenceCutRanges(project, suggestion, retained)
    : targets.map((block) => ({ startFrame: block.startFrame, endFrame: block.endFrame }))
  if (suggestion.kind === 'long_silence' && suggestion.evidence !== 'audio') return 'stale'
  if (ranges.some((range) => range.endFrame <= range.startFrame || range.startFrame < 0 || range.endFrame > project.source.durationFrames)) return 'stale'
  if (project.transcript.some((block) => block.locked && ranges.some((range) => block.startFrame < range.endFrame && block.endFrame > range.startFrame))) return 'locked'
  const inaudible = [...project.transcript.filter((block) => !block.included && !block.locked), ...(project.cuts ?? []).filter((cut) => cut.enabled && cut.mode !== 'mute')]
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

/** 呼吸声处理（breath:）与字间气口清理（gap:）的剪辑标识前缀：重跑时整批替换的自动剪辑 */
const AUTOMATIC_EDIT = /^(breath|gap):\d+/

/**
 * 用户手动改了某处自动剪辑（拖边缘、在选区里删、静音、恢复）后，这处就是用户的：同一处的自动剪辑与音量区域改名为手动的，
 * 原标识留一条停用的标记（与“逐处恢复”相同），之后重跑呼吸声、气口处理都跳过这里，不覆盖用户的改动。
 */
export function adoptAudioEditAutomaticEdits(project: AudioEditProjectDocument, range: AudioEditRange): AudioEditProjectDocument {
  const baseOf = (id: string): string | undefined => AUTOMATIC_EDIT.exec(id)?.[0]
  const touched = new Set([...(project.cuts ?? []), ...(project.gainRegions ?? [])]
    .filter((item) => item.enabled && baseOf(item.id) && item.startFrame < range.endFrame && item.endFrame > range.startFrame).map((item) => baseOf(item.id)!))
  if (!touched.size) return project
  const owned = <T extends { id: string; enabled: boolean }>(item: T): boolean => item.enabled && touched.has(baseOf(item.id) ?? '')
  const markers: AudioEditCut[] = [...touched].flatMap((id) => {
    if ((project.cuts ?? []).some((cut) => cut.id === id && !cut.enabled)) return []
    const items = [...(project.cuts ?? []), ...(project.gainRegions ?? [])].filter((item) => baseOf(item.id) === id)
    return [{ id, startFrame: Math.min(...items.map((item) => item.startFrame)), endFrame: Math.max(...items.map((item) => item.endFrame)), reason: 'silence' as const, enabled: false }]
  })
  return {
    ...project,
    cuts: [...(project.cuts ?? []).map((cut) => owned(cut) ? { ...cut, id: `manual:${cut.id}`, reason: 'manual' as const } : cut), ...markers],
    gainRegions: (project.gainRegions ?? []).map((region) => owned(region) ? { ...region, id: `manual:${region.id}` } : region),
  }
}

/**
 * 恢复一段声音时，已删的词按恢复的位置精确处理：整个落在里面的词恢复；只恢复了一部分的词也恢复，
 * 没恢复的那部分改用一刀删除表示，边缘停在用户松手的位置，不跳到字的边界。
 */
function restoreWordsIn(project: AudioEditProjectDocument, startFrame: number, endFrame: number): Pick<AudioEditProjectDocument, 'transcript'> & { cuts: AudioEditCut[] } {
  const touched = (block: AudioEditTranscriptBlock): boolean => !block.locked && !block.included && block.startFrame < endFrame && block.endFrame > startFrame
  const remainder: AudioEditCut[] = project.transcript.filter(touched).flatMap((block) => subtractRanges([block], [{ startFrame, endFrame }])
    .map((part) => ({ id: `manual:${block.id}:${part.startFrame}`, ...part, reason: 'manual' as const, enabled: true })))
  return { transcript: project.transcript.map((block) => touched(block) ? { ...block, included: true } : block), cuts: remainder }
}

export function editAudioEditRange(project: AudioEditProjectDocument, range: AudioEditRange, mode: 'delete' | 'mute' | 'restore'): AudioEditProjectDocument {
  project = adoptAudioEditAutomaticEdits(project, range)
  const startFrame = Math.max(0, Math.round(Math.min(range.startFrame, range.endFrame)))
  const endFrame = Math.min(project.source.durationFrames, Math.round(Math.max(range.startFrame, range.endFrame)))
  if (!Number.isFinite(startFrame + endFrame) || endFrame <= startFrame) return project
  const parts = subtractRanges([{ startFrame, endFrame }], project.transcript.filter((block) => block.locked))
  if (mode === 'restore') {
    const words = restoreWordsIn(project, startFrame, endFrame)
    return { ...project, cuts: [...(project.cuts ?? []).flatMap((cut) => !cut.enabled ? [cut] : subtractRanges([cut], parts).map((part, index) => ({ ...cut, ...part, id: index ? `${cut.id}:${part.startFrame}` : cut.id }))), ...words.cuts],
      transcript: words.transcript }
  }
  const fresh = subtractRanges(parts, (project.cuts ?? []).filter((cut) => cut.enabled && (cut.mode ?? 'delete') === mode))
  return fresh.length ? { ...project, cuts: [...(project.cuts ?? []), ...fresh.map((part) => ({ ...part, id: crypto.randomUUID(), enabled: true, reason: 'manual' as const, mode }))] } : project
}

/**
 * 拖动删除 / 静音区间边缘：只增减这一种处理。add 把它扩到拖过的范围（与另一种重叠就叠加上去）；
 * remove 只撤掉这一种：静音只撤静音剪切，删除撤删除剪切并恢复整段落在里面的词，另一种处理原样保留。
 */
export function adjustAudioEditRangeMode(project: AudioEditProjectDocument, range: AudioEditRange, mode: 'delete' | 'mute', action: 'add' | 'remove'): AudioEditProjectDocument {
  if (action === 'add') return editAudioEditRange(project, range, mode)
  project = adoptAudioEditAutomaticEdits(project, range)
  const startFrame = Math.max(0, Math.round(Math.min(range.startFrame, range.endFrame)))
  const endFrame = Math.min(project.source.durationFrames, Math.round(Math.max(range.startFrame, range.endFrame)))
  if (!Number.isFinite(startFrame + endFrame) || endFrame <= startFrame) return project
  const parts = subtractRanges([{ startFrame, endFrame }], project.transcript.filter((block) => block.locked))
  const matches = (cut: AudioEditCut): boolean => cut.enabled && (cut.mode ?? 'delete') === mode
  const cuts = (project.cuts ?? []).flatMap((cut) => !matches(cut) ? [cut] : subtractRanges([cut], parts).map((part, index) => ({ ...cut, ...part, id: index ? `${cut.id}:${part.startFrame}` : cut.id })))
  if (mode === 'mute') return { ...project, cuts }
  const words = restoreWordsIn(project, startFrame, endFrame)
  return { ...project, cuts: [...cuts, ...words.cuts], transcript: words.transcript }
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

/** 保留长度按成片累计，避免把剪掉的词和停顿算进两头要留的气口。 */
function silenceCutRanges(project: AudioEditProjectDocument, range: AudioEditRange, retained: number): AudioEditRange[] {
  const heard = subtractRanges([range], [
    ...project.transcript.filter((block) => !block.included && !block.locked),
    ...(project.cuts ?? []).filter((cut) => cut.enabled && cut.mode !== 'mute'),
  ]).sort((a, b) => a.startFrame - b.startFrame)
  const length = heard.reduce((total, part) => total + part.endFrame - part.startFrame, 0)
  return sliceAudioEditRanges(heard, Math.floor(retained / 2), length - Math.ceil(retained / 2))
}

/** 区间之间已删的内容不占时间；from/to 是这些区间拼接后的偏移。 */
export function sliceAudioEditRanges(ranges: readonly AudioEditRange[], from: number, to: number): AudioEditRange[] {
  const result: AudioEditRange[] = []
  let cursor = 0
  for (const range of ranges) {
    const length = range.endFrame - range.startFrame
    const start = Math.max(from, cursor), end = Math.min(to, cursor + length)
    if (end > start) result.push({ startFrame: range.startFrame + start - cursor, endFrame: range.startFrame + end - cursor })
    cursor += length
    if (cursor >= to) break
  }
  return result
}

export function setAudioEditBlocks(project: AudioEditProjectDocument, ids: readonly string[], included: boolean): AudioEditProjectDocument {
  const selected = new Set(ids)
  const transcript = project.transcript.map((block) => selected.has(block.id) && !block.locked ? { ...block, included } : block)
  // 恢复重念里的词时，这次重念剪掉的停顿一并恢复，否则恢复的那遍会和后一遍紧贴在一起
  const owners = included && project.cuts?.length
    ? project.suggestions.filter((suggestion) => suggestion.kind === 'retake' && suggestion.status === 'applied' && suggestion.blockIds.some((id) => selected.has(id)))
    : []
  if (!owners.length) return { ...project, transcript }
  return { ...project, transcript, cuts: project.cuts!.filter((cut) => !owners.some((owner) => isRetakePauseCut(cut.id, owner.id))) }
}

const isRetakePauseCut = (cutId: string, suggestionId: string): boolean => cutId === suggestionId || cutId.startsWith(`${suggestionId}:`)

/** 重念删除后剪掉其间与前后的停顿：删除范围里除被删词块与锁定内容以外的部分，id 跟随这条重念。 */
function withRetakePauseCuts(project: AudioEditProjectDocument, suggestion: AudioEditSuggestion, targets: readonly AudioEditTranscriptBlock[]): AudioEditProjectDocument {
  const cuts = (project.cuts ?? []).filter((cut) => !isRetakePauseCut(cut.id, suggestion.id))
  const gaps = subtractRanges([{ startFrame: suggestion.startFrame, endFrame: suggestion.endFrame }],
    [...targets, ...project.transcript.filter((block) => block.locked), ...cuts.filter((cut) => cut.enabled)])
  return gaps.length ? { ...project, cuts: [...cuts, ...gaps.map((gap, index) => ({ ...gap, id: index ? `${suggestion.id}:${gap.startFrame}` : suggestion.id, reason: 'silence' as const, enabled: true }))] } : { ...project, cuts }
}

export function applyAudioEditSuggestion(project: AudioEditProjectDocument, id: string): AudioEditProjectDocument {
  const suggestion = project.suggestions.find((item) => item.id === id)
  if (!suggestion || audioEditSuggestionState(project, suggestion) !== 'available') return project
  let next = project
  if (suggestion.kind === 'long_silence') {
    if (suggestion.evidence !== 'audio') return project
    const settings = project.batchSettings ?? DEFAULT_AUDIO_EDIT_SETTINGS
    const retained = Math.round(settings.retainedSilenceMs * project.source.sampleRate / 1000)
    const ranges = silenceCutRanges(project, suggestion, retained)
    if (!ranges.length) return project
    // Suggestions intersecting protected speech cannot claim successful application.
    if (project.transcript.some((block) => block.locked && ranges.some((range) => block.startFrame < range.endFrame && block.endFrame > range.startFrame))) return project
    const cuts = project.cuts ?? []
    if (cuts.some((cut) => cut.id === id && cut.enabled)) return project
    const fresh = ranges
    if (!fresh.length) return project
    next = { ...project, cuts: [...cuts.filter((cut) => cut.id !== id || cut.reason === 'manual'), ...fresh.map((part, index) => ({ ...part, id: index ? `${id}:${part.startFrame}` : id, reason: 'silence' as const, enabled: true }))] }
  } else {
    const targets = project.transcript.filter((block) => suggestion.blockIds.includes(block.id))
    if (suggestion.kind === 'filler' && targets.some((block) => block.granularity !== 'word')) return project
    if (!targets.length || targets.some((block) => block.locked) || targets.every((block) => !block.included)) return project
    next = setAudioEditBlocks(project, suggestion.blockIds, false)
    if (suggestion.kind === 'retake' && suggestion.evidence === 'audio') next = withRetakePauseCuts(next, suggestion, targets)
  }
  return { ...next, suggestions: next.suggestions.map((item) => item.id === id ? { ...item, status: 'applied' } : item) }
}

export function audioEditFillerBlockIds(blocks: readonly AudioEditTranscriptBlock[], words: readonly string[], range?: AudioEditRange): string[] {
  const fillers = new Set(words.map(normalizeAudioEditFiller))
  return blocks.filter((block) => block.granularity === 'word' && block.included && !block.locked
    && (!range || (block.startFrame >= range.startFrame && block.endFrame <= range.endFrame))
    && fillers.has(normalizeAudioEditFiller(block.text))).map((block) => block.id)
}
export function cleanAudioEditFillers(project: AudioEditProjectDocument, words: readonly string[], range?: AudioEditRange): AudioEditProjectDocument {
  const ids = audioEditFillerBlockIds(project.transcript, words, range)
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
