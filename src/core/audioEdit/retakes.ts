import { pinyin } from 'pinyin-pro'
import { normalizeAudioEditFiller } from './analysis'
import type { SpeechEnergyPause } from './speechEnergy'
import type { AudioEditRange, AudioEditSuggestion, AudioEditTranscriptBlock } from './types'
import { alignToScript } from './contentCoordinates'
import { findResidualRetakes } from './retakeSelfCheck'
import { selectTakeSegments } from './takePath'

/*
 * 口播重念检测：照稿念时，念坏了（口误、没念好、在不该断的地方断开）会马上从某处重新念。
 * 同一内容念了几遍，留最后一遍。
 *
 * - 重念的证据有两种：两遍文字几乎相同（一段 R 之后紧跟着的 T，开头与 R 高度相同）；有参考稿时，把念的字对到稿子上，
 *   往回跳的地方就是重念的起点（见 contentCoordinates），换了说法的那遍也认得出来；
 * - 比对用无声调拼音（同音的识别错字也能对上），容忍改词、多一个或少一个字；
 * - 每处重念连同它的几种剪法（留最后一遍、换遍拼接、连带贴着的碎字）各有一个分数：证据分加两头的接缝分。
 *   全部候选放在一起，全局选出总分最高的一组（见 takePath），不是逐条取最高分再回头修补；
 * - 停顿证据只来自声音低谷（识别的词时间首尾相连，不能证明真实停顿），切点落在真实安静处；
 * - 同一个英文名有时识别成字母、有时识别成同音汉字（“ima”与“艾玛”），比对前统一成汉字读音；
 * - 有参考稿时，稿子里本来就连着出现的重复（排比、强调）不删。
 *
 * 纯函数，界面、快速处理与助手共用；不读写文档。
 */

/** 不算内容的词：单独成词的语气词、叹词、句末助词（两遍只差一个“呢”“啊”不算不同），以及单独说出来的“不对” */
const FILLERS = new Set(['哎', '嗯', '呃', '额', '啊', '唉', '诶', '欸', '呀', '哇', '哦', '呢', '吧', '嘛', '不对'])
/** 重念前常带的一个引导字（“那其实这些…”） */
const LEAD_INS = new Set(['那', '就', '哎', '嗯', '呃', '啊'])
const MAX_BACK_UNITS = 90
const MAX_BACK_MS = 30_000
const MAX_LEAD_UNITS = 10
/** 引子后整段原样重现的长度：达到它时证据足够强，引子前后只需一般的停顿 */
const VERBATIM_UNITS = 8
/** 删除窗口在两遍对应内容里平移的最大字数（足够跨过半句，把前一遍的好开头留下） */
const MAX_SHIFT_UNITS = 30
/** 明显的气口（毫秒）：接缝落在这么长的安静里就算好接缝 */
const CLEAR_PAUSE_MS = 150
/** 每多删一个字加的分，远小于 COVER_WEIGHT：取代得一样完整时，把夹在几遍之间的碎话一并删掉的那种胜出 */
const EXTENT_WEIGHT = 0.2
/** 没对上稿子、开头又与后面相同的那截话，最长看这么多字 */
const MAX_ABANDONED_UNITS = 30
/** 前面没有停顿的地方回跳多付的代价 */
const UNPAUSED_JUMP_COST = 2
/** 后一遍开头那截念完之后停了这么久（毫秒），说明那是完整的一小句：整句都重念了就留最后一遍，不换遍 */
const CLAUSE_END_PAUSE_MS = 350
/**
 * 每删掉一个被后一遍取代的字加的分。选哪几处删只按“取代了多少字”累加，不按处数给分：
 * 同一句连念三遍，删成“第一遍、第二遍”两段和删成一整段应该一样好，后者还能带走夹在中间的碎话。
 */
const COVER_WEIGHT = 0.5
/**
 * 删除段的起点、终点各自落在连读上时扣的分（按最好的那种剪法看）：重念总是停一下再起，两头连读的候选要么让位给落在停顿处的，
 * 要么（取代的内容太少时）扣成负分、只列为待确认。取值使七个字原样重念、有一头连读时刚好仍为正分（两段录音里连读重念的最短实例“从千兆交换机的重｜从…”），更短的扣成负分
 */
const JOINED_COST = 4.5
/** 不按接缝筛掉的候选扣完分后的最低分 */
const FLOOR_WEIGHT = 0.05
/** 在互相重叠的候选之间排先后时，连读扣分只计这个比例 */
const JOINED_RANK_SHARE = 0.25
/** 同一个重起位置最多保留的候选数 */
const CANDIDATES_PER_RESTART = 4
/**
 * 同一截话（最长 MAX_LOOP_PERIOD 个字）连着重复 MIN_LOOP_REPEATS 遍以上算一处“连着重复”，不参与逐对比较（否则一段循环会产生成百上千个候选）。
 * 只有成句的话（LOOP_AUTO_UNITS 个字以上）重复 LOOP_AUTO_REPEATS 遍以上才当成识别模型的循环输出自动折叠、只留最后一遍：
 * 人有意的叠句（“加油！加油！加油！加油！”“谢谢谢谢”“哈哈哈哈哈哈”“一二一二”、报电话号码）是短词重复几遍，够不上这两条，只列待确认。
 * 识别幻觉循环通常是整句重复几十上百遍；十二遍是人一口气有意重复同一整句几乎不会超过的次数。
 */
const MAX_LOOP_PERIOD = 40
const MIN_LOOP_REPEATS = 4
const LOOP_AUTO_UNITS = 4
const NUMERALS = new Set([...'0123456789零一二三四五六七八九十百千万幺两'])
const LOOP_AUTO_REPEATS = 12
/** 前一遍里后一遍没再说的字超过这个比例（且多于两个字），没有稿子佐证就不自动删 */
const UNSAID_RATIO = 0.3
/**
 * 两遍各自都是说完的一句时，“几乎相同”才自动删：前一遍至少这么多字（短句原样重复多是强调、叠句），
 * 不同的字不超过这个比例且只在一处（十几个字的句子里改一个词，约一成）。八个字以下的原样重复常见于口号与歌词式叠句（“一闪一闪亮晶晶”七个字）
 */
const NEAR_IDENTICAL_UNITS = 8
/** 两遍一字不差（忽略标点与语气词）时，前一遍至少这么多字就自动删：“我就这么一点，｜我就这么一点，”是明显的重念；“加油，加油”“真的，真的”都在四个字以内 */
const IDENTICAL_UNITS = 6
const NEAR_IDENTICAL_DIFF = 0.15
/** 改掉、多出或少掉的那一个词最多这么多字 */
const NEAR_IDENTICAL_WORD = 3
/** 常做上一句结尾或下一句开头的单字：它后面的词碰巧同字开头（“我的，的确”）不当口吃 */
const COMMON_SINGLE_WORDS = new Set([...'的了是在不我你他她它这那就也都还很有和'])
/** 接缝分的满分：下刀处有 CLEAR_PAUSE_MS 以上的安静 */
const SEAM_WEIGHT = 2
/** 换遍拼接每平移一个字扣的分：两头接缝一样好时留最后一遍 */
const SHIFT_COST = 0.05
/** 半截起头（“但这个｜但结果…”）一起删的加分：比接缝分的满分高，接缝差一点也要带走 */
const BROKEN_START_BONUS = 2.5
/** 连带删掉贴着的虚字的代价：比一个连读接缝换成停顿接缝的收益小 */
const LOOSE_LEAD_COST = 0.5
/** 贴在念坏那遍前面、可以跟着一起删的虚字；实词不在此列，“但是、所以、而且、其实”带着前后句的逻辑关系，也不在此列 */
const LOOSE_LEADS = new Set(['那', '就', '好', '那个', '这个', '然后', '就是', '那么'])
/** 一处删除能影响到的候选范围（词数）：往前 MAX_BACK_UNITS 个字、往后一个对齐窗口，每个词至少一个字 */
const NEARBY_WORDS = 2 * MAX_BACK_UNITS + 2 * MAX_LEAD_UNITS + 40
/** 对稿只在头两轮做：整份录音对一遍稿子是最贵的一步，而连念几遍的重念第一轮就按整段删掉了，后面几轮只剩两遍相同的零头 */
const SCRIPT_ROUNDS = 2
/** 删完一轮后原先隔开的两遍可能相邻，最多再看这么多轮 */
const MAX_ROUNDS = 4
/** 能算作“在停顿处重起”的最短安静（毫秒）；声音低谷本身至少 100 毫秒 */
const BOUNDARY_PAUSE_MS = 80
/** 念坏了马上重来时常带的口头标记 */
const RESTART_MARKERS = new Set(['哎', '唉', '诶', '欸', '不对'])
/** “哎”之后重来：后一遍开头与前面某句开头逐字相同的最少字数 */
const MARKER_PREFIX_UNITS = 4
/** 切点离后一句开头保留的气口（毫秒） */
const BREATH_MS = 120
/** 成片自检每 10 分钟录音最多提这么多条：多了没人逐条看 */
const SELF_CHECK_PER_TEN_MINUTES = 8
/** 每自动剪掉一处重念，清单上限相应放宽的条数，以及放宽的封顶倍数 */
const SELF_CHECK_PER_RETAKE = 0.5
const SELF_CHECK_MAX_FACTOR = 3

type AudioEditRetakeKind = 'restart' | 'lead_in' | 'broken_start'

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
  /** 拿不准（换了说法、没有参考稿佐证，或连着念的口吃）：只作为待确认的线索，不自动删 */
  review: boolean
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
interface Alignment {
  hits: number; score: number; used: number; prefix: number; anchor: number; delRun: number; insRun: number
  /** 开头三步里就有一个字被换成了别的字（“第一步…｜第二步…”），不是多一个少一个字 */
  earlySubstitution: boolean
  /** 两遍不一样的地方有几处（连着不一样的字算一处） */
  diffBlocks: number
  /** 前一遍末尾多出来、后一遍没有的字数（说了半截没说下去的尾巴） */
  tail: number
}
interface Candidate {
  kind: AudioEditRetakeKind
  first: number
  last: number
  /** 后一遍开头所在的词 */
  restartWord: number
  length: number
  ratio: number
  /** 证据分，不含接缝 */
  weight: number
  /** 证据成立但可能是有意的重复（强调、列举）：不自动删，只列为待确认 */
  unsure?: boolean
  /** 参考稿佐证过：后一遍是稿子里的话，稿子里没有把它写两遍 */
  corroborated?: boolean
  /** 被后一遍重新念到的字数 */
  covered: number
  pauseJ: number
  /** 凭什么判定是重念：match 整段与后一遍开头几乎一致；marker “哎”之后从前一句开头重来；script 对稿时在这里往回跳；stutter 口吃；loop 同一截话连着重复很多遍 */
  evidence: 'match' | 'marker' | 'script' | 'stutter' | 'loop'
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

/** 把连着的英文字母、数字并成一个字；starts 是每个并后的字在原序列里的起点。 */
function mergeLatin(units: readonly string[]): { tokens: string[]; starts: number[] } {
  const tokens: string[] = [], starts: number[] = []
  units.forEach((unit, index) => {
    const latin = /^[a-z0-9]$/.test(unit)
    if (latin && index > 0 && /^[a-z0-9]$/.test(units[index - 1])) tokens[tokens.length - 1] += unit
    else { tokens.push(unit); starts.push(index) }
  })
  return { tokens, starts }
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
  return { hits, score: score[n * width + used], used, prefix, anchor: path.slice(0, 4).filter((step) => step === 1).length, delRun: longest(2), insRun: longest(3), earlySubstitution: path.slice(0, 3).includes(0), diffBlocks: path.filter((step, index) => step !== 1 && (index === 0 || path[index - 1] === 1)).length, tail: path.length - 1 - path.findLastIndex((step) => step !== 2) }
}

class RetakeDetector {
  readonly kept: boolean[]
  private readonly alignments = new Map<string, Alignment>()
  private readonly locations = new Map<string, { pos: number; ratio: number } | undefined>()
  private readonly accepted: Candidate[] = []
  readonly script: string[]
  private readonly scriptIndex = new Map<string, number[]>()
  /** 全部气口（声音低谷与呼吸，毫秒），按时间排好、相连的已合并 */
  private readonly quiet: Array<[number, number]> = []

  constructor(private readonly words: readonly Word[], private readonly options: AudioEditRetakeOptions) {
    this.kept = words.map((word) => word.block.included)
    this.script = options.referenceScript?.trim() ? scriptUnits(options.referenceScript) : []
    this.script.forEach((py, index) => { const list = this.scriptIndex.get(py); if (list) list.push(index); else this.scriptIndex.set(py, [index]) })
    // 停顿紧接着呼吸（或反过来）是同一个气口，合并后再量长度
    const runs = [...options.pauses, ...(options.breaths ?? [])].map((pause): [number, number] => [pause.startMs, pause.endMs]).sort((x, y) => x[0] - y[0])
    for (const run of runs) {
      const last = this.quiet.at(-1)
      if (last && run[0] <= last[1] + 20) last[1] = Math.max(last[1], run[1])
      else this.quiet.push(run)
    }
    // “不对”只有停一下单独说出来才是重来的标记；连在话里的（“这个做法不对。”）是内容
    words.forEach((word, index) => { if (normalizeAudioEditFiller(word.block.text) === '不对' && index > 0 && this.seamQuiet(index) < BOUNDARY_PAUSE_MS) word.filler = false })
  }

  /** 区间内的气口（毫秒）：声音低谷与呼吸声 */
  private quietRuns(startMs: number, endMs: number): Array<[number, number]> {
    let low = 0, high = this.quiet.length
    while (low < high) { const middle = (low + high) >> 1; if (this.quiet[middle][1] > startMs) high = middle; else low = middle + 1 }
    const runs: Array<[number, number]> = []
    for (let k = low; k < this.quiet.length && this.quiet[k][0] < endMs; k++) {
      const start = Math.max(startMs, this.quiet[k][0]), end = Math.min(endMs, this.quiet[k][1])
      if (end - start >= 40) runs.push([start, end])
    }
    return runs
  }

  private previousKept(k: number): number {
    let prev = k - 1
    while (prev >= 0 && (!this.kept[prev] || this.words[prev].filler)) prev--
    return prev
  }

  /** 第 k 个词之前的真实停顿：上一个保留实词的后半到本词开头之间最长的安静段。 */
  pauseBefore(k: number): number {
    const prev = this.previousKept(k)
    if (prev < 0) return 1000
    const a = this.words[prev], b = this.words[k]
    return Math.max(0, ...this.quietRuns((a.startMs + a.endMs) / 2, b.startMs + 60).map(([start, end]) => end - start))
  }

  private sequence(): Unit[] {
    const units: Unit[] = []
    this.words.forEach((word, index) => {
      if (this.kept[index] && !word.filler && !this.looped.has(index)) for (const unit of word.units) units.push({ ...unit, word: index })
    })
    return units
  }

  private inRange(first: number, last: number): boolean {
    const range = this.options.range
    if (!range) return true
    return this.words[first].block.startFrame >= range.startFrame && this.words[last - 1].block.endFrame <= range.endFrame
  }

  removable(first: number, last: number): boolean {
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

  /**
   * 一段读音在参考稿 [from, to) 起点范围里最像的位置与命中率。候选起点要求开头三个字里有两个对得上（容忍多、少、错一个字），
   * 常见字（的、是）在长稿子里出现上千次，只按一个字找起点会让整段比对慢上百倍。
   */
  locate(units: readonly string[], from = 0, to = this.script.length): { pos: number; ratio: number } | undefined {
    if (!this.script.length || units.length < 2) return undefined
    const key = `${units.join(' ')}|${from}|${to}`
    if (this.locations.has(key)) return this.locations.get(key)
    let best: { pos: number; ratio: number } | undefined
    const s = this.script
    const starts = new Set<number>()
    for (const at of this.scriptIndex.get(units[0]) ?? []) if (s[at + 1] === units[1] || s[at + 2] === units[1] || s[at + 1] === units[2]) starts.add(at)
    for (const at of this.scriptIndex.get(units[1]) ?? []) if (s[at + 1] === units[2] || s[at + 2] === units[2]) starts.add(at - 1)
    for (const start of starts) {
      if (start < from || start >= to) continue
      const a = align(units, this.script.slice(start, start + Math.ceil(units.length * 1.3) + 4))
      const ratio = a.hits / units.length
      if (!best || ratio > best.ratio) best = { pos: start, ratio }
    }
    this.locations.set(key, best)
    return best
  }

  /** 第 k 个词前面紧挨着（中间只有语气词）的“哎、唉”：念坏了马上重来的口头标记。 */
  private restartMarkerBefore(k: number): boolean {
    for (let w = k - 1; w >= 0 && this.words[w].filler; w--) if (this.kept[w] && RESTART_MARKERS.has(normalizeAudioEditFiller(this.words[w].block.text))) return true
    return false
  }

  /** 第 k 个词是被拆开的数字里的一位（上一个保留的词以数字结尾、本词以数字开头、中间没停顿）。 */
  private midNumber(k: number): boolean {
    const prev = this.previousKept(k)
    return prev >= 0 && /^[0-9]/.test(this.words[k].block.text.trim()) && /[0-9]$/.test(this.words[prev].block.text.trim()) && this.pauseBefore(k) < BOUNDARY_PAUSE_MS
  }

  /** R 在一句话的开头：前面有停顿，或者上一个保留的实词带标点。 */
  private phraseStart(k: number): boolean {
    const prev = this.previousKept(k)
    return prev < 0 || this.pauseBefore(k) >= BOUNDARY_PAUSE_MS || /[，。！？、；：,.!?;:…]$/.test(this.words[prev].block.text.trim())
  }

  /** 参考稿里有没有逐字连着出现这一串读音。 */
  private scriptContains(units: readonly string[]): boolean {
    return (this.scriptIndex.get(units[0]) ?? []).some((at) => units.every((unit, offset) => this.script[at + offset] === unit))
  }

  /** 一小句说完：带标点，或者后面停了一下（识别不一定给标点）。 */
  private clauseEnd(word: number): boolean {
    if (/[，。！？；,.!?;]$/.test(this.words[word].block.text.trim())) return true
    let next = word + 1
    while (next < this.words.length && (!this.kept[next] || this.words[next].filler)) next++
    return next >= this.words.length || this.pauseBefore(next) >= BOUNDARY_PAUSE_MS
  }

  /**
   * 话说到第 word 个词就告一段落：它带句末标点，或者后面停了一下。
   * 用来判断后一遍是不是说到与前一遍同样的地方也收住了。
   */
  private sentenceEndsAt(word: number): boolean {
    if (/[。！？!?]$/.test(this.words[word].block.text.trim())) return true
    const nextContent = (from: number): number => { let k = from; while (k < this.words.length && (!this.kept[k] || this.words[k].filler)) k++; return k }
    const next = nextContent(word + 1)
    return next >= this.words.length || this.pauseBefore(next) >= BOUNDARY_PAUSE_MS
  }

  /** 后一遍（从 from 到 end）说完之后，紧跟着的话又是同一个开头：三句以上同样句式的排比。 */
  private sameOpeningFollows(seq: readonly Unit[], from: number, end: number): boolean {
    let shared = 0
    while (end + shared < seq.length && from + shared < end && seq[end + shared].py === seq[from + shared].py) shared++
    return shared >= 3
  }

  /**
   * 一种剪法删掉的那段，是不是“说完的一句、后面那遍说到同样的地方也收住了”：把删掉的内容对到紧接着保留的内容上，看对到的最后一个词之后是否告一段落。
   * 换遍拼接会把删除段挪到别处，所以对实际采用的那种剪法再看一次。
   */
  private replacedByCompleteClause(option: Candidate): boolean {
    const removed = this.contentFrom(option.first, Number.POSITIVE_INFINITY).filter((k) => k < option.last)
    const units = removed.flatMap((k) => this.words[k].units.map((unit) => unit.py))
    if (!units.length) return false
    const after = this.contentFrom(option.restartWord, Math.floor(units.length * 1.6) + 6)
    const aligned = align(units, after.flatMap((k) => this.words[k].units.map((unit) => unit.py)))
    const span = Math.max(units.length, aligned.used), different = span - aligned.hits
    const nearIdentical = different === 0 ? units.length >= IDENTICAL_UNITS
      : units.length >= NEAR_IDENTICAL_UNITS && aligned.diffBlocks <= 1 && different <= Math.max(NEAR_IDENTICAL_WORD, Math.round(span * NEAR_IDENTICAL_DIFF)) && !aligned.earlySubstitution
    let size = 0
    // 逐词相同、只有最后一个词不同，后一遍说到那个词才收住：排比的样子（对齐会把不同的结尾排除在外，单独看）。
    // 后一遍在前一个词就已经收住的不算——前一遍多出来的那个词是没说完的尾巴（“…却不多，或者……｜…却不多。”）
    const text = (k: number): string => normalizeAudioEditFiller(this.words[k].block.text)
    if (removed.length >= 3 && after.length >= removed.length && removed.slice(0, -1).every((k, index) => text(k) === text(after[index])) && text(removed.at(-1)!) !== text(after[removed.length - 1]) && this.sentenceEndsAt(after[removed.length - 1]) && !this.sentenceEndsAt(after[removed.length - 2])) return true
    for (const k of after) { size += this.words[k].units.length; if (size >= aligned.used) return this.sentenceEndsAt(k) && !nearIdentical }
    return true
  }

  /** seq[i..j) 与从 seq[jj] 起同样多个词逐词相同、只有最后一个词不同，且两句都以标点收住：排比的样子。 */
  private parallelClauses(seq: readonly Unit[], i: number, j: number, jj: number): boolean {
    const wordsFrom = (from: number, limit: number): number[] => {
      const list: number[] = []
      for (let index = from; index < seq.length && list.length <= limit; index++) if (list.at(-1) !== seq[index].word) list.push(seq[index].word)
      return list.slice(0, limit)
    }
    const r = wordsFrom(i, Number.POSITIVE_INFINITY).filter((word) => word < seq[j].word)
    const t = wordsFrom(jj, r.length)
    if (r.length < 3 || t.length < r.length) return false
    const text = (word: number): string => normalizeAudioEditFiller(this.words[word].block.text)
    return r.slice(0, -1).every((word, index) => text(word) === text(t[index])) && text(r.at(-1)!) !== text(t.at(-1)!) && this.clauseEnd(r.at(-1)!) && this.clauseEnd(t.at(-1)!) && !this.sentenceEndsAt(t.at(-2)!)
  }

  /** 原有的严格条件：整段与后一遍开头几乎一致。 */
  private strict(kind: AudioEditRetakeKind, a: Alignment, length: number, ratio: number, pauseI: number, pauseJ: number): boolean {
    if (kind === 'lead_in') {
      // 重念前加了一段引子：R 自成一段（前后都有停顿）、整段几乎原样出现。
      // 8 字以上整段原样重现（“如果查到了能对比的。｜那这里呢，你会发现，如果查到了能对比的数据”）证据已经足够，
      // 前后只需一般的停顿；更短或有改动的仍要求明显停顿
      const verbatim = length >= VERBATIM_UNITS && a.prefix >= length - 1
      if (length < 5 || a.prefix < 4 || ratio < 0.8) return false
      if (verbatim ? pauseI < BOUNDARY_PAUSE_MS : (pauseI < 150 || pauseJ < 250)) return false
    } else {
      if (length <= 5) {
        // 短片段（≤5 字）必须整段是后句开头；后一遍在中间多了一个字（“那我干脆，｜那我是干脆”）也算，但要停了一下才重来。
        // 2 字的还要求停顿（避免“谢谢谢谢”式强调）
        const inserted = a.hits === length && a.insRun <= 1 && a.used <= length + 1 && a.prefix >= 2 && pauseJ >= BOUNDARY_PAUSE_MS
        if ((a.prefix < length && !inserted) || (length <= 2 && pauseJ < BOUNDARY_PAUSE_MS)) return false
      }
      if (a.anchor < 3 && !(a.prefix >= 2 && ratio >= 0.85)) return false
    }
    const insLimit = Math.max(4, Math.floor(length / 3)) + (a.prefix >= 3 ? 2 : 0)
    return !(ratio < 0.6 || a.score < 0.35 * length || a.delRun > Math.max(3, Math.floor(length / 4)) || a.insRun > insLimit)
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
   * 两遍文字几乎相同的重念（R 之后紧跟着 T，T 的开头与 R 高度相同），以及“哎”之后从前面某句开头重来的。
   * 只给出证据分，留哪些由全局选择决定。
   */
  private repeatCandidates(seq: readonly Unit[], changed?: ReadonlyArray<readonly [number, number]>): Candidate[] {
    const starts: number[] = []
    for (let k = 0; k < seq.length; k++) if (k === 0 || seq[k].word !== seq[k - 1].word) starts.push(k)
    const startSet = new Set(starts)
    const pys = seq.map((unit) => unit.py)
    // 两处之间实际说话的时长：中间已删掉的重念和停顿不算
    const spoken: number[] = [0]
    seq.forEach((unit, index) => { spoken[index + 1] = spoken[index] + (startSet.has(index) ? this.words[unit.word].endMs - this.words[unit.word].startMs : 0) })
    const found: Candidate[] = []
    for (const j of starts) {
      if (changed && !changed.some(([from, to]) => seq[j].word >= from - NEARBY_WORDS && seq[j].word <= to + NEARBY_WORDS)) continue
      const pauseJ = this.pauseBefore(seq[j].word)
      const marker = this.restartMarkerBefore(seq[j].word)
      const here: Candidate[] = []
      for (let lead = 0; lead <= MAX_LEAD_UNITS; lead++) {
        const jj = j + lead
        if (jj + 1 >= seq.length) break
        const kind: AudioEditRetakeKind = lead === 0 || (lead === 1 && LEAD_INS.has(seq[j].ch)) ? 'restart' : 'lead_in'
        if (kind === 'lead_in' && (pauseJ < BOUNDARY_PAUSE_MS || !startSet.has(jj))) continue
        for (let i = Math.max(0, j - MAX_BACK_UNITS); i < j - 1; i++) {
          if (!startSet.has(i) || pys[i] !== pys[jj]) continue
          // 开头第 2-3 个字里至少再对上一个（容忍多/少一个字），否则不可能满足下面的开头一致要求
          if (pys[i + 1] !== pys[jj + 1] && pys[i + 1] !== pys[jj + 2] && pys[i + 2] !== pys[jj + 1] && pys[i + 2] !== pys[jj + 2]) continue
          if (spoken[jj] - spoken[i] > MAX_BACK_MS) continue
          const length = j - i
          const r = pys.slice(i, j)
          const t = pys.slice(jj, jj + Math.floor(length * 1.6) + 6)
          const key = `${seq[i].word}:${seq[j - 1].word}:${length}|${seq[jj].word}:${t.length}`
          let a = this.alignments.get(key)
          if (!a) { a = align(r, t); this.alignments.set(key, a) }
          const ratio = a.hits / length
          const pauseI = this.pauseBefore(seq[i].word)
          const first = seq[i].word
          // 稿子比对较贵，放到其余条件都满足、真要提出候选时才做
          const push = (evidence: Candidate['evidence'], weight: number): void => {
            // 一两个字的重复（“真的，｜真的很好用”“数据、｜数据分析”）可能是强调或列举，没有稿子佐证时不自动删
            // 稿子里这一段后面逐字紧跟着同样的开头（“这就说明，这就说明，…”）：稿子本来就写了两遍
            if (!this.removable(first, seq[j].word) || this.scripted(r, t) || this.scriptContains([...r, ...t.slice(0, Math.min(r.length, 4))])) return
            // 后一遍对得上稿子，前一遍要么稿子里没有、要么对到的是同一处：稿子佐证了这是重念
            // （前一遍自己在稿子别处也对得上，说明两段各是稿子里的一句，不算佐证）
            const later = this.script.length > 0 ? this.locate(t.slice(0, Math.max(length, 4))) : undefined
            const earlier = later && later.ratio >= 0.8 ? this.locate(r) : undefined
            const corroborated = Boolean(later && later.ratio >= 0.8 && (!earlier || earlier.ratio < 0.5 || Math.abs(earlier.pos - later.pos) <= 2))
            // 没有稿子佐证时，按“两遍有多像”分档：
            // - 后一遍不停顿地接着往下说（比前一遍更完整）：前一遍没说完，删；但前一遍里有一大截后一遍没再说的内容时不删，删掉就丢了只说过一次的话；
            // - 两遍各自都是说完的一句：够长、几乎相同（原样，或只有一处改了一个词）是念完觉得不好再念一遍，删；
            //   短句原样重复（“加油，加油”“一闪一闪亮晶晶”）、有两处以上不同、后面还跟着同样句式的第三句，是强调、叠句、排比的样子，只列待确认；
            // - 开头就换了一个字（“第一步…｜第二步…”“一个人…｜一群人…”）是列举、对比的样子，只列待确认。
            const lastMatched = seq[Math.min(seq.length - 1, jj + a.used - 1)].word
            // 前一遍末尾多说的两三个字（“…却不多，或者……｜…却不多。”）是没说下去的尾巴，不算两遍的差别
            const tail = a.tail <= NEAR_IDENTICAL_WORD ? a.tail : 0
            const span = Math.max(length - tail, a.used), different = span - a.hits
            const nearIdentical = different === 0 ? length - tail >= IDENTICAL_UNITS
              : length >= NEAR_IDENTICAL_UNITS && a.diffBlocks - (tail ? 1 : 0) <= 1 && different <= Math.max(NEAR_IDENTICAL_WORD, Math.round(span * NEAR_IDENTICAL_DIFF))
            let doubt = length <= 2 || a.earlySubstitution
            // 前一遍的最后一个字只是后一遍某个词的开头（“…简单且精。｜…简单且精准，”）：前一遍断在词中间，没说完
            const cutMidWord = jj + a.used < seq.length && seq[jj + a.used].word === lastMatched
            if (!doubt && !cutMidWord && this.sentenceEndsAt(lastMatched)) doubt = !nearIdentical || (different > 0 && this.sameOpeningFollows(seq, jj, jj + a.used))
            else if (!doubt) doubt = length - a.hits > Math.max(2, length * UNSAID_RATIO)
            here.push({ kind, first, last: seq[j].word, restartWord: seq[kind === 'lead_in' ? jj : j].word, length, ratio, pauseJ, weight, covered: a.hits, evidence, corroborated, ...(doubt && evidence === 'match' && !corroborated ? { unsure: true } : {}) })
          }
          if (kind === 'restart' && marker && this.phraseStart(first) && (a.prefix >= MARKER_PREFIX_UNITS || (length <= 3 && a.prefix >= length))) {
            // “在这里都能看到啊！主要是为了让你放心。｜哎，｜在这里都能看到。”：“哎”之后从前面某句的开头重来，
            // 从那句开头到“哎”整段作废；前一遍后面多说的部分不必在后一遍里出现。离得最近的那个开头优先
            push('marker', Math.max(a.score, a.prefix) + 3 - length * 0.01)
            continue
          }
          // “要等到2027年，｜那2027年到底什么时候买”：前一遍是上一句的末尾（不在句首）、后一遍以“那”承接，
          // 是承上启下的重复，不是重念（“那”可能算在后一遍的引导字里，也可能落在前一遍末尾）
          const echo = kind === 'restart' && length <= VERBATIM_UNITS && (lead === 1 || LEAD_INS.has(seq[j - 1].ch)) && !this.phraseStart(first)
          // 识别把数字拆成一个个数字（2、0、2、7），重念不会从一个数字的中间开始
          // 一串数字里重复的数位（报号码“幺幺幺幺”）也不是重念
          if (echo || this.midNumber(first) || this.midNumber(seq[jj].word) || seq.slice(i, j).every((unit) => NUMERALS.has(unit.ch))) continue
          if (!this.strict(kind, a, length, ratio, pauseI, pauseJ)) continue
          // 引子本身就是前一遍前面那几个字的重复（“但仔细一想，｜真正记住的…或者……｜但仔细一想，｜真正记住的…”）：
          // 重念是从引子那里起的，只删中间这截会留下两遍引子；从引子起算的那个候选才对
          if (kind === 'lead_in' && i >= lead && pys.slice(j, jj).every((py, offset) => py === pys[i - lead + offset])) continue
          // 英文按字母比对：前一遍是一个英文词、只是后一个词的开头几个字母（“the｜theory”）不算重复
          if (seq[i].word === seq[j - 1].word && /^[a-z0-9]$/.test(pys[jj + a.used - 1] ?? '') && jj + a.used < seq.length && seq[jj + a.used].word === seq[jj + a.used - 1].word && /^[a-z0-9]$/.test(pys[jj + a.used])) continue
          // 两遍都是说完的一句、长短一样、只有最后一个词不同（“比如说你要查天气，｜比如说你要查新闻，”）：排比的样子，
          // 和换说法的重念分不开，没有稿子佐证就不在这里删，成片自检会把它列为待确认
          // 从句子的第二三个词起算的候选（“我们｜要做得更快，我们｜要做得更稳”）会绕过上面的比较：把两边都往前挪回句首再看一次
          let shiftedParallel = false
          if (jj === j && !this.phraseStart(first)) {
            for (let back = 1, ri = i, ti = jj; back <= 3 && !shiftedParallel; back++) {
              ri--; ti--
              while (ri > 0 && !startSet.has(ri)) ri--
              while (ti > 0 && !startSet.has(ti)) ti--
              if (ri < 0 || ti <= ri || ti - ri !== jj - i || normalizeAudioEditFiller(this.words[seq[ri].word].block.text) !== normalizeAudioEditFiller(this.words[seq[ti].word].block.text)) break
              shiftedParallel = this.parallelClauses(seq, ri, ti, ti)
            }
          }
          if (shiftedParallel && !this.script.length) continue
          if (this.parallelClauses(seq, i, j, jj)) {
            // 稿子里只有后一句、前一句对到的也是同一处（“还有专业的行业媒体，｜还有专业的行业网站。”稿子只有“网站”）：是念错了重来
            const later = this.locate(t.slice(0, length + 2))
            const earlier = later && later.ratio >= 0.7 ? this.locate(r, Math.max(0, later.pos - 3), later.pos + 3) : undefined
            if (!earlier || earlier.ratio < 0.5) continue
          }
          push('match', a.score - (kind === 'lead_in' ? 2 : 0))
        }
      }
      // 同一个重起位置只留证据最强的几个：前一遍从哪儿算起的候选可以有很多，弱的不会被选中，却要为每个都算一遍其他剪法
      found.push(...here.sort((x, y) => y.weight - x.weight).slice(0, CANDIDATES_PER_RESTART))
    }
    return found
  }

  /**
   * 对稿得到的重念：每一次往回跳，说明从稿子的那个位置起又念了一遍。前一遍从“念到那个位置”的地方算起，到回跳处为止；
   * 换了说法的那遍只要后一遍对得上稿子就能认出来，不靠两遍文字相同，也不看标点。
   * 回跳前没对上稿子的那几个字：紧接着前一遍一口气说出来的是念坏的尾巴，一起删；先停了一下才说、又连着后一遍的是引子（“然后我来举个例子。”），留下。
   */
  private scriptCandidates(seq: readonly Unit[]): Candidate[] {
    if (!this.script.length || seq.length < 2) return []
    // 一串连着的英文字母、数字并成一个字来对：识别常把一个英文名拆成几截或写法不同，逐字母对会把一个名字的出入放大成十几个字
    const spokenTokens = mergeLatin(seq.map((unit) => unit.py)), scriptTokens = mergeLatin(this.script)
    // 重念几乎总是停一下再起：不在词的开头不能回跳，前面没有停顿的地方回跳要贵
    const aligned = alignToScript(spokenTokens.tokens, scriptTokens.tokens, (token) => {
      const unit = spokenTokens.starts[token]
      if (unit > 0 && seq[unit].word === seq[unit - 1].word) return Infinity
      return this.pauseBefore(seq[unit].word) >= BOUNDARY_PAUSE_MS || this.restartMarkerBefore(seq[unit].word) ? 0 : UNPAUSED_JUMP_COST
    })
    const position = new Int32Array(seq.length).fill(-1), jumpBefore = new Uint8Array(seq.length)
    spokenTokens.starts.forEach((unit, token) => {
      jumpBefore[unit] = aligned.jumpBefore[token]
      const end = spokenTokens.starts[token + 1] ?? seq.length
      for (let k = unit; k < end; k++) position[k] = aligned.position[token] < 0 ? -1 : scriptTokens.starts[aligned.position[token]]
    })
    const wordStart = (k: number): boolean => k === 0 || seq[k].word !== seq[k - 1].word
    /**
     * anchor 之前有一截话开头与 anchor 起的内容相同，而且除了这个相同的开头，里面没有“稿子里有、后面又没再念”的内容：
     * 开了个头、换了说法重来，稿子里只有后一种说法。返回这一截的起点与相同的字数。
     * 开头要对上三个字；只对上两个字的，这一截得是停顿后说出来的短短几个字，或者后面明说了“哎、不对”。
     */
    const abandonedBefore = (anchor: number): { from: number; shared: number } | undefined => {
      const marked = this.restartMarkerBefore(seq[anchor].word)
      if (this.pauseBefore(seq[anchor].word) < BOUNDARY_PAUSE_MS && !marked) return undefined
      let best: { from: number; shared: number } | undefined
      for (let u = anchor - 1; u >= 0 && anchor - u <= MAX_ABANDONED_UNITS; u--) {
        if (!wordStart(u)) continue
        let shared = 0
        while (u + shared < anchor && anchor + shared < seq.length && seq[u + shared].py === seq[anchor + shared].py) shared++
        const afterPause = this.pauseBefore(seq[u].word) >= BOUNDARY_PAUSE_MS
        if (!(shared >= 3 || (shared >= 2 && afterPause && (anchor - u <= 6 || (marked && anchor - u <= 16))))) continue
        // 稿子里本来就写了两遍（排比、强调、口号）：稿子里逐字连着有这一截加后面同样长的一截，或者两截相同的开头各自对到稿子的不同位置
        let scriptedTwice = this.scriptContains(seq.slice(u, Math.min(seq.length, anchor + (anchor - u))).map((unit) => unit.py))
        for (let k = 0; k < shared; k++) if (position[u + k] >= 0 && position[anchor + k] >= 0 && position[u + k] !== position[anchor + k]) scriptedTwice = true
        if (scriptedTwice) continue
        // 后一遍得是稿子里的话
        let scripted = 0
        for (let k = anchor; k < seq.length && k < anchor + shared + 4; k++) if (position[k] >= 0) scripted++
        if (scripted < 2) continue
        const later = new Set<number>()
        for (let k = anchor; k < seq.length && k < anchor + 2 * (anchor - u) + 20; k++) if (position[k] >= 0) later.add(position[k])
        let novel = 0
        for (let k = u + shared; k < anchor; k++) if (position[k] >= 0 && !later.has(position[k])) novel++
        // 零星一两个字碰巧对上稿子别处不算
        if (novel <= Math.max(1, Math.floor((anchor - u - shared) * 0.2)) && (!best || shared > best.shared)) best = { from: u, shared }
      }
      return best
    }
    const found: Candidate[] = []
    for (let t = 1; t < seq.length; t++) {
      if (!jumpBefore[t]) {
        const abandoned = wordStart(t) ? abandonedBefore(t) : undefined
        const first = abandoned ? seq[abandoned.from].word : -1, end = seq[t].word
        if (abandoned && this.removable(first, end)) found.push({ kind: 'restart', first, last: end, restartWord: end, length: t - abandoned.from, ratio: abandoned.shared / (t - abandoned.from), pauseJ: this.pauseBefore(end), weight: abandoned.shared + 2, covered: abandoned.shared, evidence: 'script' })
        continue
      }
      // 后一遍重新对上稿子的字数：太少多半是碰巧（“反而”两个字），不当重念
      let rematch = 0
      for (let k = t; k < seq.length && k < t + 10 && position[k] >= 0 && !(k > t && jumpBefore[k]); k++) rematch++
      let restart = t
      while (!wordStart(restart)) restart--
      // 回跳落在后一遍开头第二三个字上（开头那个字没对上稿子）：后一遍从它前面那个停顿后的词算起
      if (this.pauseBefore(seq[restart].word) < BOUNDARY_PAUSE_MS) {
        for (let k = restart - 1; k >= 0 && k >= restart - 3 && position[k] < 0; k--) if (wordStart(k) && this.pauseBefore(seq[k].word) >= BOUNDARY_PAUSE_MS) { restart = k; break }
      }
      const target = position[t]
      let tail = restart
      while (tail > 0 && position[tail - 1] < 0) tail--
      let start = tail
      while (start > 0 && restart - start < MAX_BACK_UNITS + 30 && (position[start - 1] < 0 || position[start - 1] >= target)) start--
      while (start < tail && position[start] < 0) start++
      while (start < tail && !wordStart(start)) start++
      if (start >= tail) continue
      const length = tail - start
      const pauseJ = this.pauseBefore(seq[restart].word)
      if (rematch < 4 && !(rematch >= 3 && pauseJ >= CLEAR_PAUSE_MS) && !(rematch >= 2 && length <= 4 && pauseJ >= BOUNDARY_PAUSE_MS)) continue
      // 前一遍念到的稿子位置，后一遍（及其后）要重新念到过半才算被取代；只重合开头几个字、后面各说各的不算
      const said = new Set<number>()
      for (let k = start; k < tail; k++) if (position[k] >= target) said.add(position[k])
      const again = new Set<number>()
      for (let k = t; k < seq.length && k < t + 2 * length + 20; k++) if (said.has(position[k])) again.add(position[k])
      if (again.size * 2 < said.size && said.size > 6) continue
      // 前一遍从第一个被重新念到的字算起：它前面对得上稿子、后面却没再念的，是换了顺序说的内容，不是重念
      while (start < tail && !(again.has(position[start]) && wordStart(start))) start++
      if (start >= tail) continue
      // 单个常见字（“的”）会碰巧对到后一遍里：前一遍多半从停顿后起头，头几个字里有停顿后的词就从它算起
      if (this.pauseBefore(seq[start].word) < BOUNDARY_PAUSE_MS) {
        for (let k = start + 1; k < tail && k <= start + 3; k++) if (wordStart(k) && again.has(position[k]) && this.pauseBefore(seq[k].word) >= BOUNDARY_PAUSE_MS) { start = k; break }
      }
      let covered = 0
      for (let k = start; k < tail; k++) if (again.has(position[k])) covered++
      const abandoned = abandonedBefore(start)
      if (abandoned) { start = abandoned.from; covered += abandoned.shared }
      // 没对上稿子的那一截是尾巴还是引子：看它前面有没有先停一下
      let last = restart
      if (tail < restart) {
        let leadStart = tail
        while (leadStart < restart && !wordStart(leadStart)) leadStart++
        const pauseLead = leadStart < restart ? this.pauseBefore(seq[leadStart].word) : 0
        if (leadStart < restart && pauseLead >= CLEAR_PAUSE_MS && pauseLead >= pauseJ) last = leadStart
      }
      const first = seq[start].word, end = seq[last].word
      if (end <= first || !this.removable(first, end)) continue
      if (this.scriptContains(seq.slice(start, Math.min(seq.length, restart + (tail - start))).map((unit) => unit.py))) continue
      found.push({ kind: last === restart ? 'restart' : 'lead_in', first, last: end, restartWord: seq[restart].word, length, ratio: Math.min(1, rematch / Math.max(1, Math.min(length, 10))), pauseJ, weight: Math.min(rematch, 10) + 2, covered, evidence: 'script' })
    }
    return found
  }

  /**
   * 一个词说出口又马上重说：“那知｜知多少”。单独一个字的，中间停了一下就删；
   * 连着念的分不清是不是“说 说明书”这类正常说法，两三个字的词重说分不清是不是强调，都只留作待确认。
   */
  private stutterCandidates(): { sure: Candidate[]; unsure: Candidate[] } {
    const sure: Candidate[] = [], unsure: Candidate[] = []
    for (let k = 0; k < this.words.length; k++) {
      const word = this.words[k]
      if (!this.kept[k] || word.filler || this.looped.has(k) || !word.units.length || word.units.length > 3 || !this.removable(k, k + 1) || word.units.every((unit) => NUMERALS.has(unit.ch))) continue
      const following = this.contentFrom(k + 1, word.units.length + 1)
      const next = following[0]
      if (next === undefined) continue
      const after = following.flatMap((w) => this.words[w].units)
      if (after.length <= word.units.length || !word.units.every((unit, index) => unit.ch === after[index].ch)) continue
      // “清｜清楚楚”是识别把“清清楚楚”拆开了，不是口吃
      if (word.units.length === 1 && after[2] && after[1].ch === after[2].ch) continue
      const pauseJ = this.pauseBefore(next)
      const candidate: Candidate = { kind: 'broken_start', first: k, last: next, restartWord: next, length: word.units.length, ratio: 1, weight: 1, covered: word.units.length, pauseJ, evidence: 'stutter' }
      // 单个字停一下再说出整个词是口吃；“的、了、我”这类单字常常只是上一句的结尾。两三个字的词重说一遍可能是强调（“真的，真的很好用”），
      // 有稿子、稿子里只写了一遍、又停得明显时才删
      // 稿子里本来就连着写了两遍的不算；只写了一遍的是稿子佐证过的口吃
      const single = after.map((unit) => unit.py), doubled = [...word.units.map((unit) => unit.py), ...single]
      if (this.scriptContains(doubled)) continue
      const once = this.scriptContains(single)
      const confident = word.units.length === 1 ? once || !COMMON_SINGLE_WORDS.has(word.units[0].ch) : once && pauseJ >= CLEAR_PAUSE_MS
      if (confident && pauseJ >= BOUNDARY_PAUSE_MS) sure.push(candidate)
      else if (pauseJ >= BOUNDARY_PAUSE_MS || this.restartMarkerBefore(next) || (word.units.length === 1 && this.words[next].units.length >= 2)) unsure.push({ ...candidate, unsure: true })
    }
    return { sure, unsure }
  }

  /** [first, last) 里仍保留的实词共多少个字 */
  private contentUnits(first: number, last: number): number {
    let size = 0
    for (let k = first; k < last; k++) if (this.kept[k] && !this.words[k].filler) size += this.words[k].units.length
    return size
  }

  /** 第 k 个词起往后的实词（保留的），直到凑够 limit 个字 */
  private contentFrom(k: number, limit: number): number[] {
    const list: number[] = []
    for (let w = k, size = 0; w < this.words.length && size < limit; w++) if (this.kept[w] && !this.words[w].filler && this.words[w].units.length) { list.push(w); size += this.words[w].units.length }
    return list
  }

  private contentBefore(k: number, limit: number): number[] {
    const list: number[] = []
    for (let w = k - 1, size = 0; w >= 0 && size < limit; w--) if (this.kept[w] && !this.words[w].filler && this.words[w].units.length) { list.unshift(w); size += this.words[w].units.length }
    return list
  }

  /**
   * 同一处重念的其他剪法，文字结果相同或只多删贴着的碎字，由接缝分决定用哪一个：
   * - 换遍拼接：两遍开头相同的那几个词，删前一遍的还是删后一遍的都一样，删除窗口可以在这段相同内容里平移
   *   （“…太多了一个API KEY。｜一个API KEY 发个…”前一遍念到气口为止、后一遍从对应的气口接上）。只在原切点有一头连读时考虑，
   *   每平移一个字扣一点分；
   * - 贴在念坏那遍前面、和它之间没有停顿的一两个虚字（“方向。｜那｜这个工具…”），留下它去接几秒后的另一遍语气接不上，可以跟着一起删；
   *   实词不这样处理，丢一个实词比多一个不顺的接缝代价大；
   * - 紧挨在前面的两三个字的半截起头、首字与念坏那遍相同（“但这个｜但结果说的还是挺准｜…”），一起删。
   */
  private alternatives(candidate: Candidate): Candidate[] {
    const all: Candidate[] = [candidate]
    const pysOf = (list: readonly number[]): string[] => list.flatMap((k) => this.words[k].units.map((unit) => unit.py))
    /** r 与 t 的开头对应：短的要逐字相同，长的拼音对齐命中八成以上；返回 t 用掉的字数 */
    const correspond = (r: readonly string[], t: readonly string[]): number | null => {
      if (r.length <= 3) return r.length <= t.length && r.every((py, i) => py === t[i]) ? r.length : null
      const aligned = align(r, t)
      return aligned.hits / r.length >= 0.8 && aligned.delRun <= 2 ? aligned.used : null
    }
    // 留最后一遍是默认；只有原切点有一头落在连读上时才考虑换遍
    const joinedSeam = Math.min(this.seamQuiet(candidate.first), this.seamQuiet(candidate.last)) < BOUNDARY_PAUSE_MS
    if (joinedSeam && candidate.last === candidate.restartWord && candidate.evidence !== 'stutter') {
      const before = this.contentBefore(candidate.first, MAX_SHIFT_UNITS)
      const run = this.contentFrom(candidate.first, Number.POSITIVE_INFINITY).filter((k) => k < candidate.last)
      const after = this.contentFrom(candidate.restartWord, MAX_SHIFT_UNITS + 8)
      const afterUnits = pysOf(after)
      /** t 的前 used 个字正好是几个整词；不是整词边界时返回 -1 */
      const wordsFor = (list: readonly number[], used: number, fromEnd = false): number => {
        let size = 0
        for (let n = 0; n <= list.length; n++) {
          if (size === used) return n
          if (n < list.length) size += this.words[fromEnd ? list[list.length - 1 - n] : list[n]].units.length
        }
        return -1
      }
      // 向右：前一遍多留 n 个词，后一遍从对应位置接
      for (let n = 1, size = 0; n <= run.length; n++) {
        size += this.words[run[n - 1]].units.length
        if (size > MAX_SHIFT_UNITS) break
        const used = correspond(pysOf(run.slice(0, n)), afterUnits.slice(0, size + 6))
        const taken = used === null ? -1 : wordsFor(after, used)
        if (taken <= 0 || taken >= after.length || size < 2) continue
        // 后一遍被换掉的那截本身是完整的一小句（后面有标点或停了明显一下）：整句都重念了，留最后一遍
        if (/[，。！？、；：,.!?;:]$/.test(this.words[after[taken] - 1].block.text.trim()) || this.pauseBefore(after[taken]) >= CLAUSE_END_PAUSE_MS) continue
        const first = n < run.length ? run[n] : candidate.restartWord, last = after[taken]
        if (this.removable(first, last)) all.push({ ...candidate, first, last, restartWord: last, weight: candidate.weight - size * SHIFT_COST })
      }
      // 向左：删掉切点前已保留的 n 个词，改留前一遍末尾对应的那几个词
      const runUnits = pysOf(run)
      for (let n = 1, size = 0; n <= before.length && n < run.length; n++) {
        size += this.words[before[before.length - n]].units.length
        if (size > MAX_SHIFT_UNITS) break
        const used = correspond(pysOf(before.slice(before.length - n)).reverse(), runUnits.slice(Math.max(0, runUnits.length - size - 6)).reverse())
        const taken = used === null ? -1 : wordsFor(run, used, true)
        if (taken <= 0 || taken >= run.length || size < 2) continue
        const first = before[before.length - n], last = run[run.length - taken]
        if (this.removable(first, last)) all.push({ ...candidate, first, last, restartWord: last, weight: candidate.weight - size * SHIFT_COST })
      }
    }
    // 贴在前面的碎字与半截起头
    const head = this.words[candidate.first].units[0]?.py
    const lead: number[] = []
    let size = 0
    for (let k = candidate.first - 1, joined = true; k >= 0 && this.kept[k]; k--) {
      if (this.words[k].filler) continue
      size += this.words[k].units.length
      if (size > 3) break
      lead.unshift(k)
      const text = normalizeAudioEditFiller(lead.map((w) => this.words[w].block.text).join(''))
      joined &&= this.pauseBefore(lead.length > 1 ? lead[1] : candidate.first) < BOUNDARY_PAUSE_MS
      const repeated = normalizeAudioEditFiller(this.words[candidate.restartWord]?.block.text ?? '').startsWith(text)
      // 半截起头与念坏那遍同一个字开头，本身就是重来的痕迹，不要求它前面有停顿；虚字要是停顿后说出来、又贴着念坏那遍的才算
      const brokenStart = size >= 2 && this.words[k].units[0]?.py === head
      const loose = joined && size <= 2 && LOOSE_LEADS.has(text) && this.pauseBefore(k) >= BOUNDARY_PAUSE_MS
      if (!repeated && (brokenStart || loose) && this.removable(k, candidate.last)) {
        all.push({ ...candidate, first: k, weight: candidate.weight + (brokenStart ? BROKEN_START_BONUS : -LOOSE_LEAD_COST) })
        break
      }
      if (this.pauseBefore(k) >= BOUNDARY_PAUSE_MS) break
    }
    return all
  }

  /** 接缝分：下刀处的安静越长越好，到 CLEAR_PAUSE_MS 封顶；连读处为 0。 */
  private seamScore(quietMs: number): number {
    return SEAM_WEIGHT * Math.min(quietMs, CLEAR_PAUSE_MS) / CLEAR_PAUSE_MS
  }

  /** 连着重复的那段里除最后一遍以外的词：不参与逐对比较 */
  private readonly looped = new Set<number>()

  /**
   * 同一截话连着重复很多遍。稿子里本来就连着写了两遍以上的是有意的叠句，不管；
   * 成句的话重复十几遍以上是识别模型的循环输出，整体当一处重念、只留最后一遍；其余（短词叠说、次数不多）只列待确认。
   * 不管删不删，这段都先从逐对比较里拿掉，后面就不会在这段里产生成百上千个互相重叠的候选。
   */
  private collapseLoops(): Candidate[] {
    const seq = this.sequence()
    const wordStart = (k: number): boolean => k === 0 || seq[k].word !== seq[k - 1].word
    const done = new Uint8Array(seq.length)
    const doubtful: Candidate[] = []
    for (let period = 1; period <= MAX_LOOP_PERIOD; period++) {
      for (let start = 0; start + period < seq.length;) {
        let length = 0
        while (start + length + period < seq.length && seq[start + length].py === seq[start + length + period].py && !done[start + length] && !done[start + length + period]) length++
        const repeats = Math.floor(length / period) + 1
        const last = start + (repeats - 1) * period
        // 数字串（“100000 次”、报号码“幺幺幺幺”）不是重复；单个字要叠得更多才提
        const numeral = seq.slice(start, start + period).every((item) => NUMERALS.has(item.ch))
        if (numeral || repeats < MIN_LOOP_REPEATS + (period === 1 ? 2 : 0) || !wordStart(start) || !wordStart(last) || !this.removable(seq[start].word, seq[last].word)) { start += Math.max(1, length - period + 1); continue }
        done.fill(1, start, last + period)
        const unit = seq.slice(start, start + period).map((item) => item.py)
        const first = seq[start].word, end = seq[last].word
        start = last + period
        if (this.scriptContains([...unit, ...unit])) continue
        for (let k = first; k < end; k++) if (!this.words[k].filler) this.looped.add(k)
        const candidate: Candidate = { kind: 'restart', first, last: end, restartWord: end, length: (repeats - 1) * period, ratio: 1, weight: (repeats - 1) * period, covered: (repeats - 1) * period, pauseJ: this.pauseBefore(end), evidence: 'loop' }
        if (period >= LOOP_AUTO_UNITS && repeats >= LOOP_AUTO_REPEATS) {
          for (let k = first; k < end; k++) this.kept[k] = false
          this.accepted.push(candidate)
        } else doubtful.push({ ...candidate, unsure: true })
      }
    }
    return doubtful
  }

  /** 拿不准、只留作线索的重念：不删，交给人或助手确认。 */
  readonly review: Candidate[] = []

  /**
   * 每一轮：在当前保留的内容上收集全部候选（两遍相同的、对稿回跳的、口吃）及各自的其他剪法，全局选出总分最高的一组删掉；
   * 删完后原先隔着别的内容的两遍可能变成相邻，再来一轮，直到没有新的可删。
   */
  run(): Candidate[] {
    const doubtful: Candidate[] = this.collapseLoops()
    // 上一轮删过的地方（词下标区间）；第一轮看全部
    let changed: Array<[number, number]> | undefined
    const seam = (k: number): number => this.seamScore(k >= this.words.length ? CLEAR_PAUSE_MS : this.seamQuiet(k))
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const seq = this.sequence()
      // 选哪几处删看取代了多少内容；同一处的几种剪法之间再按证据分与两头的接缝分取舍
      // 没被选中的候选都是因为和选中的重叠；所以下一轮只有上一轮删过的地方附近才可能出现新的候选
      const near = (candidate: Candidate): boolean => !changed || changed.some(([from, to]) => candidate.restartWord >= from - NEARBY_WORDS && candidate.first <= to + NEARBY_WORDS)
      const pool: Array<{ first: number; last: number; weight: number; options: Array<{ option: Candidate; value: number }> }> = []
      for (const candidate of [...this.repeatCandidates(seq, changed), ...(round < SCRIPT_ROUNDS ? this.scriptCandidates(seq) : []), ...this.stutterCandidates().sure].filter(near)) {
        if (candidate.unsure) { doubtful.push(candidate); continue }
        const options = this.alternatives(candidate).map((option) => ({ option, value: option.weight + seam(option.first) + seam(option.last) })).sort((x, y) => y.value - x.value)
        // 重念总是停一下再起：按最好的那种剪法看，两头还有落在连读上的就扣分（换遍拼接能把接缝挪进停顿的不扣）
        const best = options[0].option
        const unlikely = (this.seamQuiet(best.last) < BOUNDARY_PAUSE_MS ? JOINED_COST : 0) + (this.seamQuiet(best.first) < BOUNDARY_PAUSE_MS ? JOINED_COST : 0)
        const content = COVER_WEIGHT * candidate.covered + EXTENT_WEIGHT * this.contentUnits(candidate.first, candidate.last)
        const weight = content - unlikely
        // 扣完分不剩什么的不删，留作待确认，交给助手或人判断
        // 口吃本来就贴着前一个字，有自己的把握判断，不按接缝再筛一遍
        if (weight <= 0 && candidate.evidence === 'match' && !candidate.corroborated) { doubtful.push(candidate); continue }
        // 其余的（稿子佐证过的、“哎”之后重来的、口吃）接缝不好也照删，只在与别的候选冲突时让位
        // 互相重叠的候选之间主要比“取代了多少内容”，接缝只轻轻偏向落在停顿处的那个：
        // 把扣分全算进去，会让取代得更完整但接缝连读的候选输给只删中间一截的候选，留下两遍开头
        pool.push({ first: candidate.first, last: candidate.last, weight: Math.max(content - unlikely * JOINED_RANK_SHARE, FLOOR_WEIGHT), options })
      }
      // 覆盖一整段的候选只列了待确认，完全落在这一段里面的局部候选就不能自动删：删中间一截、留下两头，必然留碎片
      // （“但仔细一想，真正记住的却不多，或者……｜但仔细一想，…”只删中间会留下两遍“但仔细一想，”）。稿子佐证过的不受此限
      for (let k = pool.length - 1; k >= 0; k--) {
        const local = pool[k], best = local.options[0].option
        if (best.evidence === 'script' || best.corroborated) continue
        if (doubtful.some((whole) => whole.first <= local.first && local.last <= whole.restartWord && (whole.first < local.first || local.last < whole.last))) { doubtful.push({ ...best, first: local.first, last: local.last, unsure: true }); pool.splice(k, 1) }
      }
      const chosen = selectTakeSegments(this.words.length, pool)
      if (!chosen.length) break
      changed = chosen.map((item) => [item.first, item.last])
      const owner = new Int32Array(this.words.length).fill(-1)
      const applied: Candidate[] = []
      chosen.forEach((item, index) => owner.fill(index, item.first, item.last))
      chosen.forEach((item, index) => {
        // 别的重念已经占了的词不碰：换遍拼接、连带碎字都不能伸进相邻那一处
        const free = (option: Candidate): boolean => { for (let k = option.first; k < option.last; k++) if (owner[k] >= 0 && owner[k] !== index) return false; return true }
        const { option } = item.options.find((entry) => free(entry.option)) ?? item.options.at(-1)!
        // 实际要删的恰好是说完的一整句、后面那遍也是说完的一句：和排比分不开，没有稿子佐证就不删，列为待确认。
        // 往后换遍（留前一遍、删后一遍重复的开头）时，被删内容的另一遍在它前面，不在这里判断
        if (option.evidence === 'match' && !option.corroborated && option.first <= item.first && this.replacedByCompleteClause(option)) { doubtful.push({ ...option, unsure: true }); return }
        for (let k = option.first; k < option.last; k++) this.kept[k] = false
        this.accepted.push(option)
        applied.push(option)
      })
      // 引子（前一遍与后一遍之间夹的话）是因为连着后一遍才留的；后一遍自己也被删了，引子就没有可接的话，跟着删
      for (const option of applied) {
        if (option.last < option.restartWord && !this.kept[option.restartWord] && this.removable(option.last, option.restartWord)) {
          for (let k = option.last; k < option.restartWord; k++) this.kept[k] = false
        }
      }
    }
    // 待确认的线索：还完整留着、互不重叠的，证据强的优先
    const taken = new Uint8Array(this.words.length)
    for (const candidate of [...doubtful, ...this.stutterCandidates().unsure].sort((x, y) => y.covered - x.covered)) {
      let free = this.kept[candidate.restartWord]
      for (let k = candidate.first; k < candidate.last; k++) if (taken[k] || (!this.kept[k] && this.words[k].block.included)) free = false
      if (!free) continue
      taken.fill(1, candidate.first, candidate.last)
      this.review.push(candidate)
    }
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
  const isRestartMarker = (word: Word): boolean => RESTART_MARKERS.has(normalizeAudioEditFiller(word.block.text))
  const markerRemovable = (block: AudioEditTranscriptBlock): boolean => block.included && !block.locked
    && (!options.range || (block.startFrame >= options.range.startFrame && block.endFrame <= options.range.endFrame))
  const retakes: AudioEditRetake[] = []
  const describe = (first: number, k: number, items: readonly Candidate[], review: boolean): AudioEditRetake => {
    const levels = items.map(confidenceOf)
    const start = detector.boundary(first), end = detector.boundary(k)
    const span = words.slice(first, k)
    const startFrame = Math.round(start.ms * options.sampleRate / 1000)
    const endFrame = Math.max(startFrame + 1, Math.round(end.ms * options.sampleRate / 1000), span.at(-1)!.block.endFrame)
    const keptAfter = words.slice(k).filter((word, offset) => detector.kept[k + offset]).slice(0, 12)
    return {
      id: `retake:${span[0].block.id}:${span.at(-1)!.block.id}`,
      kind: items.some((item) => item.kind === 'restart') ? 'restart' : items.some((item) => item.kind === 'lead_in') ? 'lead_in' : 'broken_start',
      blockIds: span.map((word) => word.block.id),
      startFrame: Math.min(startFrame, span[0].block.startFrame),
      endFrame,
      removedText: span.map((word) => word.block.text).join(''),
      keptText: keptAfter.map((word) => word.block.text).join(''),
      confidence: review ? 'low' : levels.includes('low') ? 'low' : levels.includes('medium') ? 'medium' : 'high',
      joined: end.joined,
      review,
    }
  }
  for (let k = 0; k < words.length;) {
    if (!removed[k]) { k++; continue }
    let first = k
    while (k < words.length && (removed[k] || (words[k].filler && words[k].block.included && removed[k + 1]))) k++
    // 删除段前面紧挨着的“哎”是念坏那遍的起头（“…吧。哎，不过呢…且。｜哎，不过”），跟着那一遍一起删
    while (first > 0 && isRestartMarker(words[first - 1]) && markerRemovable(words[first - 1].block)) first--
    retakes.push(describe(first, k, accepted.filter((candidate) => candidate.first >= first && candidate.first < k), false))
  }
  for (const candidate of detector.review) retakes.push(describe(candidate.first, candidate.last, [candidate], true))
  // 成片自检：保留内容里还留着的重念只作待确认，证据强的优先。清单要短到用户愿意逐条看：每 10 分钟录音 SELF_CHECK_PER_TEN_MINUTES 条；
  // 已经自动剪掉的重念越多，说明这段录得越乱、拿不准的也会越多，上限随之放宽，最多放到 SELF_CHECK_MAX_FACTOR 倍
  const base = Math.ceil((words.at(-1)!.endMs - words[0].startMs) / 600_000 * SELF_CHECK_PER_TEN_MINUTES)
  const budget = Math.min(base * SELF_CHECK_MAX_FACTOR, Math.max(base, Math.round(retakes.length * SELF_CHECK_PER_RETAKE)))
  const residual = findResidualRetakes({
    words: words.map((word, index) => ({ units: word.units, filler: word.filler, kept: detector.kept[index], restartMarker: isRestartMarker(word) })),
    pauseBefore: (k) => detector.pauseBefore(k),
    removable: (first, last) => detector.removable(first, last),
    ...(detector.script.length ? { locate: (units: readonly string[], from?: number) => detector.locate(units, from) } : {}),
  }).filter((finding) => !detector.review.some((candidate) => finding.first < candidate.last && candidate.first < finding.last))
  for (const finding of residual.slice(0, Math.max(0, budget))) retakes.push(describe(finding.first, finding.last, [], true))
  return retakes.sort((a, b) => a.startFrame - b.startFrame)
}

const clip = (text: string, size: number): string => (text.length > size ? `${text.slice(0, size)}…` : text)

/** 重念 → 剪辑线索：删除这些词，并剪掉其间与前后的停顿；恢复其中任一词时停顿一并恢复。 */
export function audioEditRetakeSuggestion(retake: AudioEditRetake): AudioEditSuggestion {
  return {
    id: retake.id,
    kind: 'retake',
    evidence: 'audio',
    title: `重念“${clip(retake.removedText, 18)}”`,
    detail: retake.review
      ? `后面换了说法又念了“${clip(retake.keptText, 18)}”；可能是念坏重来，也可能是有意的重复，没有自动删除，请试听后决定。`
      : `后面重新念了“${clip(retake.keptText, 18)}”，保留最后一遍${retake.joined ? '；接缝处没有停顿，请试听' : ''}。`,
    startFrame: retake.startFrame,
    endFrame: retake.endFrame,
    blockIds: retake.blockIds,
    confidence: retake.confidence,
    status: 'pending',
  }
}
