import { buildProjectAudioEditTimeline } from './timeline'
import { buildAudioEditSubtitleGroups, joinAudioEditText } from './captions'
import type { AudioEditProjectDocument, AudioEditTimelineSpan, AudioEditTranscriptBlock } from './types'
import { formatSubtitleTimestampUs } from '../media/subtitleFormat'
import { isAudioEditSubtitleFiller } from './scriptCaptions'

/** 两条字幕间隔短于此（秒）就接上：前一条一直显示到后一条出现，不闪空。 */
const AUDIO_EDIT_SUBTITLE_JOIN_GAP_SECONDS = 0.5
/** 字幕比第一个字的起音早这么多秒出现：正好卡在起音上，看的人读到时声音已经过去了，会觉得字幕慢半拍。 */
const AUDIO_EDIT_SUBTITLE_LEAD_SECONDS = 0.1

// 跟在数字后的单位符号（70%、30°）与数字算一个整体，和中文之间同样留空格。
const HAN_TO_ASCII = /(\p{Script=Han})[ \u3000]*([A-Za-z0-9])/gu
const ASCII_TO_HAN = /([A-Za-z0-9%‰°℃])[ \u3000]*(\p{Script=Han})/gu

/** 去掉排版时在中文与英文、数字之间加的空格：改字写回词块时用，与上面两条规则互逆。 */
export function removeAudioEditSubtitleSpacing(text: string): string {
  return text.replace(/(\p{Script=Han})[ \u3000]+(?=[A-Za-z0-9])/gu, '$1').replace(/([A-Za-z0-9%‰°℃])[ \u3000]+(?=\p{Script=Han})/gu, '$1')
}

const PAIRED_MARKS: Readonly<Record<string, string>> = { '“': '”', '‘': '’', '「': '」', '『': '』', '《': '》' }
const CLOSING_MARKS = new Set(Object.values(PAIRED_MARKS))

/**
 * 一条字幕里配不上对的引号、书名号去掉：另一半落在别的字幕里，或随删掉的词一起没了，留着就是孤零零的半个引号。
 * 只删不补：改字写回词块时同样删掉，显示与词块保持一致。
 */
function withoutUnpairedMarks(text: string): string {
  const chars = [...text]
  const open: number[] = []
  const dropped = new Set<number>()
  chars.forEach((char, index) => {
    if (PAIRED_MARKS[char]) { open.push(index); return }
    if (!CLOSING_MARKS.has(char)) return
    let match = open.length - 1
    while (match >= 0 && PAIRED_MARKS[chars[open[match]]] !== char) match--
    if (match < 0) { dropped.add(index); return }
    for (const at of open.splice(match).slice(1)) dropped.add(at)
  })
  for (const at of open) dropped.add(at)
  return dropped.size ? chars.filter((_, index) => !dropped.has(index)).join('') : text
}

/** 参考稿里加了书名号的名字（去掉空白），用来判断识别加的书名号留不留；没有稿子时为空，一律保留。 */
function scriptTitleMarks(referenceScript: string | undefined): ReadonlySet<string> | undefined {
  if (!referenceScript?.trim()) return undefined
  return new Set([...referenceScript.matchAll(/《([^《》]*)》/gu)].map((match) => match[1].replace(/\s/gu, '')))
}

/** 识别常给网站、媒体名加书名号（《央广网》）；有参考稿时以稿子为准，稿子里没加的去掉。 */
function withoutUnscriptedTitleMarks(text: string, titles: ReadonlySet<string> | undefined): string {
  return titles ? text.replace(/《([^《》]*)》/gu, (whole, inner: string) => titles.has(inner.replace(/\s/gu, '')) ? whole : inner) : text
}

/**
 * 成片字幕的排版：中文与英文、数字之间留一个半角空格；去掉句首标点和行尾的逗号、句号、顿号、分号、冒号，
 * 句中的逗号、句号改为空格（问号、感叹号、省略号保留）；引号、书名号的后半个前面紧贴的逗号句号去掉，配不上对的引号、书名号去掉。
 * 只改显示，不改词块文字。
 */
export function formatAudioEditSubtitleText(text: string): string {
  return withoutUnpairedMarks(text.trim())
    .replace(/^[\s，。！？；：、,.!?;:]+/u, '')
    .replace(HAN_TO_ASCII, '$1 $2').replace(ASCII_TO_HAN, '$1 $2')
    .replace(/[，。；：、,.;:]+(?=[”’」』》])/gu, '')
    .replace(/[，。；：、,.;:]+$/u, '')
    // 句中的逗号、句号、分号改为一个空格（问号、感叹号、顿号、省略号照常）；英文的 “, ” “. ” 同样处理，php.net、0.3 不动
    .replace(/[，。；]+/gu, ' ').replace(/[,.;](?=\s)/gu, ' ')
    .replace(/[ \u3000]{2,}/gu, ' ')
    .trim()
}

/**
 * 词在剪后成品里的时间：头尾被剪掉一点（气口清理常切到字尾）时取留下的部分；只剩一丝（换遍拼接时贴着切点的那点字头）
 * 不算念到了。留下不到四成、又不到 0.15 秒的词不上字幕。
 */
function outputRange(startFrame: number, endFrame: number, spans: readonly AudioEditTimelineSpan[], sampleRate: number): { start: number; end: number } | null {
  let first: AudioEditTimelineSpan | undefined, last: AudioEditTimelineSpan | undefined
  let retained = 0
  for (const span of spans) {
    if (span.sourceEndFrame <= startFrame) continue
    if (span.sourceStartFrame >= endFrame) break
    first ??= span; last = span
    retained += Math.min(endFrame, span.sourceEndFrame) - Math.max(startFrame, span.sourceStartFrame)
  }
  if (!first || !last || (retained < (endFrame - startFrame) * 0.4 && retained < sampleRate * 0.15)) return null
  return { start: first.outputStartFrame + Math.max(0, startFrame - first.sourceStartFrame), end: last.outputStartFrame + Math.min(endFrame, last.sourceEndFrame) - last.sourceStartFrame }
}

interface AudioEditSubtitleWord { blockId: string; text: string; startFrame: number; endFrame: number }
/** 一条成片字幕：时间是剪后成品的采样帧。id 为这段第一个词块的 ID（与 audio_edit.caption 实体一致）。 */
export interface AudioEditSubtitleCue { id: string; startFrame: number; endFrame: number; text: string; words: AudioEditSubtitleWord[] }

/**
 * 成片字幕：按字幕分段取保留的词（单独的叹词、语气词如“哎”“嗯”不上字幕），映射到剪后时间，排版，每条提前 0.1 秒出现
 * （不早于上一条开头），间隔短于 0.5 秒的接上（提前出现压到上一条时，上一条在这里结束）。
 * 音频编辑导出的 SRT、首次放进剪辑时生成的字幕都用这一份；词的时间（words）不提前。给了参考稿时书名号以稿子为准。
 */
export function buildAudioEditSubtitleCues(blocks: readonly AudioEditTranscriptBlock[], spans: readonly AudioEditTimelineSpan[], sampleRate: number, referenceScript?: string): AudioEditSubtitleCue[] {
  const titles = scriptTitleMarks(referenceScript)
  const cues = buildAudioEditSubtitleGroups(blocks, sampleRate).flatMap((group): AudioEditSubtitleCue[] => {
    const words = group.blocks.flatMap((block): AudioEditSubtitleWord[] => {
      // 校对时改空的词块、单独的叹词不上字幕
      if (!block.text.trim() || isAudioEditSubtitleFiller(block.text)) return []
      const range = outputRange(block.startFrame, block.endFrame, spans, sampleRate)
      return range ? [{ blockId: block.id, text: block.text.trim(), startFrame: range.start, endFrame: Math.max(range.start + 1, range.end) }] : []
    })
    const text = formatAudioEditSubtitleText(withoutUnscriptedTitleMarks(words.reduce((value, word) => joinAudioEditText(value, word.text), ''), titles))
    return words.length && text ? [{ id: group.id, startFrame: words[0].startFrame, endFrame: words.at(-1)!.endFrame, text, words }] : []
  })
  const join = Math.round(AUDIO_EDIT_SUBTITLE_JOIN_GAP_SECONDS * sampleRate)
  const lead = Math.round(AUDIO_EDIT_SUBTITLE_LEAD_SECONDS * sampleRate)
  const led = cues.map((cue, index) => ({ ...cue, startFrame: Math.max(0, cue.startFrame - lead, index ? cues[index - 1].startFrame + 1 : 0) }))
  return led.map((cue, index) => {
    const next = led[index + 1]
    return next && next.startFrame - cue.endFrame < join ? { ...cue, endFrame: Math.max(cue.startFrame + 1, next.startFrame) } : cue
  })
}

export function buildProjectAudioEditSubtitleCues(project: AudioEditProjectDocument): AudioEditSubtitleCue[] {
  return buildAudioEditSubtitleCues(project.transcript, buildProjectAudioEditTimeline(project), project.source.sampleRate, project.referenceScript)
}

export function buildAudioEditSrt(
  blocks: readonly AudioEditTranscriptBlock[],
  spans: readonly AudioEditTimelineSpan[],
  sampleRate: number,
  referenceScript?: string,
): string {
  return buildAudioEditSubtitleCues(blocks, spans, sampleRate, referenceScript).map((cue, index) => [
    String(index + 1),
    `${formatSubtitleTimestampUs(cue.startFrame * 1e6 / Math.max(1, sampleRate))} --> ${formatSubtitleTimestampUs(cue.endFrame * 1e6 / Math.max(1, sampleRate))}`,
    cue.text,
    '',
  ].join('\n')).join('\n')
}
