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
  return words
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

  /** 区间内被声音低谷覆盖的安静段（毫秒） */
  private quietRuns(startMs: number, endMs: number): Array<[number, number]> {
    return this.options.pauses
      .filter((pause) => pause.endMs > startMs && pause.startMs < endMs)
      .map((pause): [number, number] => [Math.max(startMs, pause.startMs), Math.min(endMs, pause.endMs)])
      .filter(([start, end]) => end - start >= 40)
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
        if (kind === 'lead_in' && (pauseJ < 250 || !startSet.has(jj))) continue
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
            // 重念前加了一段引子：R 自成一段（前后都有停顿）、整段几乎原样出现
            if (length < 5 || pauseI < 150 || a.prefix < 4 || ratio < 0.8) continue
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
