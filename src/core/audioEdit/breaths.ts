import type { AudioBreath } from '../audioAnalysis/breath/respiro'
import type { AudioEditGainRegion } from './regions'
import { buildProjectAudioEditTimeline, retainedAudioEditWords } from './timeline'
import type { AudioEditCut, AudioEditProjectDocument, AudioEditRange, AudioEditTimelineSpan, AudioEditTranscriptBlock } from './types'

/*
 * 呼吸声的处理：按上下文逐处决定删、减弱、静音还是保留，落成普通的剪切与音量区域（标识以 breath: 开头），
 * 和其他剪辑一样可逐处恢复、一步撤销，不改口播文档格式。
 *
 * 默认“删除”（快节奏）：去掉这口气，两侧原有的安静保留；删完后听到的前后两个字之间不够气口时，
 * 只删前面大半口气、留紧挨下一个字的一小截并减弱 18 dB 凑够，不让字粘在一起；
 * - 气口按剪完后实际听到的空当算：句中 MIN_GAP_MS；句间和重念接缝处（中间删过字）SENTENCE_GAP_MS，
 *   接缝两侧原本就只剩各自停顿的一半，再把这口气删光，两遍会贴在一起；
 * - 有声音能量的停顿证据时只把真正安静的部分（能量低谷与呼吸本身）算作气口：识别的词时间常在连读的两个字
 *   之间留出空当，那段其实有声音，算进去会把气口删光；
 * - 逐口按顺序处理，同一处空当里的几口气共用这点气口；
 * - 和字连在一起（识别的词时间盖住了大半口气）：只减弱不在词里下刀。
 * 位置（句间 / 句中 / 开头结尾）照样标出来，供助手逐处取舍：想保留句中换气的语气时改成减弱。
 * 已被重念、停顿处理剪掉的呼吸不再处理。
 */

export type AudioEditBreathPolicy = 'delete' | 'attenuate' | 'mute' | 'keep'
export type AudioEditBreathContext = 'edge' | 'sentence' | 'clause' | 'touching' | 'removed'
export type AudioEditBreathHandling = 'deleted' | 'attenuated' | 'muted' | 'kept' | 'removed'

export const AUDIO_EDIT_BREATH_ID_PREFIX = 'breath:'
export const AUDIO_EDIT_BREATH_ATTENUATION_DB = -18
const MIN_GAP_MS = 80
const SENTENCE_GAP_MS = 150
const MIN_REGION_MS = 80
const FADE_MS = 15
const LONG_GAP_MS = 800

export interface AudioEditBreathView {
  id: string
  startFrame: number
  endFrame: number
  peak: number
  context: AudioEditBreathContext
  /** 前后保留的文字（各最多 8 字），供人和助手判断上下文 */
  before: string
  after: string
  /** 剪完后两侧词之间实际听到的空当（毫秒，含这口气还保留的部分） */
  gapMs: number
  handling: AudioEditBreathHandling
}

interface Placement {
  id: string
  startFrame: number
  endFrame: number
  peak: number
  context: AudioEditBreathContext
  region: { startFrame: number; endFrame: number } | null
  /** 剪完后两侧词之间实际听到的帧数 */
  gapFrames: number
  /** 删完要留的气口（帧） */
  minGapFrames: number
  previous?: AudioEditTranscriptBlock
  next?: AudioEditTranscriptBlock
}

const breathId = (startFrame: number): string => `${AUDIO_EDIT_BREATH_ID_PREFIX}${startFrame}`
export const isAudioEditBreathEdit = (item: { id: string; reason?: string }): boolean => item.reason !== 'manual' && item.id.startsWith(AUDIO_EDIT_BREATH_ID_PREFIX)

/** 声音能量检测到的安静区间（毫秒），与停顿压缩、去重念共用 */
export interface AudioEditQuietRange { startMs: number; endMs: number }

type FrameRange = { startFrame: number; endFrame: number }

interface PlacementState {
  document: AudioEditProjectDocument
  /** 剪完后还能听到的源区间（含静音段，静音也占时间） */
  heard: AudioEditTimelineSpan[]
  words: AudioEditTranscriptBlock[]
  removedWords: AudioEditTranscriptBlock[]
  /** 真正安静的源区间（能量低谷 ∪ 呼吸），有序不重叠；没有能量证据时为空，按词之间的空当算 */
  quiet?: FrameRange[]
}

function placementState(document: AudioEditProjectDocument, quiet?: FrameRange[]): PlacementState {
  const heard = buildProjectAudioEditTimeline(document)
  return {
    document, heard, quiet,
    words: retainedAudioEditWords(document.transcript, heard),
    removedWords: document.transcript.filter((block) => !block.included && !block.locked),
  }
}

const overlap = (spans: readonly AudioEditTimelineSpan[], start: number, end: number): number =>
  spans.reduce((total, span) => total + Math.max(0, Math.min(end, span.sourceEndFrame) - Math.max(start, span.sourceStartFrame)), 0)

/** 剪完后在 start–end 之间听到的帧数；给了安静区间时只数其中安静的部分。 */
function heardFrames(state: PlacementState, start: number, end: number): number {
  if (!state.quiet) return overlap(state.heard, start, end)
  let total = 0
  for (const range of state.quiet) {
    if (range.endFrame <= start) continue
    if (range.startFrame >= end) break
    total += overlap(state.heard, Math.max(start, range.startFrame), Math.min(end, range.endFrame))
  }
  return total
}

/** 能量低谷与全部呼吸合并成有序不重叠的安静区间（帧）。 */
function quietRanges(document: AudioEditProjectDocument, breaths: readonly AudioBreath[], pauses: readonly AudioEditQuietRange[]): FrameRange[] {
  const { sampleRate } = document.source
  const frames = [...pauses, ...breaths].map((item) => ({ startFrame: Math.round(item.startMs * sampleRate / 1000), endFrame: Math.round(item.endMs * sampleRate / 1000) }))
    .filter((item) => item.endFrame > item.startFrame).sort((a, b) => a.startFrame - b.startFrame)
  const merged: FrameRange[] = []
  for (const item of frames) {
    const last = merged.at(-1)
    if (last && item.startFrame <= last.endFrame) last.endFrame = Math.max(last.endFrame, item.endFrame)
    else merged.push({ ...item })
  }
  return merged
}

function placeBreath(state: PlacementState, breath: AudioBreath): Placement {
  const { sampleRate, durationFrames } = state.document.source
  const { words, heard } = state
  const ms = (frames: number): number => frames * 1000 / sampleRate
  const spans = heard.filter((span) => !span.muted)
  const startFrame = Math.max(0, Math.round(breath.startMs * sampleRate / 1000))
  const endFrame = Math.min(durationFrames, Math.round(breath.endMs * sampleRate / 1000))
  const middle = (startFrame + endFrame) / 2
  const previous = words.filter((word) => (word.startFrame + word.endFrame) / 2 < middle).at(-1)
  const next = words.find((word) => (word.startFrame + word.endFrame) / 2 >= middle)
  const gapStart = previous?.endFrame ?? 0, gapEnd = next?.startFrame ?? durationFrames
  // 还保留着的那一段（被重念、停顿剪掉的部分不再处理），再限制在两侧词之间
  let region: Placement['region'] = null
  for (const span of spans) {
    const from = Math.max(startFrame, span.sourceStartFrame, gapStart), to = Math.min(endFrame, span.sourceEndFrame, gapEnd)
    if (to > from && (!region || to - from > region.endFrame - region.startFrame)) region = { startFrame: from, endFrame: to }
  }
  const keptInBreath = overlap(spans, startFrame, endFrame)
  const gapFrames = heardFrames(state, gapStart, gapEnd)
  let context: AudioEditBreathContext
  // 和字连在一起看的是与保留的词实际重叠多少：识别的词时间常常多出几十毫秒盖到呼吸上，那不算；
  // 一口气有一部分已被重念剪掉时，剩下能听到的部分照常按位置处理
  const wordOverlap = words.reduce((total, word) => total + Math.max(0, Math.min(endFrame, word.endFrame) - Math.max(startFrame, word.startFrame)), 0)
  if (ms(keptInBreath) < MIN_REGION_MS) context = 'removed'
  else if (!region || wordOverlap > 0.3 * (endFrame - startFrame)) context = 'touching'
  else if (!previous || !next) context = 'edge'
  else if (/[。？！；…!?;]$/.test(previous.text.trim()) || ms(gapFrames) >= LONG_GAP_MS) context = 'sentence'
  else context = 'clause'
  if (region && ms(region.endFrame - region.startFrame) < MIN_REGION_MS) region = null
  // 两侧词之间删过字就是接缝：两遍的语气不连着，和句间一样多留一点
  const seam = state.removedWords.some((word) => word.startFrame >= gapStart && word.endFrame <= gapEnd)
  const minGapFrames = Math.round((context === 'sentence' || seam ? SENTENCE_GAP_MS : MIN_GAP_MS) * sampleRate / 1000)
  return { id: breathId(startFrame), startFrame, endFrame, peak: breath.peak, context, region, gapFrames, minGapFrames, previous, next }
}

function placeBreaths(document: AudioEditProjectDocument, breaths: readonly AudioBreath[]): Placement[] {
  const state = placementState(document)
  return breaths.map((breath) => placeBreath(state, breath))
}

function handlingOf(document: AudioEditProjectDocument, placement: Placement): AudioEditBreathHandling {
  // 先看呼吸处理自己的剪切与音量区域：删掉的呼吸本身就落在剪掉的范围里
  const cut = (document.cuts ?? []).find((item) => item.id === placement.id && item.enabled)
  if (cut) return cut.mode === 'mute' ? 'muted' : 'deleted'
  if ((document.gainRegions ?? []).some((item) => item.id === placement.id && item.enabled)) return 'attenuated'
  return placement.context === 'removed' ? 'removed' : 'kept'
}

function textAround(document: AudioEditProjectDocument, placement: Placement): { before: string; after: string } {
  const words = document.transcript.filter((block) => block.included).sort((a, b) => a.startFrame - b.startFrame)
  const index = placement.previous ? words.indexOf(placement.previous) : -1
  const before = words.slice(Math.max(0, index - 5), index + 1).map((word) => word.text).join('').slice(-8)
  const after = words.slice(index + 1, index + 7).map((word) => word.text).join('').slice(0, 8)
  return { before, after }
}

/** 列出呼吸声及其上下文与当前处理（不改文档）。 */
export function describeAudioEditBreaths(document: AudioEditProjectDocument, breaths: readonly AudioBreath[]): AudioEditBreathView[] {
  const { sampleRate } = document.source
  return placeBreaths(document, breaths).map((placement) => ({
    id: placement.id, startFrame: placement.startFrame, endFrame: placement.endFrame, peak: placement.peak, context: placement.context,
    ...textAround(document, placement), gapMs: Math.round(placement.gapFrames * 1000 / sampleRate), handling: handlingOf(document, placement),
  }))
}

/** 按策略与上下文决定一处呼吸怎么处理。 */
export function decideAudioEditBreath(context: AudioEditBreathContext, policy: AudioEditBreathPolicy): 'delete' | 'attenuate' | 'mute' | 'keep' {
  if (context === 'removed' || policy === 'keep') return 'keep'
  if (policy === 'attenuate') return 'attenuate'
  if (policy === 'mute') return context === 'touching' ? 'attenuate' : 'mute'
  return context === 'touching' ? 'attenuate' : 'delete'
}

const attenuation = (id: string, range: { startFrame: number; endFrame: number }, sampleRate: number): AudioEditGainRegion => {
  const fade = Math.min(Math.round(sampleRate * FADE_MS / 1000), Math.floor((range.endFrame - range.startFrame) / 3))
  return { id, startFrame: range.startFrame, endFrame: range.endFrame, enabled: true, gainDb: AUDIO_EDIT_BREATH_ATTENUATION_DB, fadeInFrames: fade, fadeOutFrames: fade }
}

/** 一处呼吸的剪辑：删除时保证剪完后前后的字之间还听得到气口（不够就留下最后一小截减弱）。 */
function breathEdits(placement: Placement, decision: 'delete' | 'attenuate' | 'mute', sampleRate: number): { cuts: AudioEditCut[]; gains: AudioEditGainRegion[]; handling: 'deleted' | 'attenuated' | 'muted' } {
  const region = placement.region!
  if (decision === 'attenuate') return { cuts: [], gains: [attenuation(placement.id, region, sampleRate)], handling: 'attenuated' }
  if (decision === 'mute') return { cuts: [{ id: placement.id, startFrame: region.startFrame, endFrame: region.endFrame, reason: 'silence', enabled: true, mode: 'mute' }], gains: [], handling: 'muted' }
  const length = region.endFrame - region.startFrame
  const need = Math.max(0, placement.minGapFrames - (placement.gapFrames - length))
  if (need >= length - Math.round(MIN_REGION_MS * sampleRate / 1000)) return { cuts: [], gains: [attenuation(placement.id, region, sampleRate)], handling: 'attenuated' }
  const cut: AudioEditCut = { id: placement.id, startFrame: region.startFrame, endFrame: region.endFrame - need, reason: 'silence', enabled: true }
  return { cuts: [cut], gains: need > 0 ? [attenuation(placement.id, { startFrame: region.endFrame - need, endFrame: region.endFrame }, sampleRate)] : [], handling: 'deleted' }
}

function overlapsLocked(document: AudioEditProjectDocument, range: { startFrame: number; endFrame: number }): boolean {
  return document.transcript.some((block) => block.locked && block.startFrame < range.endFrame && block.endFrame > range.startFrame)
}

/**
 * 按策略处理呼吸声：删除沿当前成片补充，切换策略才撤回自动处理；用户逐处恢复过的不动。
 * range 只处理落在其中的呼吸；pauses 是声音能量检测到的安静区间，给了就只把真正安静的部分算作气口。
 */
export function applyAudioEditBreathPolicy(
  document: AudioEditProjectDocument, breaths: readonly AudioBreath[], policy: AudioEditBreathPolicy, range?: AudioEditRange, pauses?: readonly AudioEditQuietRange[],
): { document: AudioEditProjectDocument; counts: Record<'deleted' | 'attenuated' | 'muted' | 'kept', number> } {
  const { sampleRate } = document.source
  const inRange = (item: { startFrame: number; endFrame: number }): boolean => !range || (item.startFrame >= range.startFrame && item.endFrame <= range.endFrame)
  const restored = new Set([...(document.cuts ?? []), ...(document.gainRegions ?? [])].filter((item) => isAudioEditBreathEdit(item) && !item.enabled).map((item) => item.id))
  // 删除不能恢复旧删除；词块或其他剪切已改变时，重新分配气口会把剪掉的声音带回来。
  const processed = policy === 'delete' ? new Set((document.cuts ?? [])
    .filter((item) => item.enabled && item.mode !== 'mute' && isAudioEditBreathEdit(item)).map((item) => item.id)) : new Set<string>()
  const base: AudioEditProjectDocument = {
    ...document,
    cuts: (document.cuts ?? []).filter((item) => !((policy !== 'delete' || item.mode === 'mute') && isAudioEditBreathEdit(item) && item.enabled && inRange(item))),
    gainRegions: (document.gainRegions ?? []).filter((item) => !(policy !== 'delete' && isAudioEditBreathEdit(item) && item.enabled && inRange(item))),
  }
  const counts = { deleted: 0, attenuated: 0, muted: 0, kept: 0 }
  // 按时间逐口处理，每删一口就按新的剪辑重算：同一处空当里的后一口气看得到前一口已经删掉
  const quiet = pauses ? quietRanges(document, breaths, pauses) : undefined
  let working = base
  let state = placementState(working, quiet)
  for (const breath of [...breaths].sort((a, b) => a.startMs - b.startMs)) {
    const placement = placeBreath(state, breath)
    if (!inRange(placement) || restored.has(placement.id) || processed.has(placement.id)) continue
    const region = placement.region
    const decision = region && !overlapsLocked(base, region) ? decideAudioEditBreath(placement.context, policy) : 'keep'
    if (decision === 'keep' || !region) { if (placement.context !== 'removed') counts.kept++; continue }
    const edits = breathEdits(placement, decision, sampleRate)
    counts[edits.handling]++
    working = { ...working, cuts: [...(working.cuts ?? []), ...edits.cuts],
      gainRegions: [...(working.gainRegions ?? []).filter((item) => item.id !== placement.id), ...edits.gains] }
    if (edits.cuts.length) state = placementState(working, quiet)
  }
  return { document: working, counts }
}

/**
 * 逐处改一口气的处理（助手或用户的判断）：先撤掉这一处此前的处理，再按要求加上。
 * kept 留一条停用的剪切做“保留”标记，之后批量处理不会再动它。
 */
export function setAudioEditBreathHandling(
  document: AudioEditProjectDocument, breaths: readonly AudioBreath[], id: string, handling: Exclude<AudioEditBreathHandling, 'removed'>,
): AudioEditProjectDocument {
  const others = (items: readonly { id: string }[] | undefined) => (items ?? []).filter((item) => item.id !== id)
  const base: AudioEditProjectDocument = { ...document, cuts: others(document.cuts) as AudioEditCut[], gainRegions: others(document.gainRegions) as AudioEditGainRegion[] }
  const placement = placeBreaths(base, breaths).find((item) => item.id === id)
  if (!placement) throw new Error('NOT_FOUND')
  const { sampleRate } = document.source
  const region = placement.region
  if (handling === 'kept') return { ...base, cuts: [...(base.cuts ?? []), { id, startFrame: placement.startFrame, endFrame: Math.max(placement.startFrame + 1, placement.endFrame), reason: 'silence', enabled: false }] }
  if (placement.context === 'removed') throw new Error('这口气所在的声音已经被剪掉，不需要再处理。')
  if (!region) throw new Error('这口气和字连在一起，没有能单独下刀的部分；可以减弱前后的词，或保留。')
  if (overlapsLocked(base, region)) throw new Error('这口气挨着锁定的内容，不能修改。')
  const edits = breathEdits(placement, handling === 'attenuated' ? 'attenuate' : handling === 'muted' ? 'mute' : 'delete', sampleRate)
  return { ...base, cuts: [...(base.cuts ?? []), ...edits.cuts], gainRegions: [...(base.gainRegions ?? []), ...edits.gains] }
}
