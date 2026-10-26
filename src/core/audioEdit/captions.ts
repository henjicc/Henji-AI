import type { AudioEditProjectDocument, AudioEditTranscriptBlock } from './types'
import { alignAudioEditToScript, audioEditSubtitleWidth, isAudioEditSubtitleFiller } from './scriptCaptions'

export interface AudioEditCaptionGroup {
  id: string
  blocks: AudioEditTranscriptBlock[]
  startFrame: number
  endFrame: number
  text: string
}

export function joinAudioEditText(left: string, right: string): string {
  // 逐词识别把数字拆成一个个数字（“2000”识别成 2、0、0、0），数字之间不加空格
  const digits = /[0-9]$/.test(left) && /^[0-9]/.test(right)
  return left + (!digits && /[a-z0-9]$/i.test(left) && /^[a-z0-9]/i.test(right) ? ' ' : '') + right
}

/** 逐词识别把“0.3”拆成 0、.、3：这个点是小数点，不是句号。 */
export const isAudioEditDecimalPoint = (left: string, right: string): boolean => /[0-9]\.$/.test(left) && /^[0-9]/.test(right)
const endsSentence = (left: string, right: string): boolean => /[。！？.!?；;]$/.test(left) && !isAudioEditDecimalPoint(left, right)

/** Group recognized blocks, never manufacture finer timestamps or rewrite speech. */
export function buildAudioEditCaptionGroups(blocks: readonly AudioEditTranscriptBlock[], sampleRate: number): AudioEditCaptionGroup[] {
  const groups: AudioEditCaptionGroup[] = []
  for (const block of blocks) {
    const previous = groups.at(-1)
    const last = previous?.blocks.at(-1)
    const text = block.text.trim()
    const canJoin = previous && last && last.included === block.included && last.locked === block.locked
      && last.captionBreakAfter !== true
      && (last.captionBreakAfter === false || (!endsSentence(previous.text, text)
        && block.startFrame - previous.endFrame < sampleRate * 0.6
        && block.endFrame - previous.startFrame <= sampleRate * 5
        && previous.text.length + text.length <= 32))
      && previous.blocks.length < 128 && previous.text.length + text.length <= 200
    if (canJoin) {
      previous.blocks.push(block)
      previous.endFrame = Math.max(previous.endFrame, block.endFrame)
      previous.text = joinAudioEditText(previous.text, text)
    } else groups.push({ id: block.id, blocks: [block], text, startFrame: block.startFrame, endFrame: block.endFrame })
  }
  return groups
}

/** 成片字幕的分段：只看保留的词块（删掉的重念、语气词不在字幕里，删掉的那几个字前后仍是同一句）。段 ID 为第一个词块的 ID。 */
export function buildAudioEditSubtitleGroups(blocks: readonly AudioEditTranscriptBlock[], sampleRate: number): AudioEditCaptionGroup[] {
  return buildAudioEditCaptionGroups(blocks.filter((block) => block.included && block.text.trim()), sampleRate)
}

/** 一行一句；超过这个宽度（汉字算 1，半角算半个）的长句在中间附近最明显的停顿处拆开。 */
const LONG_SUBTITLE_WIDTH = 24
const MIN_SUBTITLE_PART_WIDTH = 6

export function formatAudioEditCaptions(project: AudioEditProjectDocument): AudioEditProjectDocument {
  if (project.referenceScript.trim()) return formatAudioEditCaptionsByScript(project)
  // The assistant may refine these explicit boundaries through the same block fields.
  const groups = buildAudioEditCaptionGroups(project.transcript, project.source.sampleRate)
  const ends = new Set(groups.map((group) => group.blocks.at(-1)!.id))
  return { ...project, transcript: project.transcript.map((block) => block.locked ? block : { ...block, captionBreakAfter: ends.has(block.id) }) }
}

/**
 * 有参考稿时按稿子断句：稿子的逗号、句号、问号、感叹号、分号处换行，其余保留词块之间都接着；
 * 稿子里没有的一大段（多念的内容）按停顿兜底。被删的词块和锁定的词块不动。
 */
function formatAudioEditCaptionsByScript(project: AudioEditProjectDocument): AudioEditProjectDocument {
  const alignment = alignAudioEditToScript(project.transcript, project.referenceScript)
  let transcript = project.transcript.map((block) => {
    if (block.locked || !block.included) return block
    const { captionBreakAfter: _previous, ...rest } = block
    return alignment.unscripted.has(block.id) ? rest : { ...rest, captionBreakAfter: alignment.breaks.has(block.id) }
  })
  // 过长的一句在中间附近最明显的停顿处拆开（两边都至少 6 个字）
  for (let round = 0; round < 4; round++) {
    let changed = false
    for (const group of buildAudioEditSubtitleGroups(transcript, project.source.sampleRate)) {
      // 按显示出来的字算宽度：叹词不上字幕，标点在行尾会去掉
      const widths = group.blocks.map((block) => isAudioEditSubtitleFiller(block.text) ? 0 : audioEditSubtitleWidth(block.text.replace(/[\s\p{P}]/gu, '')))
      if (widths.reduce((sum, width) => sum + width, 0) <= LONG_SUBTITLE_WIDTH || group.blocks.some((block) => block.locked)) continue
      const total = widths.reduce((sum, width) => sum + width, 0)
      let best: { index: number; score: number } | undefined
      let left = 0
      for (let index = 0; index < group.blocks.length - 1; index++) {
        left += widths[index]
        if (left < MIN_SUBTITLE_PART_WIDTH || total - left < MIN_SUBTITLE_PART_WIDTH) continue
        const gap = Math.max(0, group.blocks[index + 1].startFrame - group.blocks[index].endFrame) / project.source.sampleRate
        const score = gap - Math.abs(left - total / 2) * 0.01
        if (!best || score > best.score) best = { index, score }
      }
      if (!best) continue
      const id = group.blocks[best.index].id
      transcript = transcript.map((block) => block.id === id ? { ...block, captionBreakAfter: true } : block)
      changed = true
    }
    if (!changed) break
  }
  return { ...project, transcript }
}
