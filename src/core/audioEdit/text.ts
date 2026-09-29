import type { AudioEditTranscriptBlock } from './types'

export interface AudioEditTextMatch {
  start: number; end: number; blockIds: string[]; value: string
  captures?: Array<string | undefined>
  groups?: Record<string, string | undefined>
}
export interface AudioEditTextFragment { text: string; matchIndex?: number; replacement?: string }

export function findAudioEditText(blocks: readonly AudioEditTranscriptBlock[], query: string, regex = false): AudioEditTextMatch[] {
  if (!query) return []
  let offset = 0
  const ranges = blocks.map((block) => { const start = offset; offset += block.text.length; return { start, end: offset, id: block.id } })
  const text = blocks.map((block) => block.text).join('')
  const matches: AudioEditTextMatch[] = []
  const pattern = regex ? new RegExp(query, 'gu') : null
  let found = pattern?.exec(text)
  let start = pattern ? found?.index ?? -1 : text.indexOf(query)
  let blockIndex = 0
  while (start >= 0) {
    const value = pattern ? found![0] : query
    const end = start + value.length
    // Empty regex matches have no text to highlight or replace.
    if (end === start) {
      pattern!.lastIndex = start + ((text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1)
      found = pattern!.exec(text)
      start = found?.index ?? -1
      continue
    }
    while (blockIndex < ranges.length && ranges[blockIndex].end <= start) blockIndex += 1
    const blockIds: string[] = []
    for (let index = blockIndex; index < ranges.length && ranges[index].start < end; index += 1) {
      if (ranges[index].end > start) blockIds.push(ranges[index].id)
    }
    matches.push({ start, end, blockIds, value, ...(pattern ? { captures: found!.slice(1), groups: found!.groups } : {}) })
    found = pattern?.exec(text)
    start = pattern ? found?.index ?? -1 : text.indexOf(query, end)
  }
  return matches
}

export function resolveAudioEditReplacement(match: AudioEditTextMatch, replacement: string, sourceText: string): string {
  if (!match.captures) return replacement
  const captures = match.captures
  return replacement.replace(/\$(\$|&|`|'|<[^>]+>|\d{1,2})/g, (token: string, key: string) => {
    if (key === '$') return '$'
    if (key === '&') return match.value
    if (key === '`') return sourceText.slice(0, match.start)
    if (key === "'") return sourceText.slice(match.end)
    if (key.startsWith('<')) return match.groups ? match.groups[key.slice(1, -1)] ?? '' : token
    const index = Number(key)
    if (index > 0 && index <= captures.length) return captures[index - 1] ?? ''
    const first = Number(key[0])
    return key.length === 2 && first > 0 && first <= captures.length ? (captures[first - 1] ?? '') + key[1] : token
  })
}

/** Preview and commit share the same replacement expansion, including regex groups. */
export function previewAudioEditText(blocks: readonly AudioEditTranscriptBlock[], matches: readonly AudioEditTextMatch[], replacement?: string): Map<string, AudioEditTextFragment[]> {
  let offset = 0
  const byId = new Map<string, { block: AudioEditTranscriptBlock; start: number }>(blocks.map((block) => { const start = offset; offset += block.text.length; return [block.id, { block, start }] }))
  const source = blocks.map((block) => block.text).join('')
  const pieces = new Map<string, Array<{ start: number; end: number; matchIndex: number; replacement?: string }>>()
  matches.forEach((match, matchIndex) => {
    const replacementText = replacement === undefined ? undefined : resolveAudioEditReplacement(match, replacement, source)
    const canReplace = replacementText !== undefined && replacementText !== match.value && !match.blockIds.some((id) => byId.get(id)?.block.locked)
    match.blockIds.forEach((id, part) => {
      const entry = byId.get(id)
      if (!entry) return
      const ranges = pieces.get(id) ?? []
      ranges.push({ start: Math.max(0, match.start - entry.start), end: Math.min(entry.block.text.length, match.end - entry.start), matchIndex,
        ...(canReplace ? { replacement: part === 0 ? replacementText : '' } : {}) })
      pieces.set(id, ranges)
    })
  })
  return new Map<string, AudioEditTextFragment[]>([...pieces].map(([id, ranges]) => {
    const text = byId.get(id)!.block.text
    const fragments: AudioEditTextFragment[] = []
    let cursor = 0
    for (const range of ranges) {
      if (range.start > cursor) fragments.push({ text: text.slice(cursor, range.start) })
      fragments.push({ text: text.slice(range.start, range.end), matchIndex: range.matchIndex, replacement: range.replacement })
      cursor = range.end
    }
    if (cursor < text.length) fragments.push({ text: text.slice(cursor) })
    return [id, fragments]
  }))
}

/** Keep the existing audio timestamps; replacements only correct caption text. */
export function replaceAudioEditText(blocks: readonly AudioEditTranscriptBlock[], matches: readonly AudioEditTextMatch[], replacement: string): AudioEditTranscriptBlock[] {
  let offset = 0
  const ranges = blocks.map((block) => { const start = offset; offset += block.text.length; return { start, end: offset } })
  const texts = blocks.map((block) => block.text)
  const source = texts.join('')
  const byId = new Map(blocks.map((block, index) => [block.id, { block, index }]))
  for (const match of [...matches].sort((a, b) => b.start - a.start)) {
    const affected = match.blockIds.flatMap((id) => { const entry = byId.get(id); return entry ? [entry] : [] })
    if (!affected.length || affected.some(({ block }) => block.locked)) continue
    affected.forEach(({ index }, part) => {
      const range = ranges[index]
      const start = Math.max(0, match.start - range.start)
      const end = Math.min(blocks[index].text.length, match.end - range.start)
      texts[index] = texts[index].slice(0, start) + (part === 0 ? resolveAudioEditReplacement(match, replacement, source) : '') + texts[index].slice(end)
    })
  }
  return blocks.map((block, index) => texts[index] === block.text ? block : { ...block, text: texts[index] })
}
