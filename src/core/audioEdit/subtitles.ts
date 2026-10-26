import { buildProjectAudioEditTimeline } from './timeline'
import { buildAudioEditSubtitleGroups, joinAudioEditText } from './captions'
import type { AudioEditProjectDocument, AudioEditTimelineSpan, AudioEditTranscriptBlock } from './types'
import { formatSubtitleTimestampUs } from '../media/subtitleFormat'
import { isAudioEditSubtitleFiller } from './scriptCaptions'

/** 两条字幕间隔短于此（秒）就接上：前一条一直显示到后一条出现，不闪空。 */
export const AUDIO_EDIT_SUBTITLE_JOIN_GAP_SECONDS = 0.5

const HAN_TO_ASCII = /(\p{Script=Han})[ \u3000]*([A-Za-z0-9])/gu
const ASCII_TO_HAN = /([A-Za-z0-9])[ \u3000]*(\p{Script=Han})/gu

/**
 * 成片字幕的排版：中文与英文、数字之间留一个半角空格；去掉句首标点和行尾的逗号、句号、顿号、分号、冒号，
 * 句中的逗号、句号改为空格（问号、感叹号、省略号保留）。只改显示，不改词块文字。
 */
export function formatAudioEditSubtitleText(text: string): string {
  return text.trim()
    .replace(/^[\s，。！？；：、,.!?;:]+/u, '')
    .replace(HAN_TO_ASCII, '$1 $2').replace(ASCII_TO_HAN, '$1 $2')
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

export interface AudioEditSubtitleWord { blockId: string; text: string; startFrame: number; endFrame: number }
/** 一条成片字幕：时间是剪后成品的采样帧。id 为这段第一个词块的 ID（与 audio_edit.caption 实体一致）。 */
export interface AudioEditSubtitleCue { id: string; startFrame: number; endFrame: number; text: string; words: AudioEditSubtitleWord[] }

/**
 * 成片字幕：按字幕分段取保留的词（单独的叹词、语气词如“哎”“嗯”不上字幕），映射到剪后时间，排版，间隔短于 0.5 秒的接上。
 * 音频编辑导出的 SRT、放进剪辑后的链接字幕都用这一份。
 */
export function buildAudioEditSubtitleCues(blocks: readonly AudioEditTranscriptBlock[], spans: readonly AudioEditTimelineSpan[], sampleRate: number): AudioEditSubtitleCue[] {
  const cues = buildAudioEditSubtitleGroups(blocks, sampleRate).flatMap((group): AudioEditSubtitleCue[] => {
    const words = group.blocks.flatMap((block): AudioEditSubtitleWord[] => {
      // 校对时改空的词块、单独的叹词不上字幕
      if (!block.text.trim() || isAudioEditSubtitleFiller(block.text)) return []
      const range = outputRange(block.startFrame, block.endFrame, spans, sampleRate)
      return range ? [{ blockId: block.id, text: block.text.trim(), startFrame: range.start, endFrame: Math.max(range.start + 1, range.end) }] : []
    })
    const text = formatAudioEditSubtitleText(words.reduce((value, word) => joinAudioEditText(value, word.text), ''))
    return words.length && text ? [{ id: group.id, startFrame: words[0].startFrame, endFrame: words.at(-1)!.endFrame, text, words }] : []
  })
  const join = Math.round(AUDIO_EDIT_SUBTITLE_JOIN_GAP_SECONDS * sampleRate)
  return cues.map((cue, index) => {
    const next = cues[index + 1]
    return next && next.startFrame > cue.endFrame && next.startFrame - cue.endFrame < join ? { ...cue, endFrame: next.startFrame } : cue
  })
}

export function buildProjectAudioEditSubtitleCues(project: AudioEditProjectDocument): AudioEditSubtitleCue[] {
  return buildAudioEditSubtitleCues(project.transcript, buildProjectAudioEditTimeline(project), project.source.sampleRate)
}

export function buildAudioEditSrt(
  blocks: readonly AudioEditTranscriptBlock[],
  spans: readonly AudioEditTimelineSpan[],
  sampleRate: number,
): string {
  return buildAudioEditSubtitleCues(blocks, spans, sampleRate).map((cue, index) => [
    String(index + 1),
    `${formatSubtitleTimestampUs(cue.startFrame * 1e6 / Math.max(1, sampleRate))} --> ${formatSubtitleTimestampUs(cue.endFrame * 1e6 / Math.max(1, sampleRate))}`,
    cue.text,
    '',
  ].join('\n')).join('\n')
}
