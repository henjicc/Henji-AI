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
 * 把一段字幕改成 text：与这段词块文字逐字比对，保留的字留在原词块，删掉的去掉，新加的字归到前一个字所在的词块
 * （开头新加的归第一个）。中文与英文、数字之间的空格是排版加的，比对前去掉。
 */
export function setAudioEditCaptionText(project: AudioEditProjectDocument, captionId: string, text: string): AudioEditProjectDocument {
  const group = buildAudioEditSubtitleGroups(project.transcript, project.source.sampleRate).find(item => item.id === captionId)
  if (!group) throw new Error('NOT_FOUND')
  if (group.blocks.some(block => block.locked)) throw new Error('这段字幕里有锁定的词块')
  const target = [...text.trim().replace(/(\p{Script=Han})[ \u3000]+/gu, '$1').replace(/[ \u3000]+(\p{Script=Han})/gu, '$1')]
  if (!target.length) throw new Error('字幕文字不能为空；不想要这段字幕请删掉对应的词')
  const base: string[] = [], owner: number[] = []
  let joined = ''
  group.blocks.forEach((block, index) => {
    const word = block.text.trim()
    const next = joinAudioEditText(joined, word)
    for (let gap = next.length - joined.length - word.length; gap > 0; gap--) { base.push(' '); owner.push(-1) }
    for (const char of word) { base.push(char); owner.push(index) }
    joined = next
  })
  // 最长公共子序列（不分大小写，“work”改成“Work”仍归原词块）：字幕最多几百字，平方复杂度足够
  const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
  const n = base.length, m = target.length
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = same(base[i], target[j]) ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1])
  const texts = group.blocks.map(() => '')
  const first = group.blocks.map(() => -1), last = group.blocks.map(() => -1)
  const put = (index: number, j: number): void => { texts[index] += target[j]; if (first[index] < 0) first[index] = j; last[index] = j }
  let current = 0
  for (let i = 0, j = 0; i < n || j < m;) {
    if (i < n && j < m && same(base[i], target[j])) { if (owner[i] >= 0) { current = owner[i]; put(current, j) } i++; j++ }
    else if (i < n && (j >= m || table[i + 1][j] >= table[i][j + 1])) { if (owner[i] >= 0) current = owner[i]; i++ }
    else { put(current, j); j++ }
  }
  // 拼接时两个英文词块之间会自动加空格；改后的文字在这里没有空格（“work body”改成“WorkBuddy”）就并进前一个词块
  for (let index = 0; index + 1 < texts.length; index++) {
    const next = texts.findIndex((text, at) => at > index && text)
    if (next < 0 || !texts[index] || last[index] + 1 !== first[next]) continue
    if (joinAudioEditText(texts[index], texts[next]).length === texts[index].length + texts[next].length) continue
    texts[index] += texts[next]; last[index] = last[next]; texts[next] = ''
  }
  // 变空的词块不进字幕分段：它身上的“这里结束字幕段”交给前面最近的非空词块，分段不变
  const breakOn = new Set<number>()
  group.blocks.forEach((block, index) => {
    if (texts[index].trim() || block.captionBreakAfter !== true) return
    let at = index - 1
    while (at >= 0 && !texts[at].trim()) at--
    if (at >= 0) breakOn.add(at)
  })
  const updates = new Map(group.blocks.map((block, index) => [block.id, { text: texts[index].trim(), breakAfter: breakOn.has(index) }]))
  return { ...project, transcript: project.transcript.map((block) => {
    const update = updates.get(block.id)
    if (!update || (update.text === block.text.trim() && !update.breakAfter)) return block
    return { ...block, text: update.text, ...(update.breakAfter ? { captionBreakAfter: true } : {}) }
  }) }
}
