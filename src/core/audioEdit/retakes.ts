import { pinyin } from 'pinyin-pro'
import { normalizeAudioEditFiller } from './analysis'
import type { SpeechEnergyPause } from './speechEnergy'
import type { AudioEditRange, AudioEditSuggestion, AudioEditTranscriptBlock } from './types'

/*
 * 口播重念检测：照稿念时，念坏了（口误、没念好、在不该断的地方断开）会马上从某处重新念。
 * 文字上的信号统一是“一段 R 之后紧跟着的 T，开头与 R 高度相同”，删掉 R、留最后一遍。
 *
 * - 比对用无声调拼音（同音的识别错字也能对上），半全局对齐容忍改词、多一个或少一个字；
 * - 逐轮消解：每删一处就把前后接起来重新检测，连续多遍、A B A B 交错的重念自然收敛到最后一遍；
 * - 停顿证据只来自声音低谷（识别的词时间首尾相连，不能证明真实停顿），切点落在真实安静处；
 *   删掉的内容在两遍里有相同的部分时，删除窗口可以在这段相同内容里平移而剪后文字不变，取两头都落在停顿里的那个；
 * - 同一个英文名有时识别成字母、有时识别成同音汉字（“ima”与“艾玛”），比对前统一成汉字读音；
 * - 有参考稿时，稿子里本来就连着出现的重复（排比、强调）不删。
 *
 * 纯函数，界面、快速处理与助手共用；不读写文档。
 */

const FILLERS = new Set(['哎', '嗯', '呃', '额', '啊', '唉', '诶', '欸', '呀'])
/** 重念前常带的一个引导字（“那其实这些…”） */
const LEAD_INS = new Set(['那', '就', '哎', '嗯', '呃', '啊'])
const MAX_BACK_UNITS = 90
const MAX_BACK_MS = 30_000
const MAX_LEAD_UNITS = 10
/** 引子后整段原样重现的长度：达到它时证据足够强，引子前后只需一般的停顿 */
const VERBATIM_UNITS = 8
/** 删除窗口在两遍对应内容里平移的最大字数（足够跨过半句，把前一遍的好开头留下） */
const MAX_SHIFT_UNITS = 30
/** 换遍拼接时两头都要有的明显气口（毫秒） */
const CLEAR_PAUSE_MS = 150
/** 跟着念坏那遍一起删的碎字上限（字数） */
const STRANDED_UNITS = 2
/** 删除一处后需要重算候选的范围（词数，覆盖向前 MAX_BACK_UNITS 与向后对齐窗口） */
const RECOMPUTE_WORDS = 2 * MAX_BACK_UNITS + 2 * MAX_LEAD_UNITS + 40
/** 能算作“在停顿处重起”的最短安静（毫秒）；声音低谷本身至少 100 毫秒 */
const BOUNDARY_PAUSE_MS = 80
/** 切点离后一句开头保留的气口（毫秒） */
const BREATH_MS = 120

export type AudioEditRetakeKind = 'restart' | 'lead_in' | 'broken_start'

export interface AudioEditRetake {
  id: string
  kind: AudioEditRetakeKind
  /** 删除的词块（含其间语气词），按时间顺序 */
  blockIds: string[]
  /** 实际删除的声音范围：起止各自落在前后真实停顿里 */
  startFrame: number
  endFrame: number
  removedText: string
  keptText: string
  confidence: 'high' | 'medium' | 'low'
  /**
   * 后一遍开头前没有真实停顿（连读），接缝两侧都是语音，需要重点听。
   * 前一刀没有停顿时落在词边界上、接上的是后一遍前的停顿，听感风险小，不单独提示。
   */
  joined: boolean
}

export interface AudioEditRetakeOptions {
  sampleRate: number
  /** 声音低谷（毫秒），来自全频与高频能量分析 */
  pauses: readonly SpeechEnergyPause[]
  /** 呼吸声（毫秒）：比安静响、但同样是气口，判断接缝时与停顿同等看待 */
  breaths?: readonly { startMs: number; endMs: number }[]
  referenceScript?: string
  range?: AudioEditRange
}

interface Unit { py: string; ch: string; word: number }
interface Word {
  block: AudioEditTranscriptBlock
  startMs: number
  endMs: number
  filler: boolean
  units: Array<{ py: string; ch: string }>
}
interface Alignment { hits: number; score: number; used: number; prefix: number; anchor: number; delRun: number; insRun: number }
interface Candidate {
  kind: AudioEditRetakeKind
  first: number
  last: number
  /** 后一遍开头所在的词 */
  restartWord: number
  length: number
  ratio: number
  total: number
  pauseJ: number
}

function isHanzi(char: string): boolean {
  return char >= '一' && char <= '鿿'
}

/** 整段一起转拼音（多音字按上下文），再逐字分回各词。 */
function buildWords(blocks: readonly AudioEditTranscriptBlock[], sampleRate: number): Word[] {
  const words = blocks.map((block): Word => ({
    block, startMs: block.startFrame * 1000 / sampleRate, endMs: block.endFrame * 1000 / sampleRate,
    filler: !normalizeAudioEditFiller(block.text) || FILLERS.has(normalizeAudioEditFiller(block.text)), units: [],
  }))
  const hanzi = words.flatMap((word) => [...word.block.text].filter(isHanzi)).join('')
  const readings = hanzi ? pinyin(hanzi, { toneType: 'none', type: 'array' }) : []
  let cursor = 0
  for (const word of words) {
    for (const char of word.block.text) {
      if (isHanzi(char)) word.units.push({ py: readings[cursor++] ?? char, ch: char })
      else if (/[\p{L}\p{N}]/u.test(char)) word.units.push({ py: char.toLowerCase(), ch: char })
    }
  }
  unifyLatinReadings(words)
  return words
}

function editDistance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length]
}

/**
 * 同一个英文名，一遍识别成字母（“ima”），另一遍识别成同音汉字（“艾玛”）：逐字母比对永远对不上。
 * 字母词（3 个字母以上）在前后 MAX_BACK_MS 内找读音几乎相同（拼音连写与字母串至多差一个字母）的 2-4 个汉字，
 * 找到就改用那几个汉字的拼音比对。只影响比对，不改文字。
 */
function unifyLatinReadings(words: Word[]): void {
  const hanzi: Array<{ py: string; word: number }> = []
  words.forEach((word, index) => { for (const unit of word.units) if (isHanzi(unit.ch)) hanzi.push({ py: unit.py, word: index }) })
  if (!hanzi.length) return
  for (const word of words) {
    const letters = word.units.filter((unit) => /^[a-z]$/.test(unit.py))
    if (letters.length < 3 || letters.length !== word.units.length) continue
    const spelled = letters.map((unit) => unit.py).join('')
    let best: { distance: number; gap: number; units: string[] } | undefined
    for (let p = 0; p < hanzi.length; p++) {
      const gap = Math.abs(words[hanzi[p].word].startMs - word.startMs)
      if (gap > MAX_BACK_MS) continue
      for (let n = 2; n <= 4 && p + n <= hanzi.length; n++) {
        const units = hanzi.slice(p, p + n).map((unit) => unit.py)
        const joined = units.join('')
        if (Math.abs(joined.length - spelled.length) > 1) continue
        const distance = editDistance(joined, spelled)
        if (distance <= 1 && (!best || distance < best.distance || (distance === best.distance && gap < best.gap))) best = { distance, gap, units }
      }
    }
    if (best) word.units = best.units.map((py) => ({ py, ch: spelled }))
  }
}

function scriptUnits(text: string): string[] {
  const hanzi = [...text].filter(isHanzi).join('')
  const readings = hanzi ? pinyin(hanzi, { toneType: 'none', type: 'array' }) : []
  const result: string[] = []
  let cursor = 0
  for (const char of text) {
    if (isHanzi(char)) result.push(readings[cursor++] ?? char)
    else if (/[\p{L}\p{N}]/u.test(char)) result.push(char.toLowerCase())
  }
  return result
}

/** R 全部对齐、T 前缀自由结束的半全局对齐，带回溯统计。 */
function align(r: readonly string[], t: readonly string[]): Alignment {
  const n = r.length, m = t.length
  const MATCH = 1, MISMATCH = -0.8, DEL_R = -0.7, INS_T = -0.5
  const width = m + 1
  const score = new Float64Array((n + 1) * width)
  const move = new Uint8Array((n + 1) * width) // 1 对角 2 删 R 3 插 T
  for (let j = 1; j <= m; j++) { score[j] = j * INS_T; move[j] = 3 }
  for (let i = 1; i <= n; i++) {
    score[i * width] = i * DEL_R; move[i * width] = 2
    const ri = r[i - 1]
    for (let j = 1; j <= m; j++) {
      const diag = score[(i - 1) * width + j - 1] + (ri === t[j - 1] ? MATCH : MISMATCH)
      const del = score[(i - 1) * width + j] + DEL_R
      const ins = score[i * width + j - 1] + INS_T
      const at = i * width + j
      if (diag >= del && diag >= ins) { score[at] = diag; move[at] = 1 } else if (del >= ins) { score[at] = del; move[at] = 2 } else { score[at] = ins; move[at] = 3 }
    }
  }
  let used = 0
  for (let j = 1; j <= m; j++) if (score[n * width + j] > score[n * width + used]) used = j
  const path: number[] = []
  let hits = 0
  for (let i = n, j = used; i > 0 || j > 0;) {
    const step = move[i * width + j]
    if (step === 1) { const same = r[i - 1] === t[j - 1]; hits += same ? 1 : 0; path.push(same ? 1 : 0); i--; j-- } else if (step === 2) { path.push(2); i-- } else { path.push(3); j-- }
  }
  path.reverse()
  const longest = (kind: number): number => { let best = 0, run = 0; for (const step of path) { run = step === kind ? run + 1 : 0; best = Math.max(best, run) } return best }
  let prefix = 0
  while (prefix < path.length && path[prefix] === 1) prefix++
  return { hits, score: score[n * width + used], used, prefix, anchor: path.slice(0, 4).filter((step) => step === 1).length, delRun: longest(2), insRun: longest(3) }
}

class RetakeDetector {
  readonly kept: boolean[]
  private readonly alignments = new Map<string, Alignment>()
  private readonly accepted: Candidate[] = []
  private readonly script: string[]
  private readonly scriptIndex = new Map<string, number[]>()

  constructor(private readonly words: readonly Word[], private readonly options: AudioEditRetakeOptions) {
    this.kept = words.map((word) => word.block.included)
    this.script = options.referenceScript?.trim() ? scriptUnits(options.referenceScript) : []
    this.script.forEach((py, index) => { const list = this.scriptIndex.get(py); if (list) list.push(index); else this.scriptIndex.set(py, [index]) })
  }

  /** 区间内的气口（毫秒）：声音低谷与呼吸声 */
  private quietRuns(startMs: number, endMs: number): Array<[number, number]> {
    const runs = [...this.options.pauses, ...(this.options.breaths ?? [])]
      .filter((pause) => pause.endMs > startMs && pause.startMs < endMs)
      .map((pause): [number, number] => [Math.max(startMs, pause.startMs), Math.min(endMs, pause.endMs)])
      .sort((x, y) => x[0] - y[0])
    // 停顿紧接着呼吸（或反过来）是同一个气口，合并后再量长度
    const merged: Array<[number, number]> = []
    for (const run of runs) {
      const last = merged.at(-1)
      if (last && run[0] <= last[1] + 20) last[1] = Math.max(last[1], run[1])
      else merged.push([run[0], run[1]])
    }
    return merged.filter(([start, end]) => end - start >= 40)
  }

  private previousKept(k: number): number {
    let prev = k - 1
    while (prev >= 0 && (!this.kept[prev] || this.words[prev].filler)) prev--
    return prev
  }

  /** 第 k 个词之前的真实停顿：上一个保留实词的后半到本词开头之间最长的安静段。 */
  private pauseBefore(k: number): number {
    const prev = this.previousKept(k)
    if (prev < 0) return 1000
    const a = this.words[prev], b = this.words[k]
    return Math.max(0, ...this.quietRuns((a.startMs + a.endMs) / 2, b.startMs + 60).map(([start, end]) => end - start))
  }

  private sequence(): Unit[] {
    const units: Unit[] = []
    this.words.forEach((word, index) => {
      if (this.kept[index] && !word.filler) for (const unit of word.units) units.push({ ...unit, word: index })
    })
    return units
  }

  private inRange(first: number, last: number): boolean {
    const range = this.options.range
    if (!range) return true
    return this.words[first].block.startFrame >= range.startFrame && this.words[last - 1].block.endFrame <= range.endFrame
  }

  private removable(first: number, last: number): boolean {
    for (let k = first; k < last; k++) if (this.words[k].block.locked) return false
    return this.inRange(first, last)
  }

  /** 稿子里本来就连着出现 R 与 T 开头（排比、强调），不是重念。 */
  private scripted(r: readonly string[], t: readonly string[]): boolean {
    if (this.script.length === 0 || r.length < 2) return false
    const probe = [...r, ...t.slice(0, 8)]
    for (const start of this.scriptIndex.get(probe[0]) ?? []) {
      if (this.script[start + 1] !== probe[1]) continue
      const a = align(probe, this.script.slice(start, start + Math.ceil(probe.length * 1.3) + 4))
      if (a.hits / probe.length >= 0.9 && a.delRun <= Math.max(2, Math.floor(probe.length / 6))) return true
    }
    return false
  }

  /** 只为重起词落在 [fromWord, toWord] 内的位置生成候选（逐轮消解时只重算改动附近）。 */
  private candidates(seq: readonly Unit[], fromWord = 0, toWord = Number.POSITIVE_INFINITY): Candidate[] {
    const starts: number[] = []
    for (let k = 0; k < seq.length; k++) if (k === 0 || seq[k].word !== seq[k - 1].word) starts.push(k)
    const startSet = new Set(starts)
    const pys = seq.map((unit) => unit.py)
    const found: Candidate[] = []
    for (const j of starts) {
      if (seq[j].word < fromWord || seq[j].word > toWord) continue
      const pauseJ = this.pauseBefore(seq[j].word)
      for (let lead = 0; lead <= MAX_LEAD_UNITS; lead++) {
        const jj = j + lead
        if (jj + 1 >= seq.length) break
        const kind: AudioEditRetakeKind = lead === 0 || (lead === 1 && LEAD_INS.has(seq[j].ch)) ? 'restart' : 'lead_in'
        if (kind === 'lead_in' && (pauseJ < BOUNDARY_PAUSE_MS || !startSet.has(jj))) continue
        for (let i = Math.max(0, j - MAX_BACK_UNITS); i < j - 1; i++) {
          if (!startSet.has(i) || pys[i] !== pys[jj]) continue
          // 开头第 2-3 个字里至少再对上一个（容忍多/少一个字），否则不可能满足下面的开头一致要求
          if (pys[i + 1] !== pys[jj + 1] && pys[i + 1] !== pys[jj + 2] && pys[i + 2] !== pys[jj + 1] && pys[i + 2] !== pys[jj + 2]) continue
          if (this.words[seq[jj].word].startMs - this.words[seq[i].word].startMs > MAX_BACK_MS) continue
          const length = j - i
          const r = pys.slice(i, j)
          const t = pys.slice(jj, jj + Math.floor(length * 1.6) + 6)
          const key = `${seq[i].word}:${seq[j - 1].word}:${length}|${seq[jj].word}:${t.length}`
          let a = this.alignments.get(key)
          if (!a) { a = align(r, t); this.alignments.set(key, a) }
          const ratio = a.hits / length
          const pauseI = this.pauseBefore(seq[i].word)
          if (kind === 'lead_in') {
            // 重念前加了一段引子：R 自成一段（前后都有停顿）、整段几乎原样出现。
            // 8 字以上整段原样重现（“如果查到了能对比的。｜那这里呢，你会发现，如果查到了能对比的数据”）证据已经足够，
            // 前后只需一般的停顿；更短或有改动的仍要求明显停顿
            const verbatim = length >= VERBATIM_UNITS && a.prefix >= length - 1
            if (length < 5 || a.prefix < 4 || ratio < 0.8) continue
            if (verbatim ? pauseI < BOUNDARY_PAUSE_MS : (pauseI < 150 || pauseJ < 250)) continue
          } else {
            // 短片段（≤5 字）必须整段是后句开头；2 字的还要求停顿（避免“谢谢谢谢”式强调）
            if (length <= 5 && (a.prefix < length || (length <= 2 && pauseJ < BOUNDARY_PAUSE_MS))) continue
            if (a.anchor < 3 && !(a.prefix >= 2 && ratio >= 0.85)) continue
          }
          const insLimit = Math.max(4, Math.floor(length / 3)) + (a.prefix >= 3 ? 2 : 0)
          if (ratio < 0.6 || a.score < 0.35 * length || a.delRun > Math.max(3, Math.floor(length / 4)) || a.insRun > insLimit) continue
          const first = seq[i].word, last = seq[j].word
          if (!this.removable(first, last) || this.scripted(r, t)) continue
          const boundary = (pauseJ >= BOUNDARY_PAUSE_MS ? 2.5 : -2) + (pauseI >= BOUNDARY_PAUSE_MS ? 1 : -1)
          found.push({ kind, first, last, restartWord: seq[j].word, length, ratio, pauseJ, total: a.score + boundary - (kind === 'lead_in' ? 2 : 0) })
        }
      }
    }
    return found
  }

  /** “但这个｜但结果说的还是挺准｜但结果说的还是挺对”：紧挨在已删重念前、2-3 字的半截起头，首字与被删那遍相同。 */
  private absorbBrokenStarts(): void {
    for (const candidate of [...this.accepted]) {
      const head = this.words[candidate.first].units[0]?.py
      if (!head) continue
      let k = candidate.first - 1
      while (k >= 0 && this.words[k].filler) k--
      let size = 0
      for (; k >= 0 && this.kept[k] && !this.words[k].filler && size < 3; k--) {
        size += this.words[k].units.length
        if (size >= 2 && size <= 3 && this.words[k].units[0]?.py === head && this.removable(k, candidate.first)) {
          for (let w = k; w < candidate.first; w++) this.kept[w] = false
          this.accepted.push({ kind: 'broken_start', first: k, last: candidate.first, restartWord: candidate.first, length: size, ratio: 1 / size, total: 0, pauseJ: candidate.pauseJ })
          break
        }
      }
    }
  }

  /** 第 k 个词开头前的安静长度（毫秒），取法与切点一致：上一个实词中点到本词开头之间最长的安静段。 */
  private seamQuiet(k: number): number {
    if (k <= 0 || k >= this.words.length) return 1000
    let anchor = k - 1
    while (anchor > 0 && this.words[anchor].filler) anchor--
    const prev = this.words[anchor], cur = this.words[k]
    return Math.max(0, ...this.quietRuns((prev.startMs + prev.endMs) / 2, cur.startMs + 60).map(([start, end]) => end - start))
  }

  /**
   * “方向。｜那｜这个工具最重要的部分呢…｜这工具最重要的部分”：删除段左边紧贴着（中间没有停顿）、自己前面有气口的
   * 一两个字，是念坏那一遍的起头。留下它去接几秒后的另一遍，语气接不上，听着突兀——跟着那一遍一起删。
   * 后一遍本来就以这几个字开头时不算（那是重念的一部分）。
   */
  private absorbStrandedLeads(): void {
    const removed = (k: number): boolean => !this.kept[k] && this.words[k].block.included
    for (let a = 0; a < this.words.length; a++) {
      if (this.words[a].filler || !removed(a) || (a > 0 && (removed(a - 1) || this.words[a - 1].filler && a > 1 && removed(a - 2)))) continue
      if (this.seamQuiet(a) >= BOUNDARY_PAUSE_MS) continue
      const fragment: number[] = []
      let size = 0
      for (let k = a - 1; k >= 0 && this.kept[k]; k--) {
        if (this.words[k].filler) continue
        size += this.words[k].units.length
        if (size > STRANDED_UNITS) { fragment.length = 0; break }
        fragment.unshift(k)
        if (this.pauseBefore(k) >= BOUNDARY_PAUSE_MS) break
        if (k > 0 && this.seamQuiet(k) >= BOUNDARY_PAUSE_MS) break
      }
      const head = fragment[0]
      if (head === undefined || this.pauseBefore(head) < BOUNDARY_PAUSE_MS || !this.removable(head, a)) continue
      let next = a
      while (next < this.words.length && (removed(next) || this.words[next].filler)) next++
      const text = fragment.map((k) => normalizeAudioEditFiller(this.words[k].block.text)).join('')
      if (next < this.words.length && normalizeAudioEditFiller(this.words[next].block.text).startsWith(text)) continue
      for (let k = head; k < a; k++) this.kept[k] = false
      this.accepted.push({ kind: 'broken_start', first: head, last: a, restartWord: next, length: size, ratio: 1, total: 0, pauseJ: this.pauseBefore(head) })
    }
  }

  /**
   * 换遍拼接：原切点有一头没有气口（连读）时，在两遍对应的内容里找另一组切点——前一遍念到某个明显气口为止，
   * 后一遍从对应位置的气口接上，中间删掉；“…太多了一个API KEY。｜一个API KEY 发个…”、
   * “这个工具最重要的部分呢，就是这个搜索api了，｜…这工具最重要的部分就是搜索api了，因为它是…”都属于这种。
   * 两遍的对应按拼音对齐（容忍改词、多少一个字），两头都要有至少 CLEAR_PAUSE_MS 的停顿或呼吸才换；
   * 平移不跨过整个删除段——整遍换成前一遍等于改留前一遍，而文字一样不代表念得一样好。
   */
  private realignSeams(): void {
    const removed = (k: number): boolean => !this.kept[k] && this.words[k].block.included
    // 平移后可能和相邻的删除连成一段：从连起来那段的开头重新看；每次移动都严格变好，次数有限
    for (let a = 0, moves = 0; a < this.words.length;) {
      if (this.words[a].filler || !removed(a)) { a++; continue }
      let b = a
      while (b < this.words.length && (this.words[b].filler || removed(b))) b++
      let end = b
      while (end > a && this.words[end - 1].filler) end--
      const moved = moves < this.words.length ? this.shiftRun(a, end) : -1
      if (moved < 0) { a = b; continue }
      moves++
      a = moved
      while (a > 0 && (this.words[a - 1].filler || removed(a - 1))) a--
    }
  }

  /** 返回平移后删除段的第一个词；没有移动时返回 -1。 */
  private shiftRun(a: number, end: number): number {
    const SEAM_CAP = 300
    const present = (k: number): boolean => !this.words[k].filler && (this.kept[k] || (k >= a && k < end))
    const before: number[] = [], after: number[] = []
    for (let k = a - 1, size = 0; k >= 0 && size < MAX_SHIFT_UNITS + 8; k--) if (present(k)) { before.unshift(k); size += this.words[k].units.length }
    for (let k = end, size = 0; k < this.words.length && size <= MAX_SHIFT_UNITS + 8; k++) if (present(k)) { after.push(k); size += this.words[k].units.length }
    const order = [...before, ...Array.from({ length: end - a }, (_, offset) => a + offset).filter((k) => !this.words[k].filler), ...after]
    const units = order.flatMap((k) => this.words[k].units.map((unit) => ({ py: unit.py, word: k })))
    const pys = units.map((unit) => unit.py)
    const ua = before.reduce((size, k) => size + this.words[k].units.length, 0)
    const ub = units.findIndex((unit, index) => index >= ua && unit.word >= end)
    const runEnd = ub < 0 ? units.length : ub
    if (runEnd <= ua) return -1
    const wordStart = (index: number): boolean => index === 0 || index === units.length || units[index].word !== units[index - 1].word
    // 切点前一个实词也被删（与另一处删除相连）时，切点由那一处决定，与平移无关
    const quietAt = (k: number): number => {
      let prev = k - 1
      while (prev >= 0 && this.words[prev].filler) prev--
      if (prev >= 0 && !this.kept[prev] && this.words[prev].block.included && !(prev >= a && prev < end)) return SEAM_CAP
      return Math.min(SEAM_CAP, this.seamQuiet(k))
    }
    const seams = (x: number, y: number): [number, number] => [quietAt(units[x].word), y < units.length ? quietAt(units[y].word) : SEAM_CAP]
    if (Math.min(...seams(ua, runEnd)) >= BOUNDARY_PAUSE_MS) return -1
    /** r 与 t 的开头对应：短的要逐字相同，长的拼音对齐命中八成以上；返回 t 用掉的字数 */
    const correspond = (r: readonly string[], t: readonly string[]): number | null => {
      if (r.length <= 3) return r.every((py, i) => py === t[i]) ? r.length : null
      const aligned = align(r, t)
      return aligned.hits / r.length >= 0.8 && aligned.delRun <= 2 ? aligned.used : null
    }
    const span = runEnd - ua
    let best: { x: number; y: number; score: number } | undefined
    const consider = (x: number, y: number): void => {
      if (x < 0 || y > units.length || y <= x || !wordStart(x) || !wordStart(y)) return
      const [start, finish] = seams(x, y)
      if (Math.min(start, finish) < CLEAR_PAUSE_MS) return
      const score = start + finish
      if (!best || score > best.score || (score === best.score && Math.abs(x - ua) < Math.abs(best.x - ua))) best = { x, y, score }
    }
    for (let shift = 1; shift <= Math.min(MAX_SHIFT_UNITS, span - 1); shift++) {
      // 向右：前一遍多留 shift 个字，后一遍从对应位置接
      if (!wordStart(ua + shift)) continue
      const used = correspond(pys.slice(ua, ua + shift), pys.slice(runEnd, runEnd + shift + 6))
      if (used !== null) consider(ua + shift, runEnd + used)
    }
    for (let shift = 1; shift <= Math.min(MAX_SHIFT_UNITS, span - 1, ua); shift++) {
      // 向左：删掉切点前已保留的 shift 个字，改留删除段末尾对应的那几个字
      if (!wordStart(ua - shift)) continue
      const used = correspond(pys.slice(ua - shift, ua).reverse(), pys.slice(Math.max(ua, runEnd - shift - 6), runEnd).reverse())
      if (used !== null) consider(ua - shift, runEnd - used)
    }
    if (!best) return -1
    const first = units[best.x].word, last = units[best.y - 1].word + 1
    if (!this.removable(first, last)) return -1
    for (let k = a; k < end; k++) this.kept[k] = this.words[k].block.included
    for (let k = first; k < last; k++) this.kept[k] = false
    for (const candidate of this.accepted) if (candidate.first >= a && candidate.first < end) { candidate.first = first; candidate.last = last }
    return first
  }

  run(): Candidate[] {
    let pool = this.candidates(this.sequence())
    while (pool.length) {
      const best = pool.reduce((a, b) => (b.total > a.total || (b.total === a.total && b.length > a.length) ? b : a))
      for (let k = best.first; k < best.last; k++) this.kept[k] = false
      this.accepted.push(best)
      // 候选只向前看 MAX_BACK_UNITS、向后看约 1.6 倍长度，每个词至少一个比对单元；按词数留足余量即可只重算改动附近
      const from = best.first - RECOMPUTE_WORDS, to = best.last + RECOMPUTE_WORDS
      pool = [...pool.filter((c) => c.restartWord < from || c.restartWord > to), ...this.candidates(this.sequence(), from, to)]
    }
    this.absorbBrokenStarts()
    // 先试换遍拼接（能留下前一遍的好开头）；换不了再把贴着念坏那遍的碎字一起删
    this.realignSeams()
    this.absorbStrandedLeads()
    return this.accepted
  }

  /** 删除区间 [first, last) 的切点：在边界前到上一个实词中点之间找安静段（可越过相邻语气词），
   * 优先最长的一段；更靠后的一段也够长（≥最长的一半）时取靠后的，把没识别出来的“呃”留在删除侧。 */
  boundary(k: number): { ms: number; joined: boolean } {
    if (k <= 0) return { ms: this.words[0]?.startMs ?? 0, joined: false }
    if (k >= this.words.length) return { ms: this.words.at(-1)?.endMs ?? 0, joined: false }
    let anchor = k - 1
    while (anchor > 0 && this.words[anchor].filler) anchor--
    const prev = this.words[anchor], cur = this.words[k]
    const runs = this.quietRuns((prev.startMs + prev.endMs) / 2, cur.startMs + 60)
    if (runs.length) {
      const longest = Math.max(...runs.map(([start, end]) => end - start))
      const [start, end] = runs.filter(([a, b]) => b - a >= longest / 2).at(-1)!
      return { ms: Math.max(start + (end - start) / 2, end - BREATH_MS), joined: false }
    }
    return { ms: Math.max(prev.endMs, cur.startMs), joined: true }
  }
}

function confidenceOf(candidate: Candidate): AudioEditRetake['confidence'] {
  if (candidate.kind === 'restart' && candidate.ratio >= 0.85 && candidate.pauseJ >= BOUNDARY_PAUSE_MS) return 'high'
  if (candidate.kind === 'restart' && candidate.ratio >= 0.7) return 'medium'
  return 'low'
}

/** 检测重念并给出删除方案。只在逐词转写上工作；已删除的词视为不存在，锁定的词不删。 */
export function detectAudioEditRetakes(blocks: readonly AudioEditTranscriptBlock[], options: AudioEditRetakeOptions): AudioEditRetake[] {
  const ordered = [...blocks].filter((block) => block.granularity === 'word').sort((a, b) => a.startFrame - b.startFrame)
  if (ordered.length < 2) return []
  const words = buildWords(ordered, options.sampleRate)
  const detector = new RetakeDetector(words, options)
  const accepted = detector.run()
  const removed = words.map((word, index) => word.block.included && !detector.kept[index])
  const retakes: AudioEditRetake[] = []
  for (let k = 0; k < words.length;) {
    if (!removed[k]) { k++; continue }
    const first = k
    while (k < words.length && (removed[k] || (words[k].filler && words[k].block.included && removed[k + 1]))) k++
    const items = accepted.filter((candidate) => candidate.first >= first && candidate.first < k)
    const levels = items.map(confidenceOf)
    const start = detector.boundary(first), end = detector.boundary(k)
    const span = words.slice(first, k)
    const startFrame = Math.round(start.ms * options.sampleRate / 1000)
    const endFrame = Math.max(startFrame + 1, Math.round(end.ms * options.sampleRate / 1000), span.at(-1)!.block.endFrame)
    const keptAfter = words.slice(k).filter((word, offset) => detector.kept[k + offset]).slice(0, 12)
    retakes.push({
      id: `retake:${span[0].block.id}:${span.at(-1)!.block.id}`,
      kind: items.some((item) => item.kind === 'restart') ? 'restart' : items.some((item) => item.kind === 'lead_in') ? 'lead_in' : 'broken_start',
      blockIds: span.map((word) => word.block.id),
      startFrame: Math.min(startFrame, span[0].block.startFrame),
      endFrame,
      removedText: span.map((word) => word.block.text).join(''),
      keptText: keptAfter.map((word) => word.block.text).join(''),
      confidence: levels.includes('low') ? 'low' : levels.includes('medium') ? 'medium' : 'high',
      joined: end.joined,
    })
  }
  return retakes
}

const clip = (text: string, size: number): string => (text.length > size ? `${text.slice(0, size)}…` : text)

/** 重念 → 剪辑线索：删除这些词，并剪掉其间与前后的停顿；恢复其中任一词时停顿一并恢复。 */
export function audioEditRetakeSuggestion(retake: AudioEditRetake): AudioEditSuggestion {
  return {
    id: retake.id,
    kind: 'retake',
    evidence: 'audio',
    title: `重念“${clip(retake.removedText, 18)}”`,
    detail: `后面重新念了“${clip(retake.keptText, 18)}”，保留最后一遍${retake.joined ? '；接缝处没有停顿，请试听' : ''}。`,
    startFrame: retake.startFrame,
    endFrame: retake.endFrame,
    blockIds: retake.blockIds,
    confidence: retake.confidence,
    status: 'pending',
  }
}
