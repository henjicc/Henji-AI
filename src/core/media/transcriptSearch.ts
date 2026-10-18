/** Search normalization never changes displayed text or invents character timestamps. */
export function normalizeTranscriptSearch(text: string): string {
  return text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

export interface TranscriptSearchRange { start: number; end: number }

/** Map normalized matches back to whole source blocks, including punctuation between them. */
export function findTranscriptSearchRanges(blocks: readonly { text: string }[], query: string): TranscriptSearchRange[] {
  const needle = normalizeTranscriptSearch(query)
  if (!needle) throw new Error('检索文字须包含文字或数字，不能只有标点。')
  const positions: number[] = []
  const parts = blocks.map((block, index) => {
    const text = normalizeTranscriptSearch(block.text)
    for (let i = 0; i < text.length; i++) positions.push(index)
    return text
  })
  const text = parts.join(''); const result: TranscriptSearchRange[] = []
  for (let at = text.indexOf(needle); at >= 0; at = text.indexOf(needle, at + needle.length)) {
    const start = positions[at]; const end = positions[at + needle.length - 1]
    const previous = result.at(-1)
    if (!previous || previous.start !== start || previous.end !== end) result.push({ start, end })
  }
  return result
}
