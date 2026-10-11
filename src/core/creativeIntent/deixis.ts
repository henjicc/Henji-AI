import type { ApplicationRef } from '../application-control/identifiers'
import { refKey, type ClockSegment, type Timeline } from './contracts'
import { alignExplanationEntry, type PointerEvidence } from './alignment'
import type { ExplanationEvent, ExplanationSession, TranscriptEntry } from './schema'

export type IntentSlot = 'target' | 'source' | 'destination' | 'dwell' | 'exit'
export interface DeicticCandidate { evidenceSeqs: number[]; targetRefs: ApplicationRef[]; point: [number, number]; timeline: Timeline; pointer: PointerEvidence }
export interface DeicticMention {
  id: string; text: string; slot: IntentSlot; entry: TranscriptEntry; entries: TranscriptEntry[]; negated: boolean
  candidates: DeicticCandidate[]; selected?: DeicticCandidate; issues: string[]; confirmedByUser: boolean
}
export interface DeixisResolution { text: string; mentions: DeicticMention[]; issues: string[]; negated: boolean; dwellSeconds?: number; exitDirection?: 'left' | 'right' | 'up' | 'down' }
export type ExplanationBinding = ExplanationSession['bindings'][number]

function candidates(pointers: readonly PointerEvidence[]): DeicticCandidate[] {
  const down = pointers.filter(pointer => pointer.phase === 'down')
  const usable = down.length ? down : pointers
  const result = new Map<string, DeicticCandidate>()
  for (const pointer of usable) {
    if (!pointer.compositionPoint || !pointer.timeline) continue
    // Retain EVERY overlapping hit. Selection and display names cannot disambiguate a historical hit.
    const refs = [...new Map([...pointer.hoverRefs, ...pointer.pointedRefs].map(ref => [refKey(ref), ref])).values()]
    const key = JSON.stringify([pointer.timeline, pointer.compositionPoint, refs.map(refKey).sort()])
    const existing = result.get(key)
    if (existing) existing.evidenceSeqs.push(pointer.seq)
    else result.set(key, { evidenceSeqs: [pointer.seq], targetRefs: refs, point: pointer.compositionPoint, timeline: pointer.timeline, pointer })
  }
  return [...result.values()]
}

/** Controlled first-version grammar. It produces evidence candidates, never executable instructions. */
export function resolveDeixis(entries: readonly TranscriptEntry[], events: readonly ExplanationEvent[], clocks: readonly ClockSegment[], bindings: readonly ExplanationBinding[] = []): DeixisResolution {
  const ordered = [...entries].sort((a, b) => a.monoSpanUs[0] - b.monoSpanUs[0] || a.seq - b.seq)
  const text = ordered.map(entry => entry.text).join('')
  const negated = /别|不要|不许|不能|勿/.test(text)
  const issues: string[] = []
  if (new Set(ordered.map(entry => entry.utteranceId)).size > 1) issues.push('不同句子必须分别审阅')
  if (/听一下|庭一下/.test(text)) issues.push('疑似误识别，请校正后再解析')
  const mentions: DeicticMention[] = []
  let offset = 0
  const ranges = ordered.map(entry => { const start = offset; offset += entry.text.length; return { entry, start, end: offset } })
  for (const match of text.matchAll(/刚才那个|这里|这儿|那边|那里|这个|那个|这|那|它/g)) {
    const at = match.index!; const range = ranges.find(item => at >= item.start && at < item.end)!
    const prefix = text.slice(Math.max(0, at - 8), at)
    const slot: IntentSlot = /(?:从|由)$/.test(prefix) ? 'source' : /(?:退出到|离开到|移出到)$/.test(prefix) ? 'exit' : /(?:到|至|移向|放在)$/.test(prefix) ? 'destination' : /(?:离开|退出)$/.test(prefix) ? 'exit' : /(?:停在|留在)$/.test(prefix) ? 'dwell' : 'target'
    const phraseEntries = ranges.filter(item => item.start < at + match[0].length && item.end > at).map(item => item.entry)
    const aligned = alignExplanationEntry({ ...range.entry, monoSpanUs: [phraseEntries[0].monoSpanUs[0], phraseEntries[phraseEntries.length - 1].monoSpanUs[1]], timelineSpans: phraseEntries.flatMap(entry => entry.timelineSpans) }, events, clocks)
    for (const entry of phraseEntries) for (const issue of alignExplanationEntry(entry, events, clocks).issues) if (!aligned.issues.includes(issue)) aligned.issues.push(issue)
    const options = candidates(aligned.pointers)
    const mentionIssues = [...aligned.issues]
    if (phraseEntries.some(entry => entry.granularity === 'segment' || entry.alignmentQuality !== 'precise')) mentionIssues.push('只有句级或粗时间，需确认指向')
    if (match[0] === '刚才那个') mentionIssues.push('“刚才”需要明确选择历史指向')
    if (options.length > 1) mentionIssues.push('有多个位置或访问，需选择对应证据')
    if (options.some(option => option.targetRefs.length > 1)) mentionIssues.push('指向重叠对象，需确认其中一个')
    if ((slot === 'target' || slot === 'source') && !options.some(option => option.targetRefs.length)) mentionIssues.push('没有可确认的历史对象')
    const id = `${range.entry.utteranceId}:${slot}:${at}`
    const binding = bindings.find(value => value.id === id)
    let selected = options.length === 1 && !mentionIssues.length ? options[0] : undefined
    let confirmedByUser = false
    if (binding?.correctedByUser && binding.confidence === 'confirmed' && phraseEntries.every(entry => binding.utteranceIds.includes(entry.utteranceId) && (!entry.wordId || binding.wordIds.includes(entry.wordId))) && (phraseEntries.some(entry => entry.wordId) || binding.wordIds.length === 0)) {
      const candidate = options.find(option => binding.evidenceSeqs.length > 0 && binding.evidenceSeqs.every(seq => option.evidenceSeqs.includes(seq)) && binding.point?.every((value, index) => value === option.point[index]) && binding.targetRefs.every(ref => option.targetRefs.some(target => refKey(target) === refKey(ref))) && binding.timelineSpans.some(span => span.start?.visitRef === option.timeline.visitRef && span.start.sequenceRef.id === option.timeline.sequenceRef.id))
      if (candidate && binding.targetRefs.length <= 1 && (!(slot === 'target' || slot === 'source') || binding.targetRefs.length === 1) && !issues.length && !aligned.issues.some(issue => issue.includes('置信度') || issue.includes('缺口'))) {
        selected = { ...candidate, targetRefs: binding.targetRefs }; confirmedByUser = true; mentionIssues.length = 0
      } else mentionIssues.push('原绑定不再匹配历史证据，请重新确认')
    }
    mentions.push({ id, text: match[0], slot, entry: range.entry, entries: phraseEntries, negated, candidates: options, selected, issues: mentionIssues, confirmedByUser })
  }
  // One click cannot silently stand for both ends of a movement. An intentional zero-distance
  // instruction is still possible, but requires explicit confirmation of both roles.
  for (const source of mentions.filter(mention => mention.slot === 'source')) for (const destination of mentions.filter(mention => mention.slot === 'destination' || mention.slot === 'exit')) {
    if (source.selected && destination.selected && source.selected.evidenceSeqs.some(seq => destination.selected!.evidenceSeqs.includes(seq)) && !(source.confirmedByUser && destination.confirmedByUser)) {
      for (const mention of [source, destination]) if (!mention.confirmedByUser) { mention.selected = undefined; mention.issues.push('起点和终点共享同一指向，需分别确认') }
    }
  }
  if (!mentions.length) issues.push('这句没有受支持的指代，请人工说明对象和位置')
  const duration = text.match(/(?:停留|停在|留在|停|等)[^。！？]*?([+-]?\d[\d.eE+-]*|[一二三四五六七八九十两]+)\s*(毫秒|秒|分钟)/)
  const chinese: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 }
  const amount = duration ? /^\d+(?:\.\d+)?$/.test(duration[1]) ? Number(duration[1]) : chinese[duration[1]] : undefined
  const dwellSeconds = amount !== undefined && Number.isFinite(amount) && amount > 0 ? amount * (duration![2] === '毫秒' ? .001 : duration![2] === '分钟' ? 60 : 1) : undefined
  if (/停留|停一下|等一下|停在|留在/.test(text) && dwellSeconds === undefined) issues.push('停留时长未说明，不能用录音暂停时长替代')
  const direction = text.match(/(?:向|往)(左|右|上|下)(?:边|方)?(?:离开|退出|出场)/)?.[1]
  const exitDirections = { 左: 'left', 右: 'right', 上: 'up', 下: 'down' } as const
  const exitDirection = direction ? exitDirections[direction as keyof typeof exitDirections] : undefined
  if (/出来|离开|退出/.test(text) && !exitDirection && !/(?:退出到|离开到|移出到)(?:这里|这儿|那边|那里|这|那)/.test(text)) issues.push('离开方向或终点未说明')
  if (events.some(event => event.kind === 'annotation' && ordered.some(entry => event.monoUs >= entry.monoSpanUs[0] && event.monoUs <= entry.monoSpanUs[1]))) issues.push('历史标注缺少可读快照，不能读取当前标注代替')
  return { text, mentions, issues, negated, ...(dwellSeconds !== undefined ? { dwellSeconds } : {}), ...(exitDirection ? { exitDirection } : {}) }
}

export function confirmedExplanationBinding(mention: DeicticMention, candidate: DeicticCandidate, target?: ApplicationRef): ExplanationBinding {
  if (!mention.candidates.includes(candidate) || target && !candidate.targetRefs.some(ref => refKey(ref) === refKey(target))) throw new Error('只能选择这次讲解的历史候选')
  if ((mention.slot === 'target' || mention.slot === 'source') && !target) throw new Error('请确认对应对象')
  return { id: mention.id, utteranceIds: [...new Set(mention.entries.map(entry => entry.utteranceId))], wordIds: mention.entries.flatMap(entry => entry.wordId ? [entry.wordId] : []), targetRefs: target ? [candidate.targetRefs.find(ref => refKey(ref) === refKey(target))!] : [], point: candidate.point, evidenceSeqs: candidate.evidenceSeqs, timelineSpans: [{ monoSpanUs: [candidate.pointer.monoUs, candidate.pointer.monoUs], clockSegmentRef: candidate.pointer.clockSegmentRef, start: candidate.timeline, end: candidate.timeline, quality: 'presented', evidenceSeqs: candidate.evidenceSeqs }], confidence: 'confirmed', correctedByUser: true }
}
