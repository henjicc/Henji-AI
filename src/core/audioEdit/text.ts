import type { AudioEditTranscriptBlock } from './types'

export interface AudioEditTextMatch { start: number; end: number; blockIds: string[] }

export function findAudioEditText(blocks: readonly AudioEditTranscriptBlock[], query: string): AudioEditTextMatch[] {
  if (!query) return []
  let offset = 0
  const ranges = blocks.map((block) => { const start = offset; offset += block.text.length; return { start, end: offset, id: block.id } })
  const text = blocks.map((block) => block.text).join('')
  const matches: AudioEditTextMatch[] = []
  let start = text.indexOf(query)
  let blockIndex = 0
  while (start >= 0) {
    const end = start + query.length
    while (blockIndex < ranges.length && ranges[blockIndex].end <= start) blockIndex += 1
    const blockIds: string[] = []
    for (let index = blockIndex; index < ranges.length && ranges[index].start < end; index += 1) {
      if (ranges[index].end > start) blockIds.push(ranges[index].id)
    }
    matches.push({ start, end, blockIds })
    start = text.indexOf(query, end)
  }
  return matches
}

/** Keep the existing audio timestamps; replacements only correct caption text. */
export function replaceAudioEditText(blocks: readonly AudioEditTranscriptBlock[], matches: readonly AudioEditTextMatch[], replacement: string): AudioEditTranscriptBlock[] {
  let offset = 0
  const ranges = blocks.map((block) => { const start = offset; offset += block.text.length; return { start, end: offset } })
  const texts = blocks.map((block) => block.text)
  const byId = new Map(blocks.map((block, index) => [block.id, { block, index }]))
  for (const match of [...matches].sort((a, b) => b.start - a.start)) {
    const affected = match.blockIds.flatMap((id) => { const entry = byId.get(id); return entry ? [entry] : [] })
    if (!affected.length || affected.some(({ block }) => block.locked)) continue
    affected.forEach(({ index }, part) => {
      const range = ranges[index]
      const start = Math.max(0, match.start - range.start)
      const end = Math.min(blocks[index].text.length, match.end - range.start)
      texts[index] = texts[index].slice(0, start) + (part === 0 ? replacement : '') + texts[index].slice(end)
    })
  }
  return blocks.map((block, index) => texts[index] === block.text ? block : { ...block, text: texts[index] })
}
