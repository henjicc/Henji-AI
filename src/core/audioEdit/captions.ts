import type { AudioEditProjectDocument, AudioEditTranscriptBlock } from './types'

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

export function formatAudioEditCaptions(project: AudioEditProjectDocument): AudioEditProjectDocument {
  // The assistant may refine these explicit boundaries through the same block fields.
  const groups = buildAudioEditCaptionGroups(project.transcript, project.source.sampleRate)
  const ends = new Set(groups.map((group) => group.blocks.at(-1)!.id))
  return { ...project, transcript: project.transcript.map((block) => block.locked ? block : { ...block, captionBreakAfter: ends.has(block.id) }) }
}
