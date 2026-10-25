import type { AudioBreath } from '../audioAnalysis/breath/respiro'
import type { AudioEditGainRegion } from './regions'
import { buildProjectAudioEditTimeline } from './timeline'
import type { AudioEditCut, AudioEditProjectDocument, AudioEditRange, AudioEditTranscriptBlock } from './types'

/*
 * 呼吸声的处理：按上下文逐处决定删、减弱、静音还是保留，落成普通的剪切与音量区域（标识以 breath: 开头），
 * 和其他剪辑一样可逐处恢复、一步撤销，不改口播文档格式。
 *
 * 默认“删除”（快节奏）：去掉这口气，但两侧原有的安静保留，至少留 MIN_GAP_MS 的气口，不让前后的字粘在一起；
 * - 删了会少于这个气口时改为减弱；
 * - 和字连在一起（识别的词时间盖住了大半口气）：只减弱不在词里下刀。
 * 位置（句间 / 句中 / 开头结尾）照样标出来，供助手逐处取舍：想保留句中换气的语气时改成减弱。
 * 已被重念、停顿处理剪掉的呼吸不再处理。
 */

export type AudioEditBreathPolicy = 'delete' | 'attenuate' | 'mute' | 'keep'
export type AudioEditBreathContext = 'edge' | 'sentence' | 'clause' | 'touching' | 'removed'
export type AudioEditBreathHandling = 'deleted' | 'attenuated' | 'muted' | 'kept' | 'removed'

export const AUDIO_EDIT_BREATH_ID_PREFIX = 'breath:'
export const AUDIO_EDIT_BREATH_ATTENUATION_DB = -18
const MIN_GAP_MS = 120
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
  /** 两侧词之间的空当（毫秒，含这口气） */
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
  gapFrames: number
  previous?: AudioEditTranscriptBlock
  next?: AudioEditTranscriptBlock
}

const breathId = (startFrame: number): string => `${AUDIO_EDIT_BREATH_ID_PREFIX}${startFrame}`
export const isAudioEditBreathEdit = (item: { id: string }): boolean => item.id.startsWith(AUDIO_EDIT_BREATH_ID_PREFIX)

function placeBreaths(document: AudioEditProjectDocument, breaths: readonly AudioBreath[]): Placement[] {
  const { sampleRate, durationFrames } = document.source
  const ms = (frames: number): number => frames * 1000 / sampleRate
  const spans = buildProjectAudioEditTimeline(document).filter((span) => !span.muted)
  const words = document.transcript.filter((block) => block.included).sort((a, b) => a.startFrame - b.startFrame)
  return breaths.map((breath) => {
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
    const keptInBreath = spans.reduce((total, span) => total + Math.max(0, Math.min(endFrame, span.sourceEndFrame) - Math.max(startFrame, span.sourceStartFrame)), 0)
    let context: AudioEditBreathContext
    if (ms(keptInBreath) < MIN_REGION_MS) context = 'removed'
    else if (!region || region.endFrame - region.startFrame < 0.6 * (endFrame - startFrame)) context = 'touching'
    else if (!previous || !next) context = 'edge'
    else if (/[。？！；…!?;]$/.test(previous.text.trim()) || ms(gapEnd - gapStart) >= LONG_GAP_MS) context = 'sentence'
    else context = 'clause'
    if (region && ms(region.endFrame - region.startFrame) < MIN_REGION_MS) region = null
    return { id: breathId(startFrame), startFrame, endFrame, peak: breath.peak, context, region, gapFrames: gapEnd - gapStart, previous, next }
  })
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
export function decideAudioEditBreath(context: AudioEditBreathContext, policy: AudioEditBreathPolicy, remainingGapMs: number): 'delete' | 'attenuate' | 'mute' | 'keep' {
  if (context === 'removed' || policy === 'keep') return 'keep'
  if (policy === 'attenuate') return 'attenuate'
  if (policy === 'mute') return context === 'touching' ? 'attenuate' : 'mute'
  if (context !== 'touching' && remainingGapMs >= MIN_GAP_MS) return 'delete'
  return 'attenuate'
}

function overlapsLocked(document: AudioEditProjectDocument, range: { startFrame: number; endFrame: number }): boolean {
  return document.transcript.some((block) => block.locked && block.startFrame < range.endFrame && block.endFrame > range.startFrame)
}

/**
 * 按策略处理呼吸声：替换此前的呼吸处理（用户逐处恢复过的保留不动），返回新文档与各类计数。
 * range 只处理落在其中的呼吸。
 */
export function applyAudioEditBreathPolicy(
  document: AudioEditProjectDocument, breaths: readonly AudioBreath[], policy: AudioEditBreathPolicy, range?: AudioEditRange,
): { document: AudioEditProjectDocument; counts: Record<'deleted' | 'attenuated' | 'muted' | 'kept', number> } {
  const { sampleRate } = document.source
  const inRange = (item: { startFrame: number; endFrame: number }): boolean => !range || (item.startFrame >= range.startFrame && item.endFrame <= range.endFrame)
  const restored = new Set([...(document.cuts ?? []), ...(document.gainRegions ?? [])].filter((item) => isAudioEditBreathEdit(item) && !item.enabled).map((item) => item.id))
  // 先撤掉范围内此前的呼吸处理，再按当前剪辑状态重新判断
  const base: AudioEditProjectDocument = {
    ...document,
    cuts: (document.cuts ?? []).filter((item) => !(isAudioEditBreathEdit(item) && item.enabled && inRange(item))),
    gainRegions: (document.gainRegions ?? []).filter((item) => !(isAudioEditBreathEdit(item) && item.enabled && inRange(item))),
  }
  const counts = { deleted: 0, attenuated: 0, muted: 0, kept: 0 }
  const cuts: AudioEditCut[] = [], gains: AudioEditGainRegion[] = []
  for (const placement of placeBreaths(base, breaths)) {
    if (!inRange(placement) || restored.has(placement.id)) continue
    const region = placement.region
    const regionMs = region ? (region.endFrame - region.startFrame) * 1000 / sampleRate : 0
    const decision = region && !overlapsLocked(base, region) ? decideAudioEditBreath(placement.context, policy, placement.gapFrames * 1000 / sampleRate - regionMs) : 'keep'
    if (decision === 'keep' || !region) { if (placement.context !== 'removed') counts.kept++; continue }
    if (decision === 'attenuate') {
      const fade = Math.min(Math.round(sampleRate * FADE_MS / 1000), Math.floor((region.endFrame - region.startFrame) / 3))
      gains.push({ id: placement.id, startFrame: region.startFrame, endFrame: region.endFrame, enabled: true, gainDb: AUDIO_EDIT_BREATH_ATTENUATION_DB, fadeInFrames: fade, fadeOutFrames: fade })
      counts.attenuated++
    } else {
      cuts.push({ id: placement.id, startFrame: region.startFrame, endFrame: region.endFrame, reason: 'silence', enabled: true, ...(decision === 'mute' ? { mode: 'mute' as const } : {}) })
      if (decision === 'mute') counts.muted++; else counts.deleted++
    }
  }
  return { document: { ...base, cuts: [...(base.cuts ?? []), ...cuts], gainRegions: [...(base.gainRegions ?? []), ...gains] }, counts }
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
  if (handling === 'attenuated') {
    const fade = Math.min(Math.round(sampleRate * FADE_MS / 1000), Math.floor((region.endFrame - region.startFrame) / 3))
    return { ...base, gainRegions: [...(base.gainRegions ?? []), { id, startFrame: region.startFrame, endFrame: region.endFrame, enabled: true, gainDb: AUDIO_EDIT_BREATH_ATTENUATION_DB, fadeInFrames: fade, fadeOutFrames: fade }] }
  }
  return { ...base, cuts: [...(base.cuts ?? []), { id, startFrame: region.startFrame, endFrame: region.endFrame, reason: 'silence', enabled: true, ...(handling === 'muted' ? { mode: 'mute' as const } : {}) }] }
}
