/*
 * 成片自检：去重念之后再看一遍保留下来的内容，找“还留着的重念”——前一段和紧跟着的后一段开头相同，
 * 多半是念坏了重来、后面换了说法；也可能是有意的排比。分不清，所以只提出来待确认，不删。
 *
 * 分段只看真实停顿与已有的删除接缝，不看识别给的标点（标点是识别模型猜的，换一次识别就可能不同）。
 * 证据按分数累加，再按分数取前几条：清单短到用户愿意逐条看，比多报几条重要。
 */

export interface SelfCheckWord {
  /** 逐字的无声调拼音与原字 */
  units: readonly { py: string; ch: string }[]
  /** 单独的语气词（“哎、嗯”），不算内容 */
  filler: boolean
  /** 去重念之后仍保留 */
  kept: boolean
  /** “哎、唉”这类念坏了重来的口头标记 */
  restartMarker: boolean
}

export interface SelfCheckContext {
  words: readonly SelfCheckWord[]
  /** 第 k 个词之前的真实停顿（毫秒）：上一个保留的实词到它之间最长的安静 */
  pauseBefore(k: number): number
  /** [first, last) 的词都能删（没有锁定、在处理范围内） */
  removable(first: number, last: number): boolean
  /** 一段读音在参考稿里（从 from 往后）最像的位置与命中率；没有参考稿时不提供 */
  locate?(units: readonly string[], from?: number): { pos: number; ratio: number } | undefined
}

export interface SelfCheckFinding {
  /** 建议删掉的词 [first, last) */
  first: number
  last: number
  /** 后一段开头所在的词 */
  restartWord: number
  score: number
}

/** 能把话分成两段的停顿（毫秒） */
const SEGMENT_PAUSE_MS = 120
/** 前一段超过这么长（字数）就不像念坏半句马上重来 */
const MAX_FIRST_UNITS = 32
/** 往后看几段：中间可以隔一段短的引子（“比如说，｜然后我来举个例子。｜比如说，我最近…”） */
const SHORT_UNITS = 4
/** 提出来的最低分 */
const MIN_SCORE = 3.5
/** 两个字的常见起头，单凭它相同说明不了什么（“然后…，然后…”“你会…，你会…”） */
const COMMON_OPENERS = new Set(['这个', '那个', '然后', '就是', '所以', '但是', '而且', '因为', '如果', '比如', '还有', '你会', '我们', '它的', '它是', '这样', '可以', '或者', '你看', '其实', '这里', '那么', '不过', '一个'])
const LEAD_INS = new Set(['那', '就', '哎', '嗯', '呃', '啊'])

interface Unit { py: string; ch: string; word: number; segment: number; wordStart: boolean }
interface Segment { first: number; unitStart: number; unitEnd: number; pauseBefore: number; markerBefore: boolean }

/** 保留的实词按真实停顿、删除接缝和“哎”分段，同时摊平成逐字序列。 */
function layout(context: SelfCheckContext): { units: Unit[]; list: Segment[] } {
  const units: Unit[] = [], list: Segment[] = []
  let dropped = false, marker = false
  context.words.forEach((word, index) => {
    if (!word.kept) { if (!word.filler) dropped = true; return }
    if (word.filler) { marker ||= word.restartMarker; return }
    if (!word.units.length) return
    const pause = context.pauseBefore(index)
    if (!list.length || dropped || marker || pause >= SEGMENT_PAUSE_MS) list.push({ first: index, unitStart: units.length, unitEnd: units.length, pauseBefore: pause, markerBefore: marker })
    const segment = list.length - 1
    word.units.forEach((unit, offset) => units.push({ ...unit, word: index, segment, wordStart: offset === 0 }))
    list[segment].unitEnd = units.length
    dropped = false; marker = false
  })
  return { units, list }
}

/** 一串英文字母按一个词算长度，免得一个产品名就把半句话算成很长 */
function spokenLength(units: readonly Unit[], from: number, to: number): number {
  let length = 0
  for (let k = from; k < to; k++) if (!/^[a-z]$/.test(units[k].py) || units[k].wordStart) length++
  return length
}

/**
 * 找保留内容里还留着的重念，按证据从强到弱排列；不重叠。
 * 后一段总是从一个停顿（或接缝、“哎”）之后开始；前一段可以从句子中间开始（“…的答案，并且还会引导你…｜并且还会引导你…”），
 * 所以往回在每个词的开头上找与后一段开头相同的地方，从句子中间起的要求多对上一个字。
 */
export function findResidualRetakes(context: SelfCheckContext): SelfCheckFinding[] {
  const { units, list } = layout(context)
  const found: SelfCheckFinding[] = []
  for (let b = 1; b < list.length; b++) {
    const later = list[b]
    const skip = later.unitEnd - later.unitStart > 1 && LEAD_INS.has(units[later.unitStart].ch) ? 1 : 0
    let best: SelfCheckFinding | undefined
    for (let i = later.unitStart - 1; i >= 0 && later.unitStart - i <= MAX_FIRST_UNITS + 16 && units[i].segment >= b - 2; i--) {
      if (!units[i].wordStart) continue
      const length = spokenLength(units, i, later.unitStart)
      if (length > MAX_FIRST_UNITS) break
      const segmentStart = list[units[i].segment].unitStart === i
      let shared = 0, afterLeadIn = false
      for (const offset of skip ? [0, skip] : [0]) {
        // 对上两个字之后容许错一个字（识别错字、改了一个字），但后面要再对上两个
        const same = (n: number): boolean => i + n < later.unitStart && later.unitStart + offset + n < later.unitEnd && units[i + n].py === units[later.unitStart + offset + n].py
        let n = 0
        while (same(n)) n++
        if (n >= 2 && same(n + 1) && same(n + 2)) { n += 3; while (same(n)) n++ }
        if (n > shared) { shared = n; afterLeadIn = offset > 0 }
      }
      const whole = shared >= later.unitStart - i
      if (shared < (segmentStart ? 2 : 3)) continue
      // “要等到2027年，｜那2027年到底什么时候买”：前一句的末尾被下一句用“那”接过去，是承上启下，不是重念
      if (afterLeadIn && !segmentStart) continue
      const opener = units[i].ch + units[i + 1].ch
      let score = Math.min(shared, 6)
        + (whole ? 2 : 0)
        + (later.pauseBefore >= 400 ? 1.5 : later.pauseBefore >= 200 ? 0.7 : 0)
        + (later.markerBefore ? 2 : 0)
        + (length <= 8 ? 1 : length <= 16 ? 0.3 : -1)
        + (units[i].segment === b - 1 ? 0.5 : 0)
        - (segmentStart ? 0 : 1)
        - (shared === 2 && COMMON_OPENERS.has(opener) ? 1.5 : 0)
      if (context.locate && length >= 2) {
        const earlier = context.locate(units.slice(i, later.unitStart).map((unit) => unit.py))
        const opening = units.slice(later.unitStart, Math.min(later.unitEnd, later.unitStart + 12)).map((unit) => unit.py)
        // 稿子里前一段有其位置、后一段在它之后也对得上：是稿子本来就有的排比
        if (earlier && earlier.ratio >= 0.8 && (context.locate(opening, earlier.pos + Math.max(3, length - 2))?.ratio ?? 0) >= 0.8) continue
        const next = context.locate(opening)
        if (next && next.ratio >= 0.7) score += !earlier || earlier.ratio < 0.5 ? 2 : Math.abs(earlier.pos - next.pos) <= 2 ? 3 : 0
      }
      if (score < MIN_SCORE || (best && best.score >= score)) continue
      // 前一段只是短短一句、和后一段之间还隔着别的话（“比如说，｜然后我来举个例子。｜比如说，我最近…”）：只删那一小句
      const own = list[units[i].segment]
      const shortLead = segmentStart && units[i].segment < b - 1 && own.unitEnd - own.unitStart <= SHORT_UNITS
      const last = shortLead ? list[units[i].segment + 1].first : later.first
      if (!context.removable(units[i].word, last)) continue
      best = { first: units[i].word, last, restartWord: later.first, score }
    }
    if (best) found.push(best)
  }
  const taken: SelfCheckFinding[] = []
  for (const finding of found.sort((x, y) => y.score - x.score)) {
    if (!taken.some((other) => finding.first < other.last && other.first < finding.last)) taken.push(finding)
  }
  return taken
}
