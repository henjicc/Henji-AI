import type { AudioBreath } from '../audioAnalysis/breath/respiro'
import { isAudioEditBreathEdit } from './breaths'
import { audioEditWordGaps, buildProjectAudioEditTimeline } from './timeline'
import { sliceAudioEditRanges, subtractRanges } from './edits'
import type { AudioEditCut, AudioEditProjectDocument, AudioEditRange } from './types'
import { AUDIO_EDIT_ONSET_SEARCH_MS, audibleCells, levelPercentile, type AudioEditLevels } from './levels'
import { AUDIO_EDIT_RHYTHM } from './rhythm'

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
 *   后一个字开头的送气、擦音、浊音（t、k、s、z…）很轻，把气口末尾连续高于底噪的部分算作字头：识别起点之后的都属于这个字，
 *   起点之前的最多 AUDIO_EDIT_ONSET_SEARCH_MS；呼吸检测常把紧贴字头的弱音也划进呼吸，被标成呼吸的格照样算；
 * - 两段删除（或删除与静音）之间剩下不到 FRAGMENT_MS、又没有保留的字的残片，并进删除；
 * - 本来就不长（不用删）、里面只有房间底噪、没有呼吸的停顿不动：清成纯静音反而像门限切了一刀；
 * - 要删的气口两头各留一点静音、中间整段删除，不和已有的删除穿插成一条条；
 * - 气口长度取成片的目标节奏（rhythm.ts）：句间与重念接缝处一档，句中一档；本来就更短的只静音不删；
 * - 只在真正该停的地方清：前一个字带标点、两字之间删过字（重念接缝）、中间有呼吸，或实际停了 UNMARKED_PAUSE_MS 以上；
 *   一口气连着念的词（“调用大模型”）字与字之间本来就有几十毫秒的自然间隙，那不是气口，不动；
 * - 只在两个保留的字之间、识别的字边界附近找，几十毫秒内的口水音、咔哒声并进气口一起静音。
 */

const AUDIO_EDIT_GAP_ID_PREFIX = 'gap:'
const isAudioEditGapEdit = (item: { id: string; reason?: string }): boolean => item.reason !== 'manual' && item.id.startsWith(AUDIO_EDIT_GAP_ID_PREFIX)

export type { AudioEditLevels } from './levels'

const RESIDUE_BELOW_SPEECH_DB = 16
const TAIL_GUARD_MS = 10
const ONSET_GUARD_MS = 10
const MIN_QUIET_MS = 40
const UNMARKED_PAUSE_MS = 150
const SHORT_PAUSE_MS = 100
const CLICK_MS = 30
const EDGE_MS = 150
const LOUD_IN_BREATH_DB = 8
/**
 * 一口气的电平中位数高出房间底噪这么多（dB）才算明显听得见、值得往字里追着清。
 * 定稿用例里落在识别词块里面的呼吸：用户删掉的 6 口高出底噪 7.6–10.4 dB，留着没动的 4 口高出 4.6–8.5 dB，两边有重叠；
 * 取 9 时不碰任何一口用户留着的，覆盖删掉的一半。两边挨得很近，换一份录音未必还分得开；取舍是宁可少清，不去动有意的停顿。
 */
const CLEAR_BREATH_ABOVE_FLOOR_DB = 9
/** 两个连着念的词交界处的浅谷：比两侧的峰都低这么多（dB）才算交界，否则是同一个音节里的起伏 */
const JUNCTURE_DIP_DB = 6
/**
 * 两段删除（或删除与静音）之间留下的声音短于这么长、又不含任何保留的字，就并进删除（毫秒）。
 * 普通话最短的音节也有 80–100 毫秒，几十毫秒的残片听不出是字，只会像接缝处“咔”地一碎；
 * 取 60 毫秒，比最短的音节短一截，又比接缝两侧的淡变（各 5 毫秒）长得多。
 */
const FRAGMENT_MS = 60

type Part = [number, number]
interface Run { quiet: boolean; parts: Part[]; length: number }

/** 按在成片里的先后取一段连续时长（offset 从这段开头算起）对应的源区间。 */
function sliceParts(parts: readonly Part[], from: number, to: number): Part[] {
  return sliceAudioEditRanges(parts.map(([startFrame, endFrame]) => ({ startFrame, endFrame })), from, to)
    .map(({ startFrame, endFrame }) => [startFrame, endFrame])
}

const within = (range: AudioEditRange | undefined, item: { startFrame: number; endFrame: number }): boolean => !range || (item.startFrame >= range.startFrame && item.endFrame <= range.endFrame)

/**
 * 清理字与字之间的气口：只处理当前成片里仍多余的部分，用户逐处恢复过的保留不动。
 * 应在去重念、停顿压缩、呼吸声处理之后调用；range 只处理两个字都落在其中的气口。
 */
export function cleanAudioEditGaps(
  document: AudioEditProjectDocument, breaths: readonly AudioBreath[], levels: AudioEditLevels, range?: AudioEditRange,
): { document: AudioEditProjectDocument; count: number } {
  const { sampleRate } = document.source
  const restored = (document.cuts ?? []).filter((cut) => isAudioEditGapEdit(cut) && !cut.enabled)
  const base = document
  const frames = (ms: number): number => Math.round(ms * sampleRate / 1000)
  const cellFrames = levels.resolutionMs * sampleRate / 1000
  const speech = levelPercentile(levels.wideDb, 0.8)
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
  const leftoverBreathCells = new Uint8Array(quietCells.length)
  for (const breath of breaths) breathCells.fill(1, cellOf(breath.startMs), cellOf(breath.endMs))
  for (const region of base.gainRegions ?? []) {
    if (!region.enabled || !isAudioEditBreathEdit(region)) continue
    breathCells.fill(1, cellOf(region.startFrame * 1000 / sampleRate), cellOf(region.endFrame * 1000 / sampleRate))
    leftoverBreathCells.fill(1, cellOf(region.startFrame * 1000 / sampleRate), cellOf(region.endFrame * 1000 / sampleRate))
  }
  // 高于底噪的轻声（送气、擦音）：全频高出几 dB，或高频明显高出
  const audible = audibleCells(levels)
  const spans = buildProjectAudioEditTimeline(base)
  const locked = base.transcript.filter((block) => block.locked)
  const cuts: AudioEditCut[] = []
  let count = 0
  // 明显听得见的呼吸（电平的中位数高出实测房间底噪 CLEAR_BREATH_ABOVE_FLOOR_DB）：识别的词时间常把字后面的整口气算进这个字，
  // 这样的格不是字的一部分，该和气口一起清。更轻的“呼吸”与纯安静的停顿不在此列：多半是说话人有意的停顿，保持原样。
  // 底噪用实测的（电平的 10% 分位），不按说话音量往下推：安静的房间与嘈杂的房间里，底噪离说话音量差得很远
  const noiseFloor = levelPercentile(levels.wideDb, 0.1)
  const audibleBreathCells = new Uint8Array(quietCells.length)
  for (const breath of breaths) {
    const from = cellOf(breath.startMs), to = cellOf(breath.endMs)
    if (to <= from) continue
    const sorted = levels.wideDb.slice(from, to).sort((x, y) => x - y)
    if (sorted[sorted.length >> 1] >= noiseFloor + CLEAR_BREATH_ABOVE_FLOOR_DB) audibleBreathCells.fill(1, from, to)
  }
  // 往字里延伸时只认严格的残留线：呼吸检测会把字的轻声尾巴、拖音划进呼吸，那部分只比说话轻十来 dB，是字，不能一路清到字的中点
  const surelyNotSpeech = (cell: number): boolean => audibleBreathCells[cell] === 1 && levels.wideDb[cell] < threshold
  // 识别把标点单独切成一个词块时（“来的｜；｜有的”），它没有声音，却占着整段停顿：不当作字，这处停顿整段一起排
  const spoken = (block: { text: string }): boolean => /[\p{L}\p{N}]/u.test(block.text)
  const mark = new Map<string, string>()
  { let last: string | undefined
    for (const block of [...base.transcript].sort((x, y) => x.startFrame - y.startFrame)) {
      if (!block.included) continue
      if (spoken(block)) last = block.id
      else if (last) mark.set(last, (mark.get(last) ?? '') + block.text.trim())
    } }
  for (const { previous, next, seam, removedFrom } of audioEditWordGaps(base.transcript.filter((block) => !block.included || block.locked || spoken(block)), spans)) {
    if (!within(range, previous) || !within(range, next)) continue
    // 默认只看识别边界两侧 EDGE_MS：再往字里走，轻声的音节也会低过残留线。前一个字这一侧，听得见的呼吸可以一直往里找到字的中点；
    // 后一个字那一侧同样延伸，不过字头另有保护（见下面的 lead），实际很少用上
    let a = Math.max((previous.startFrame + previous.endFrame) / 2, previous.endFrame - frames(EDGE_MS))
    let b = Math.min((next.startFrame + next.endFrame) / 2, next.startFrame + frames(EDGE_MS))
    { const stop = cellAt((previous.startFrame + previous.endFrame) / 2)
      let cell = cellAt(a)
      while (cell - 1 > stop && surelyNotSpeech(cell - 1)) cell--
      if (cell < cellAt(a)) a = Math.max((previous.startFrame + previous.endFrame) / 2, cell * cellFrames) }
    { const stop = cellAt((next.startFrame + next.endFrame) / 2)
      let cell = cellAt(b)
      while (cell < stop && surelyNotSpeech(cell)) cell++
      if (cell > cellAt(b)) b = Math.min((next.startFrame + next.endFrame) / 2, cell * cellFrames) }
    if (b <= a) continue
    // 接缝处前一个保留词的字尾到哪里为止：识别给的终点之后、第一个被删词之前还连着响的部分是它没念完的字尾，
    // 到第一处安静为止；再往后的声音（被删词提前起的头、零碎字尾）属于被放弃的那遍。
    // 一路响到被删词、中间没有安静的，是被删词贴着前一个词念出来的，分不出字尾，仍以识别给的终点为界
    // 识别终点那一刻字已经停了（前一格就是残留）的不算：之后再响起来的是被放弃那遍的零碎声响，不是这个字的尾巴。
    // 一律按电平的格号走，不拿帧数除来除去：采样率不是 100 的整数倍时一格不是整数帧
    let discardedFrom = previous.endFrame
    const endCell = cellAt(previous.endFrame), lastCell = seam && removedFrom !== undefined ? cellAt(Math.max(previous.endFrame, removedFrom - 1)) : -1
    if (lastCell >= endCell && removedFrom! > previous.endFrame && endCell > 0 && !quietCells[endCell - 1]) {
      let cell = endCell
      while (cell <= lastCell && !quietCells[cell]) cell++
      if (cell <= lastCell) discardedFrom = Math.max(previous.endFrame, Math.ceil(cell * cellFrames))
      else {
        // 没有降到残留那么轻的地方：两个词交界处通常仍有一个浅谷（比两侧都低 JUNCTURE_DIP_DB 以上），在谷底分开；连浅谷也没有才退回识别终点
        let lowest = endCell
        for (let at = endCell; at <= lastCell; at++) if (levels.wideDb[at] < levels.wideDb[lowest]) lowest = at
        let before = -Infinity, after = -Infinity
        for (let at = endCell; at < lowest; at++) before = Math.max(before, levels.wideDb[at])
        for (let at = lowest + 1; at <= lastCell + 3 && at < levels.wideDb.length; at++) after = Math.max(after, levels.wideDb[at])
        if (Math.min(before, after) - levels.wideDb[lowest] >= JUNCTURE_DIP_DB) discardedFrom = Math.max(previous.endFrame, Math.ceil(lowest * cellFrames))
      }
    }
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
        // 重念已删的词之间留下的零碎字尾属于被放弃的那遍，不能把它们当有声岛拆开接缝
        push(quietAt(start) || (seam && start >= discardedFrom && start < next.startFrame), start, Math.max(start + 1, end))
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
    // 气口要挨着识别边界；里面有听得见的呼吸的例外：后一个字的送气、擦音常隔在呼吸与识别边界之间（“比如说〔呼吸〕苹果”）
    const breathy = (run: Run): boolean => run.parts.some(([start, end]) => { for (let cell = cellAt(start); cell <= cellAt(end - 1); cell++) if (audibleBreathCells[cell]) return true; return false })
    const gap = runs.filter((run) => run.quiet && run.length >= frames(MIN_QUIET_MS) && (breathy(run) || run.parts.some(([start, end]) => end > lo && start < hi)))
      .sort((x, y) => y.length - x.length)[0]
    if (!gap) continue
    const touches = (range: { startFrame: number; endFrame: number }): boolean => gap.parts.some(([start, end]) => range.startFrame < end && range.endFrame > start)
    if (locked.some(touches) || restored.some(touches)) continue
    // 后一个字开头很轻的送气、擦音、浊音算作字头：从气口末尾往前找连续高于底噪的格。识别起点之后的都属于这个字；
    // 起点之前的最多 AUDIO_EDIT_ONSET_SEARCH_MS。检测到的呼吸不中断（“再”字主体前那一小团浊音常被划进呼吸），
    // 为凑气口留下的那截减弱呼吸才中断：它是有意留的气口，照样清成静音
    // 电平按 10 毫秒一格，字头里偶尔有一格略低于底噪线（“那”的鼻音起头），单独一格不算断开
    let lead = 0, beforeStart = 0
    search: for (let p = gap.parts.length - 1; p >= 0; p--) {
      const [start, end] = gap.parts[p]
      for (let frame = end - 1; frame >= start; frame -= cellFrames) {
        const cell = cellAt(frame)
        if (leftoverBreathCells[cell]) break search
        if (!audible(cell) && !(frame - cellFrames >= start && audible(cell - 1) && !leftoverBreathCells[cell - 1])) break search
        const step = Math.min(cellFrames, frame - start + 1)
        if (frame < next.startFrame) {
          if (beforeStart >= frames(AUDIO_EDIT_ONSET_SEARCH_MS)) break search
          beforeStart += step
        }
        lead += step
      }
    }
    const tail = frames(TAIL_GUARD_MS), onset = frames(ONSET_GUARD_MS) + Math.round(lead)
    const muteLength = gap.length - tail - onset
    if (muteLength <= 0) continue
    const sentence = /[。？！；…!?;]$/.test(previous.text.trim())
    const alone = mark.get(previous.id) ?? ''
    const marked = sentence || seam || alone !== '' || /[，、：,:]$/.test(previous.text.trim())
      || breaths.some((breath) => breath.startMs * sampleRate / 1000 < next.startFrame && breath.endMs * sampleRate / 1000 > previous.endFrame)
    if (!marked && gap.length < frames(UNMARKED_PAUSE_MS)) continue
    // 单独成块的标点自己占一拍：这处停顿留“前一个字后面的一拍”加“标点的一拍”
    const target = frames((sentence || seam ? AUDIO_EDIT_RHYTHM.sentenceMs : AUDIO_EDIT_RHYTHM.clauseMs)
      + (alone ? (/[。？！；…!?;]$/.test(alone) ? AUDIO_EDIT_RHYTHM.sentenceMs : AUDIO_EDIT_RHYTHM.clauseMs) : 0))
    // 已经达到目标的自动清理原样保留，避免重跑继续蚕食两端保护与重复叠加静音。
    if (gap.length <= target && (base.cuts ?? []).some((cut) => cut.enabled && isAudioEditGapEdit(cut) && touches(cut))) continue
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
        const protectedRanges = (base.cuts ?? []).filter((cut) => cut.enabled && (cut.mode !== 'mute' || mode === 'mute'))
        for (const part of subtractRanges([{ startFrame, endFrame }], protectedRanges)) {
          const candidate = piece ? `${id}:${piece}` : id
          const cutId = (base.cuts ?? []).some((cut) => cut.id === candidate) ? `${id}:${mode}:${part.startFrame}:${part.endFrame}` : candidate
          cuts.push({ id: cutId, ...part, reason: 'silence', enabled: true, ...(mode === 'mute' ? { mode: 'mute' as const } : {}) })
          piece++
        }
      }
    }
    if (deleteLength) {
      add(sliceParts(gap.parts, tail, deleteFrom), 'mute')
      add(sliceParts(gap.parts, deleteFrom, deleteFrom + deleteLength), 'delete')
      add(sliceParts(gap.parts, deleteFrom + deleteLength, gap.length - onset), 'mute')
    } else add(sliceParts(gap.parts, tail, gap.length - onset), 'mute')
    if (piece) count++
  }
  const cleaned = { ...base, cuts: [...(base.cuts ?? []), ...cuts] }
  return { document: { ...cleaned, cuts: [...cleaned.cuts, ...fragmentCuts(cleaned, restored, range)] }, count }
}

/**
 * 两段删除（或删除与静音）之间夹着的残片并进删除：去重念、停顿、呼吸、气口各自下刀，交界处常剩下十几到几十毫秒的声音，
 * 里面没有完整的字，听着是一下“咔”。短于 FRAGMENT_MS、不含保留词的主体（过半）、不碰锁定内容的才并；开头结尾不动。
 * 落成 gap: 剪切，和气口清理一样可逐处恢复，恢复过的不再提。
 */
function fragmentCuts(document: AudioEditProjectDocument, restored: readonly AudioEditCut[], range: AudioEditRange | undefined): AudioEditCut[] {
  const spans = buildProjectAudioEditTimeline(document)
  const limit = Math.round(FRAGMENT_MS * document.source.sampleRate / 1000)
  const cuts: AudioEditCut[] = []
  for (let index = 1; index + 1 < spans.length; index++) {
    const span = spans[index], previous = spans[index - 1], next = spans[index + 1]
    const startFrame = span.sourceStartFrame, endFrame = span.sourceEndFrame
    if (span.muted || endFrame - startFrame >= limit || !within(range, { startFrame, endFrame })) continue
    const cutBefore = previous.muted || previous.sourceEndFrame < startFrame
    const cutAfter = next.muted || next.sourceStartFrame > endFrame
    if (!cutBefore || !cutAfter) continue
    const touches = (block: { startFrame: number; endFrame: number }): number => Math.max(0, Math.min(endFrame, block.endFrame) - Math.max(startFrame, block.startFrame))
    if (document.transcript.some((block) => (block.included && touches(block) * 2 > block.endFrame - block.startFrame) || (block.locked && touches(block) > 0))) continue
    const id = `${AUDIO_EDIT_GAP_ID_PREFIX}fragment:${startFrame}`
    if (restored.some((cut) => cut.id === id)) continue
    cuts.push({ id, startFrame, endFrame, reason: 'silence', enabled: true })
  }
  return cuts
}

/**
 * 字声音真正开始、结束的位置（源采样帧，升序）：与气口清理同一残留判断，几十毫秒内的起伏不算，
 * 供拖动区间边缘时吸附。
 */
export function audioEditSpeechEdges(levels: AudioEditLevels, sampleRate: number): number[] {
  const threshold = levelPercentile(levels.wideDb, 0.8) - RESIDUE_BELOW_SPEECH_DB
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

