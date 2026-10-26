import { diffArrays } from 'diff'
import { pinyin } from 'pinyin-pro'
import type { AudioEditTranscriptBlock } from './types'

/*
 * 按参考稿断句与对照：口播照稿念，字幕按稿子的标点分行（逗号、句号、问号、感叹号、分号处换行，一行一句）。
 *
 * 识别出的词和稿子都拆成“读音单元”（汉字取无声调拼音，字母、数字逐个小写），用 Myers 差分对齐：
 * 同音的识别错字也能对上；稿子里有、没念的，念了、稿子里没有的，各自成段。
 * 只用保留的词块（被删掉的重念不进字幕）。词时间、声音都不改，只决定字幕在哪个词之后结束，并给出每段对应的稿子原文。
 */

const BREAK = /[，,。！？!?；;…\n]/u
/** 句尾语气词：稿子里没有、念的时候多带的，归前一句。 */
const FINAL_PARTICLES = new Set(['呢', '吧', '啊', '呀', '嘛', '啦', '哦', '哈', '呐', '哇', '噢'])
/** 单独成词的叹词、语气词：声音里保留，成片字幕里不显示。 */
const SUBTITLE_FILLERS = new Set(['嗯', '呃', '额', '哎', '诶', '欸', '唉', '啊'])
const bare = (text: string): string => text.replace(/[\s\p{P}]/gu, '')
export function isAudioEditSubtitleFiller(text: string): boolean { return SUBTITLE_FILLERS.has(bare(text)) }
const SKIP = /[\s"'“”‘’（）()《》【】「」『』]/u

function isHanzi(char: string): boolean { return char >= '一' && char <= '鿿' }
function isUnit(char: string): boolean { return isHanzi(char) || /[\p{L}\p{N}]/u.test(char) }

/** 一串字的读音单元：汉字整段一起转拼音（多音字按上下文），字母、数字逐个小写。 */
function units(chars: readonly string[]): string[] {
  const hanzi = chars.filter(isHanzi).join('')
  const readings = hanzi ? pinyin(hanzi, { toneType: 'none', type: 'array' }) : []
  let cursor = 0
  return chars.map(char => isHanzi(char) ? readings[cursor++] ?? char : char.toLowerCase())
}

export interface AudioEditScriptAlignment {
  /** 每个保留词块在稿子里对应的字符区间 [start, end)；对不上（稿子里没有）的词块没有这一项。 */
  scriptRanges: Map<string, { start: number; end: number }>
  /** 稿子在这个词块之后断句。 */
  breaks: Set<string>
  /** 连续 8 个以上读音单元都对不上稿子的词块（多念的内容）：断句按停顿兜底。 */
  unscripted: Set<string>
  /** 稿子里对上的读音单元占比。 */
  coverage: number
}

export function alignAudioEditToScript(blocks: readonly AudioEditTranscriptBlock[], script: string): AudioEditScriptAlignment {
  const kept = blocks.filter(block => block.included && block.text.trim())
  // 识别侧：每个读音单元属于哪个词块、是词块里的第几个
  const spoken: Array<{ block: number; index: number; count: number }> = []
  const spokenChars: string[] = []
  kept.forEach((block, blockIndex) => {
    const chars = [...block.text].filter(isUnit)
    chars.forEach((char, index) => { spoken.push({ block: blockIndex, index, count: chars.length }); spokenChars.push(char) })
  })
  // 稿子侧：每个读音单元在稿子里的字符位置，以及它后面是否断句（小数点不算）
  const scriptChars = [...script]
  const written: Array<{ at: number; breakAfter: boolean }> = []
  scriptChars.forEach((char, at) => {
    if (!isUnit(char)) return
    let next = at + 1
    while (next < scriptChars.length && SKIP.test(scriptChars[next]) && scriptChars[next] !== '\n') next++
    const following = scriptChars[next] ?? '\n'
    const decimal = following === '.' && /[0-9]/.test(char) && /[0-9]/.test(scriptChars[next + 1] ?? '')
    // 英文句点只在后面不紧跟字母、数字时算断句（php.net、0.3、v2.5 都不断）
    written.push({ at, breakAfter: !decimal && (BREAK.test(following) || (following === '.' && !/[\p{L}\p{N}]/u.test(scriptChars[next + 1] ?? ''))) })
  })
  const spokenUnits = units(spokenChars)
  const writtenUnits = units(written.map(item => scriptChars[item.at]))
  // 稿子单元 → 识别单元（-1 表示前面没有可落的识别单元）；识别单元 → 稿子单元（-1 表示稿子里没有）
  const toSpoken = new Int32Array(written.length).fill(-1)
  const toWritten = new Int32Array(spoken.length).fill(-1)
  let w = 0, s = 0, matched = 0
  const changes = diffArrays(writtenUnits, spokenUnits)
  for (let k = 0; k < changes.length; k++) {
    const change = changes[k]
    const next = changes[k + 1]
    if (!change.added && !change.removed) {
      for (let i = 0; i < change.count; i++) { toSpoken[w + i] = s + i; toWritten[s + i] = w + i }
      w += change.count; s += change.count; matched += change.count
    } else if (next && change.removed !== next.removed && (change.removed || change.added) && (next.removed || next.added)) {
      // 一段稿子换成了一段识别（同音字以外的识别错、改词）：按比例对上
      const removed = change.removed ? change : next, added = change.removed ? next : change
      for (let i = 0; i < removed.count; i++) toSpoken[w + i] = s + Math.max(0, Math.ceil((i + 1) * added.count / removed.count) - 1)
      for (let i = 0; i < added.count; i++) toWritten[s + i] = w + Math.min(removed.count - 1, Math.floor(i * removed.count / added.count))
      w += removed.count; s += added.count; k++
    } else if (change.removed) {
      // 稿子里有、没念：断句落在前一个念到的词之后
      for (let i = 0; i < change.count; i++) toSpoken[w + i] = s - 1
      w += change.count
    } else s += change.count
  }
  const matchedBlock = kept.map(() => false)
  spoken.forEach((unit, index) => { if (toWritten[index] >= 0) matchedBlock[unit.block] = true })
  const particle = (index: number): boolean => index < kept.length && !matchedBlock[index] && FINAL_PARTICLES.has(bare(kept[index].text))
  const breaks = new Set<string>()
  written.forEach((item, index) => {
    if (!item.breakAfter) return
    const unit = toSpoken[index]
    if (unit < 0) return
    const { block, index: offset, count } = spoken[unit]
    // 稿子的标点落在一个识别词中间（“工具它”）：后半段多就在这个词之后断，否则在它之前断
    let at = offset + 1 >= count / 2 ? block : block - 1
    // 稿子里没有、念的时候多带的句尾语气词（“部分呢”“可靠多了吧”）跟着前一句
    while (at >= 0 && particle(at + 1)) at++
    if (at >= 0) breaks.add(kept[at].id)
  })
  // 稿子里没有的词（多念的内容）带着识别给的句读时，也在那里换行
  kept.forEach((block, index) => {
    if (matchedBlock[index] || !BREAK.test(block.text.trim().slice(-1)) || isAudioEditSubtitleFiller(block.text) || FINAL_PARTICLES.has(bare(block.text))) return
    let at = index
    while (particle(at + 1)) at++
    breaks.add(kept[at].id)
    // 紧跟在稿子断句之后的一两个字（“更新｜的。”）并回前一句，不单独成行
    let first = index
    while (first > 0 && !matchedBlock[first - 1] && !breaks.has(kept[first - 1].id)) first--
    const run = kept.slice(first, at + 1).reduce((width, item) => width + bare(item.text).length, 0)
    if (first > 0 && run <= 3 && breaks.has(kept[first - 1].id)) breaks.delete(kept[first - 1].id)
  })
  const scriptRanges = new Map<string, { start: number; end: number }>()
  spoken.forEach((unit, index) => {
    const target = toWritten[index]
    if (target < 0) return
    const id = kept[unit.block].id
    const at = written[target].at
    const range = scriptRanges.get(id)
    scriptRanges.set(id, range ? { start: Math.min(range.start, at), end: Math.max(range.end, at + 1) } : { start: at, end: at + 1 })
  })
  const unscripted = new Set<string>()
  for (let i = 0; i < spoken.length;) {
    if (toWritten[i] >= 0) { i++; continue }
    let j = i
    while (j < spoken.length && toWritten[j] < 0) j++
    if (j - i >= 8) for (let k = i; k < j; k++) if (!scriptRanges.has(kept[spoken[k].block].id)) unscripted.add(kept[spoken[k].block].id)
    i = j
  }
  return { scriptRanges, breaks, unscripted, coverage: written.length ? matched / written.length : 0 }
}

/** 一段字幕（若干词块）对应的稿子原文：取各词块对上的字符区间并到一起，补上紧跟的标点。 */
export function audioEditScriptTextFor(alignment: AudioEditScriptAlignment, blockIds: readonly string[], script: string): string {
  let start = Infinity, end = -Infinity
  for (const id of blockIds) {
    const range = alignment.scriptRanges.get(id)
    if (range) { start = Math.min(start, range.start); end = Math.max(end, range.end) }
  }
  if (!Number.isFinite(start)) return ''
  const chars = [...script]
  while (end < chars.length && !isUnit(chars[end]) && chars[end] !== '\n') { if (BREAK.test(chars[end++])) break }
  return chars.slice(start, end).join('').trim()
}

/** 字幕显示宽度：汉字算 1，半角字母、数字、符号算半个。 */
export function audioEditSubtitleWidth(text: string): number {
  return [...text].reduce((sum, char) => sum + (char.codePointAt(0)! <= 0x7f ? 0.5 : 1), 0)
}
