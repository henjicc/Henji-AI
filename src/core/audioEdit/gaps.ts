import type { AudioBreath } from '../audioAnalysis/breath/respiro'
import { isAudioEditBreathEdit } from './breaths'
import { buildProjectAudioEditTimeline } from './timeline'
import type { AudioEditCut, AudioEditProjectDocument, AudioEditRange } from './types'

/*
 * 字间气口清理：前一个字说完后常留一点没发完的气声、呼吸尾巴，留着就是听感上的“呲呲”。
 * 按逐帧声音电平找出前一个字真正结束、后一个字真正开始的位置，中间整段先静音，再从中间删去多余的部分，
 * 只留一小段干净的静音当气口。落成普通的静音与删除剪切（标识以 gap: 开头），可逐处恢复、一步撤销，不改存档格式。
 *
 * - 残留的判断：比口播常见音量（全频电平 80% 分位）低 RESIDUE_BELOW_SPEECH_DB 以上算残留；字头的擦音（s、x）
 *   也比残留高十几 dB，高频电平分不开两者，所以只看全频；
 * - 检测到的呼吸算残留，但呼吸起止常与字的余音重叠一两格，其中仍明显偏响的（比常见音量低不到 LOUD_IN_BREATH_DB）
 *   按有声处理，不切字尾；为凑气口留下的减弱呼吸一律算残留；
 * - 保护：前一个字的余音留 TAIL_GUARD_MS、后一个字之前留 ONSET_GUARD_MS（另有 5 ms 淡变），不切到字；
 *   后一个字开头的送气、擦音（t、k、s…）很轻，往前最多 ONSET_SEARCH_MS 把高于底噪的部分算作字头；
 * - 本来就不长（不用删）、里面只有房间底噪、没有呼吸的停顿不动：清成纯静音反而像门限切了一刀；
 * - 要删的气口两头各留一点静音、中间整段删除，不和已有的删除穿插成一条条；
 * - 气口长度：句间与重念接缝处 SENTENCE_GAP_MS，句中 CLAUSE_GAP_MS；本来就更短的只静音不删；
 * - 只在真正该停的地方清：前一个字带标点、两字之间删过字（重念接缝）、中间有呼吸，或实际停了 UNMARKED_PAUSE_MS 以上；
 *   一口气连着念的词（“调用大模型”）字与字之间本来就有几十毫秒的自然间隙，那不是气口，不动；
 * - 只在两个保留的字之间、识别的字边界附近找，几十毫秒内的口水音、咔哒声并进气口一起静音。
 */

export const AUDIO_EDIT_GAP_ID_PREFIX = 'gap:'
export const isAudioEditGapEdit = (item: { id: string }): boolean => item.id.startsWith(AUDIO_EDIT_GAP_ID_PREFIX)

/** 逐帧全频与高频电平（dBFS），与停顿压缩、去重念同一分析 */
export interface AudioEditLevels { resolutionMs: number; wideDb: readonly number[]; highDb?: readonly number[] }

const RESIDUE_BELOW_SPEECH_DB = 16
const SENTENCE_GAP_MS = 200
const CLAUSE_GAP_MS = 120
const TAIL_GUARD_MS = 10
const ONSET_GUARD_MS = 10
const MIN_QUIET_MS = 40
const UNMARKED_PAUSE_MS = 150
const ONSET_SEARCH_MS = 80
const SHORT_PAUSE_MS = 100
const ABOVE_FLOOR_DB = 6
const HIGH_ABOVE_FLOOR_DB = 15
const CLICK_MS = 30
const EDGE_MS = 150
const LOUD_IN_BREATH_DB = 8

type Part = [number, number]
interface Run { quiet: boolean; parts: Part[]; length: number }

/** 按在成片里的先后取一段连续时长（offset 从这段开头算起）对应的源区间。 */
function sliceParts(parts: readonly Part[], from: number, to: number): Part[] {
  const out: Part[] = []
  let cursor = 0
  for (const [start, end] of parts) {
    const length = end - start
    const a = Math.max(from, cursor), b = Math.min(to, cursor + length)
    if (b > a) out.push([start + a - cursor, start + b - cursor])
    cursor += length
  }
  return out
}

function percentile(values: readonly number[], ratio: number): number {
  const sorted = values.filter((value) => Number.isFinite(value) && value > -120).sort((a, b) => a - b)
  return sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] : -120
}

const within = (range: AudioEditRange | undefined, item: { startFrame: number; endFrame: number }): boolean => !range || (item.startFrame >= range.startFrame && item.endFrame <= range.endFrame)

/**
 * 清理字与字之间的气口：替换此前的气口清理（用户逐处恢复过的保留不动），返回新文档与处理的处数。
 * 应在去重念、停顿压缩、呼吸声处理之后调用；range 只处理两个字都落在其中的气口。
 */
export function cleanAudioEditGaps(
  document: AudioEditProjectDocument, breaths: readonly AudioBreath[], levels: AudioEditLevels, range?: AudioEditRange,
): { document: AudioEditProjectDocument; count: number } {
  const { sampleRate } = document.source
  const restored = (document.cuts ?? []).filter((cut) => isAudioEditGapEdit(cut) && !cut.enabled)
  const base = clearAudioEditGaps(document, range)
  const frames = (ms: number): number => Math.round(ms * sampleRate / 1000)
  const cellFrames = levels.resolutionMs * sampleRate / 1000
  const speech = percentile(levels.wideDb, 0.8)
  const threshold = speech - RESIDUE_BELOW_SPEECH_DB
  const quietCells = new Uint8Array(levels.wideDb.length)
  levels.wideDb.forEach((db, index) => { quietCells[index] = db < threshold ? 1 : 0 })
  const cellOf = (ms: number): number => Math.max(0, Math.min(quietCells.length, Math.round(ms / levels.resolutionMs)))
  for (const breath of breaths) {
    for (let cell = cellOf(breath.startMs); cell < cellOf(breath.endMs); cell++) if (levels.wideDb[cell] < speech - LOUD_IN_BREATH_DB) quietCells[cell] = 1
  }
  for (const region of base.gainRegions ?? []) {
    if (!region.enabled || !isAudioEditBreathEdit(region)) continue
    quietCells.fill(1, cellOf(region.startFrame * 1000 / sampleRate), cellOf(region.endFrame * 1000 / sampleRate))
  }
  const cellAt = (frame: number): number => Math.min(quietCells.length - 1, Math.floor(frame / cellFrames))
  const quietAt = (frame: number): boolean => quietCells[cellAt(frame)] === 1
  const breathCells = new Uint8Array(quietCells.length)
  for (const breath of breaths) breathCells.fill(1, cellOf(breath.startMs), cellOf(breath.endMs))
  for (const region of base.gainRegions ?? []) if (region.enabled && isAudioEditBreathEdit(region)) breathCells.fill(1, cellOf(region.startFrame * 1000 / sampleRate), cellOf(region.endFrame * 1000 / sampleRate))
  const wideFloor = percentile(levels.wideDb, 0.1)
  const highFloor = levels.highDb ? percentile(levels.highDb, 0.1) : Infinity
  // 高于底噪的轻声（送气、擦音）：全频高出几 dB，或高频明显高出
  const audible = (cell: number): boolean => levels.wideDb[cell] >= wideFloor + ABOVE_FLOOR_DB || (levels.highDb?.[cell] ?? -Infinity) >= highFloor + HIGH_ABOVE_FLOOR_DB
  const spans = buildProjectAudioEditTimeline(base)
  const words = base.transcript.filter((block) => block.included).sort((a, b) => a.startFrame - b.startFrame)
  const removedWords = base.transcript.filter((block) => !block.included && !block.locked)
  const locked = base.transcript.filter((block) => block.locked)
  const cuts: AudioEditCut[] = []
  let count = 0
  for (let index = 0; index + 1 < words.length; index++) {
    const previous = words[index], next = words[index + 1]
    if (!within(range, previous) || !within(range, next)) continue
    const a = Math.max((previous.startFrame + previous.endFrame) / 2, previous.endFrame - frames(EDGE_MS))
    const b = Math.min((next.startFrame + next.endFrame) / 2, next.startFrame + frames(EDGE_MS))
    if (b <= a) continue
    // 两个字之间（含识别边界两侧一点）在成片里依次听到的声音，按 10 ms 一格分成“有声 / 残留”
    const runs: Run[] = []
    const push = (quiet: boolean, start: number, end: number): void => {
      const last = runs.at(-1)
      if (last && last.quiet === quiet) { const tail = last.parts.at(-1)!; if (tail[1] === start) tail[1] = end; else last.parts.push([start, end]); last.length += end - start }
      else runs.push({ quiet, parts: [[start, end]], length: end - start })
    }
    for (const span of spans) {
      const from = Math.max(a, span.sourceStartFrame), to = Math.min(b, span.sourceEndFrame)
      if (to <= from) continue
      if (span.muted) { push(true, Math.round(from), Math.round(to)); continue }
      for (let start = Math.round(from); start < to;) {
        const end = Math.min(Math.round(to), Math.floor((Math.floor(start / cellFrames) + 1) * cellFrames))
        push(quietAt(start), start, Math.max(start + 1, end))
        start = Math.max(start + 1, end)
      }
    }
    // 夹在残留之间的几十毫秒声响（口水音、咔哒）并进气口
    for (let k = 1; k + 1 < runs.length; k++) {
      if (!runs[k].quiet && runs[k].length < frames(CLICK_MS) && runs[k - 1].quiet && runs[k + 1].quiet) {
        const merged: Run = { quiet: true, parts: [...runs[k - 1].parts, ...runs[k].parts, ...runs[k + 1].parts], length: runs[k - 1].length + runs[k].length + runs[k + 1].length }
        runs.splice(k - 1, 3, merged); k = Math.max(0, k - 2)
      }
    }
    const lo = previous.endFrame - frames(30), hi = next.startFrame + frames(30)
    const gap = runs.filter((run) => run.quiet && run.length >= frames(MIN_QUIET_MS) && run.parts.some(([start, end]) => end > lo && start < hi))
      .sort((x, y) => y.length - x.length)[0]
    if (!gap) continue
    const touches = (range: { startFrame: number; endFrame: number }): boolean => gap.parts.some(([start, end]) => range.startFrame < end && range.endFrame > start)
    if (locked.some(touches) || restored.some(touches)) continue
    // 后一个字开头很轻的送气、擦音算作字头：从气口末尾往前找，最多 ONSET_SEARCH_MS
    let lead = 0
    search: for (let p = gap.parts.length - 1; p >= 0; p--) {
      const [start, end] = gap.parts[p]
      for (let frame = end - 1; frame >= start; frame -= cellFrames) {
        const cell = cellAt(frame)
        if (lead >= frames(ONSET_SEARCH_MS) || breathCells[cell] || !audible(cell)) break search
        lead += Math.min(cellFrames, frame - start + 1)
      }
    }
    const tail = frames(TAIL_GUARD_MS), onset = frames(ONSET_GUARD_MS) + Math.round(Math.min(lead, frames(ONSET_SEARCH_MS)))
    const muteLength = gap.length - tail - onset
    if (muteLength <= 0) continue
    const seam = removedWords.some((word) => word.startFrame >= previous.endFrame && word.endFrame <= next.startFrame)
    const sentence = /[。？！；…!?;]$/.test(previous.text.trim())
    const marked = sentence || seam || /[，、：,:]$/.test(previous.text.trim())
      || breaths.some((breath) => breath.startMs * sampleRate / 1000 < next.startFrame && breath.endMs * sampleRate / 1000 > previous.endFrame)
    if (!marked && gap.length < frames(UNMARKED_PAUSE_MS)) continue
    const target = frames(sentence || seam ? SENTENCE_GAP_MS : CLAUSE_GAP_MS)
    const deleteLength = Math.min(muteLength, Math.max(0, gap.length - target))
    const deleteFrom = tail + Math.floor((muteLength - deleteLength) / 2)
    if (!deleteLength) {
      // 不用删的短停顿：太短，或只有底噪、没有呼吸，就不动
      const hasBreath = gap.parts.some(([start, end]) => { for (let frame = start; frame < end; frame += cellFrames) if (breathCells[cellAt(frame)]) return true; return false })
      const hasResidue = gap.parts.some(([start, end]) => { for (let frame = start; frame < end; frame += cellFrames) if (audible(cellAt(frame))) return true; return false })
      if (gap.length < frames(SHORT_PAUSE_MS) || (!hasBreath && !hasResidue)) continue
    }
    const id = `${AUDIO_EDIT_GAP_ID_PREFIX}${gap.parts[0][0]}`
    let piece = 0
    const add = (parts: Part[], mode: 'delete' | 'mute'): void => {
      for (const [startFrame, endFrame] of parts) {
        if (endFrame <= startFrame) continue
        cuts.push({ id: piece ? `${id}:${piece}` : id, startFrame, endFrame, reason: 'silence', enabled: true, ...(mode === 'mute' ? { mode: 'mute' as const } : {}) })
        piece++
      }
    }
    // 两头留的静音尽量各在一整段里：前一个字后面那段、后一个字前面那段，中间整段删除（含已删的部分），不穿插
    const first = gap.parts[0], last = gap.parts.at(-1)!
    const keep = muteLength - deleteLength
    const firstRoom = Math.max(0, first[1] - first[0] - tail), lastRoom = Math.max(0, last[1] - last[0] - onset)
    let keepTail = Math.min(lastRoom, keep - Math.min(firstRoom, Math.floor(keep / 2)))
    const keepHead = Math.min(firstRoom, keep - keepTail)
    keepTail = keep - keepHead
    const headEnd = first[0] + tail + keepHead, tailStart = last[1] - onset - keepTail
    if (deleteLength && keepTail <= lastRoom && headEnd <= tailStart) {
      add([[first[0] + tail, headEnd]], 'mute')
      add([[headEnd, tailStart]], 'delete')
      add([[tailStart, last[1] - onset]], 'mute')
    } else if (deleteLength) {
      add(sliceParts(gap.parts, tail, deleteFrom), 'mute')
      add(sliceParts(gap.parts, deleteFrom, deleteFrom + deleteLength), 'delete')
      add(sliceParts(gap.parts, deleteFrom + deleteLength, gap.length - onset), 'mute')
    } else if (gap.parts.length > 2 && first[1] - first[0] > tail && last[1] - last[0] > onset) {
      // 已被删除隔成好几段：只留紧挨两边字的那两段静音，中间零碎的几段并进删除
      add([[first[0] + tail, first[1]]], 'mute')
      add([[first[1], last[0]]], 'delete')
      add([[last[0], last[1] - onset]], 'mute')
    } else add(sliceParts(gap.parts, tail, gap.length - onset), 'mute')
    count++
  }
  return { document: { ...base, cuts: [...(base.cuts ?? []), ...cuts] }, count }
}

/**
 * 字声音真正开始、结束的位置（源采样帧，升序）：与气口清理同一残留判断，几十毫秒内的起伏不算，
 * 供拖动区间边缘时吸附。
 */
export function audioEditSpeechEdges(levels: AudioEditLevels, sampleRate: number): number[] {
  const threshold = percentile(levels.wideDb, 0.8) - RESIDUE_BELOW_SPEECH_DB
  const minCells = Math.max(1, Math.round(CLICK_MS / levels.resolutionMs))
  const runs: Array<{ quiet: boolean; start: number; end: number }> = []
  levels.wideDb.forEach((db, cell) => {
    const quiet = db < threshold, last = runs.at(-1)
    if (last && last.quiet === quiet) last.end = cell + 1
    else runs.push({ quiet, start: cell, end: cell + 1 })
  })
  // 太短的起伏并进前一段
  const merged: typeof runs = []
  for (const run of runs) {
    const last = merged.at(-1)
    if (last && (run.end - run.start < minCells || last.quiet === run.quiet)) last.end = run.end
    else merged.push({ ...run })
  }
  return merged.slice(1).map((run) => Math.round(run.start * levels.resolutionMs * sampleRate / 1000))
}

/** 撤掉此前的气口清理（呼吸声改为减弱、静音或保留时用，不再把保留的呼吸清掉）；range 只撤其中的。 */
export function clearAudioEditGaps(document: AudioEditProjectDocument, range?: AudioEditRange): AudioEditProjectDocument {
  return { ...document, cuts: (document.cuts ?? []).filter((cut) => !(isAudioEditGapEdit(cut) && cut.enabled && within(range, cut))) }
}

