import type { AudioEditProjectDocument, AudioEditTranscriptBlock } from './types'

export interface AudioEditCaptionGroup {
  id: string
  blocks: AudioEditTranscriptBlock[]
  startFrame: number
  endFrame: number
  text: string
}

export function joinAudioEditText(left: string, right: string): string {
  return left + (/[a-z0-9]$/i.test(left) && /^[a-z0-9]/i.test(right) ? ' ' : '') + right
}

/** Group recognized blocks, never manufacture finer timestamps or rewrite speech. */
export function buildAudioEditCaptionGroups(blocks: readonly AudioEditTranscriptBlock[], sampleRate: number): AudioEditCaptionGroup[] {
  const groups: AudioEditCaptionGroup[] = []
  for (const block of blocks) {
    const previous = groups.at(-1)
    const last = previous?.blocks.at(-1)
    const text = block.text.trim()
    const canJoin = previous && last && last.included === block.included && last.locked === block.locked
      && last.captionBreakAfter !== true
      && (last.captionBreakAfter === false || (!/[。！？.!?；;]$/.test(previous.text)
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
