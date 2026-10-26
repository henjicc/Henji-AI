import { buildAudioEditSubtitleGroups, joinAudioEditText } from './captions'
import { alignAudioEditToScript, audioEditScriptTextFor } from './scriptCaptions'
import { buildProjectAudioEditSubtitleCues } from './subtitles'
import type { AudioEditProjectDocument } from './types'

/*
 * 字幕逐段核对：每段成片字幕的显示文字、识别原样、最初识别文字与对应的稿子原文。
 * 校对时“既不完全照稿，也不完全照识别”：改字写回这段的词块文字，词时间与声音不变。
 */

export interface AudioEditCaptionView {
  id: string
  blockIds: string[]
  /** 成片字幕显示的文字（排版后）。 */
  text: string
  /** 这段词块文字原样拼接。 */
  spokenText: string
  /** 最初识别的文字（旧口播没有保存时同 spokenText）。 */
  originalText: string
  /** 稿子里对应的原文；稿子里没有这段时为空。 */
  scriptText: string
  scriptMatch: 'same' | 'different' | 'not_in_script'
  startMs: number
  endMs: number
}

const comparable = (text: string): string => [...text.normalize('NFKC').toLowerCase()].filter(char => /[\p{L}\p{N}]/u.test(char)).join('')

const views = new WeakMap<AudioEditProjectDocument, AudioEditCaptionView[]>()

export function describeAudioEditCaptions(project: AudioEditProjectDocument): AudioEditCaptionView[] {
  const cached = views.get(project)
  if (cached) return cached
  const script = project.referenceScript.trim() ? project.referenceScript : ''
  const alignment = script ? alignAudioEditToScript(project.transcript, script) : undefined
  const groups = new Map(buildAudioEditSubtitleGroups(project.transcript, project.source.sampleRate).map(group => [group.id, group]))
  const original = new Map((project.editBaseline?.transcript ?? []).map(block => [block.id, block.text]))
  const rate = project.source.sampleRate
  const result = buildProjectAudioEditSubtitleCues(project).map((cue): AudioEditCaptionView => {
    const blocks = groups.get(cue.id)?.blocks ?? []
    const blockIds = blocks.map(block => block.id)
    const scriptText = alignment ? audioEditScriptTextFor(alignment, blockIds, script) : ''
    return {
      id: cue.id, blockIds, text: cue.text,
      spokenText: blocks.reduce((value, block) => joinAudioEditText(value, block.text.trim()), ''),
      originalText: blocks.reduce((value, block) => joinAudioEditText(value, (original.get(block.id) ?? block.text).trim()), ''),
      scriptText, scriptMatch: !scriptText ? 'not_in_script' : comparable(scriptText) === comparable(cue.text) ? 'same' : 'different',
      startMs: Math.round(cue.startFrame * 1000 / rate), endMs: Math.round(cue.endFrame * 1000 / rate),
    }
  })
  views.set(project, result)
  return result
}

/**
 * 把一段字幕改成 text：与这段字幕实际显示的词（声音保留下来的词，不含叹词）逐字比对，保留的字留在原词块，删掉的去掉，
 * 新加的字归到前一个字所在的词块（开头新加的归第一个）。声音被剪掉的词块、叹词不参与，不会被改。
 * 比对按显示的样子：中文与英文、数字之间的空格是排版加的，不算字；句中的逗号、句号显示成空格，所以字幕里的空格对应原来的逗号，
 * 在两个汉字之间新加的空格写成逗号；行尾的标点显示时本来就去掉，原样保留在词块里。
 */
export function setAudioEditCaptionText(project: AudioEditProjectDocument, captionId: string, text: string): AudioEditProjectDocument {
  const cue = buildProjectAudioEditSubtitleCues(project).find(item => item.id === captionId)
  if (!cue) throw new Error('NOT_FOUND')
  const byId = new Map(project.transcript.map(block => [block.id, block]))
  const blocks = cue.words.map(word => byId.get(word.blockId)!)
  if (blocks.some(block => block.locked)) throw new Error('这段字幕里有锁定的词块')
  const target = [...text.trim().replace(/(\p{Script=Han})[ \u3000]+(?=[A-Za-z0-9])/gu, '$1').replace(/([A-Za-z0-9])[ \u3000]+(?=\p{Script=Han})/gu, '$1').replace(/[ \u3000]+/gu, ' ')]
  if (!target.some(char => /[\p{L}\p{N}]/u.test(char))) throw new Error('字幕文字不能为空；不想要这段字幕请删掉对应的词')
  const base: string[] = [], owner: number[] = []
  let joined = ''
  blocks.forEach((block, index) => {
    const word = block.text.trim()
    const next = joinAudioEditText(joined, word)
    for (let gap = next.length - joined.length - word.length; gap > 0; gap--) { base.push(' '); owner.push(-1) }
    for (const char of word) { base.push(char); owner.push(index) }
    joined = next
  })
  const lastUnit = base.reduce((found, char, index) => /[\p{L}\p{N}]/u.test(char) ? index : found, -1)
  // 句中的逗号、句号、分号显示成空格，比对时也按空格算
  const key = base.map((char, index) => index < lastUnit && /[，。；]/u.test(char) ? ' ' : char)
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
  const n = base.length, m = target.length
  // 最长公共子序列（不分大小写，“work”改成“Work”仍归原词块）：字幕最多几百字，平方复杂度足够
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = same(key[i], target[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const texts = blocks.map(() => '')
  // 行尾原有的标点（显示时本来就去掉）留在原词块的末尾，新加的字放在它前面
  const tails = blocks.map(() => '')
  const first = blocks.map(() => -1), last = blocks.map(() => -1)
  const put = (index: number, char: string, j?: number): void => { texts[index] += char; if (j !== undefined) { if (first[index] < 0) first[index] = j; last[index] = j } }
  const han = (char: string | undefined): boolean => Boolean(char && /\p{Script=Han}/u.test(char))
  let current = 0
  for (let i = 0, j = 0; i < n || j < m;) {
    if (i < n && j < m && same(key[i], target[j])) { if (owner[i] >= 0) { current = owner[i]; put(current, key[i] === base[i] ? target[j] : base[i], j) } i++; j++ }
    else if (i < n && (j >= m || table[i + 1][j] >= table[i][j + 1])) {
      if (owner[i] >= 0) { current = owner[i]; if (i > lastUnit) tails[current] += base[i] }
      i++
    } else { put(current, target[j] === ' ' && han(target[j - 1]) && han(target[j + 1]) ? '，' : target[j], j); j++ }
  }
  // 拼接时两个英文词块之间会自动加空格；改后的文字在这里没有空格（“work body”改成“WorkBuddy”）就并进前一个词块
  for (let index = 0; index + 1 < texts.length; index++) {
    const next = texts.findIndex((value, at) => at > index && value)
    if (next < 0 || !texts[index] || last[index] < 0 || last[index] + 1 !== first[next]) continue
    if (joinAudioEditText(texts[index], texts[next]).length === texts[index].length + texts[next].length) continue
    texts[index] += texts[next]; last[index] = last[next]; texts[next] = ''
  }
  // 变空的词块仍留在原字幕段里（分段与字幕 ID 不变），只是不再显示
  const updates = new Map(blocks.map((block, index) => [block.id, texts[index].trim() ? texts[index].trim() + tails[index] : '']))
  return { ...project, transcript: project.transcript.map(block => updates.has(block.id) && updates.get(block.id) !== block.text.trim() ? { ...block, text: updates.get(block.id)! } : block) }
}
