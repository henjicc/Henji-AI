import type { AudioBreath } from '../audioAnalysis/breath/respiro'
import { buildProjectAudioEditTimeline } from './timeline'
import type { AudioEditCut, AudioEditProjectDocument, AudioEditRange } from './types'

/*
 * 字间气口清理：前一个字说完后常留一点没发完的气声、呼吸尾巴，留着就是听感上的“呲呲”。
 * 按逐帧声音电平找出前一个字真正结束、后一个字真正开始的位置，中间整段先静音，再从中间删去多余的部分，
 * 只留一小段干净的静音当气口。落成普通的静音与删除剪切（标识以 gap: 开头），可逐处恢复、一步撤销，不改存档格式。
 *
 * - 残留的判断：比口播常见音量（全频电平 80% 分位）低 RESIDUE_BELOW_SPEECH_DB 以上算残留；字头的擦音（s、x）
 *   也比残留高十几 dB，高频电平分不开两者，所以只看全频；检测到的呼吸一律算残留；
 * - 保护：前一个字的余音留 TAIL_GUARD_MS、后一个字之前留 ONSET_GUARD_MS，不切到字；
 * - 气口长度：句间与重念接缝处 SENTENCE_GAP_MS，句中 CLAUSE_GAP_MS；本来就更短的只静音不删；
 * - 只在两个保留的字之间、识别的字边界附近找，几十毫秒内的口水音、咔哒声并进气口一起静音。
 */

export const AUDIO_EDIT_GAP_ID_PREFIX = 'gap:'
export const isAudioEditGapEdit = (item: { id: string }): boolean => item.id.startsWith(AUDIO_EDIT_GAP_ID_PREFIX)

/** 逐帧全频电平（dBFS），与停顿压缩、去重念同一分析 */
export interface AudioEditLevels { resolutionMs: number; wideDb: readonly number[] }

const RESIDUE_BELOW_SPEECH_DB = 16
const SENTENCE_GAP_MS = 200
const CLAUSE_GAP_MS = 120
const TAIL_GUARD_MS = 20
const ONSET_GUARD_MS = 10
const MIN_QUIET_MS = 40
const CLICK_MS = 30
const EDGE_MS = 150
const BREATH_MARGIN_MS = 20

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
  const threshold = percentile(levels.wideDb, 0.8) - RESIDUE_BELOW_SPEECH_DB
  const quietCells = new Uint8Array(levels.wideDb.length)
  levels.wideDb.forEach((db, index) => { quietCells[index] = db < threshold ? 1 : 0 })
  for (const breath of breaths) {
    const from = Math.max(0, Math.floor((breath.startMs - BREATH_MARGIN_MS) / levels.resolutionMs))
    const to = Math.min(quietCells.length, Math.ceil((breath.endMs + BREATH_MARGIN_MS) / levels.resolutionMs))
    quietCells.fill(1, from, to)
  }
  const quietAt = (frame: number): boolean => quietCells[Math.min(quietCells.length - 1, Math.floor(frame / cellFrames))] === 1
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
    const tail = frames(TAIL_GUARD_MS), onset = frames(ONSET_GUARD_MS)
    const muteLength = gap.length - tail - onset
    if (muteLength <= 0) continue
    const seam = removedWords.some((word) => word.startFrame >= previous.endFrame && word.endFrame <= next.startFrame)
    const sentence = /[。？！；…!?;]$/.test(previous.text.trim())
    const target = frames(sentence || seam ? SENTENCE_GAP_MS : CLAUSE_GAP_MS)
    const deleteLength = Math.min(muteLength, Math.max(0, gap.length - target))
    const deleteFrom = tail + Math.floor((muteLength - deleteLength) / 2)
    const id = `${AUDIO_EDIT_GAP_ID_PREFIX}${gap.parts[0][0]}`
    let piece = 0
    const add = (parts: Part[], mode: 'delete' | 'mute'): void => {
      for (const [startFrame, endFrame] of parts) {
        if (endFrame <= startFrame) continue
        cuts.push({ id: piece ? `${id}:${piece}` : id, startFrame, endFrame, reason: 'silence', enabled: true, ...(mode === 'mute' ? { mode: 'mute' as const } : {}) })
        piece++
      }
    }
    if (deleteLength) {
      add(sliceParts(gap.parts, tail, deleteFrom), 'mute')
      add(sliceParts(gap.parts, deleteFrom, deleteFrom + deleteLength), 'delete')
      add(sliceParts(gap.parts, deleteFrom + deleteLength, gap.length - onset), 'mute')
    } else add(sliceParts(gap.parts, tail, gap.length - onset), 'mute')
    count++
  }
  return { document: { ...base, cuts: [...(base.cuts ?? []), ...cuts] }, count }
}

/** 撤掉此前的气口清理（呼吸声改为减弱、静音或保留时用，不再把保留的呼吸清掉）；range 只撤其中的。 */
export function clearAudioEditGaps(document: AudioEditProjectDocument, range?: AudioEditRange): AudioEditProjectDocument {
  return { ...document, cuts: (document.cuts ?? []).filter((cut) => !(isAudioEditGapEdit(cut) && cut.enabled && within(range, cut))) }
}

