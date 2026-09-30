import type { VideoEditBin, VideoEditDocument, VideoEditItem, VideoEditSequence } from '@/core/videoEdit/document'

export type VideoEditProjectEntry = { kind: 'item'; value: VideoEditItem } | { kind: 'sequence'; value: VideoEditSequence }
export function videoEditProjectEntries(document: VideoEditDocument, binId: string, keyword: string, sort: 'name' | 'kind' | 'duration'): VideoEditProjectEntry[] {
  const query = keyword.trim().toLocaleLowerCase()
  const entries: VideoEditProjectEntry[] = [...document.items.map(value => ({ kind: 'item' as const, value })), ...document.sequences.map(value => ({ kind: 'sequence' as const, value }))]
  const media = new Map(document.media.map(item => [item.id, item]))
  const duration = (entry: VideoEditProjectEntry): number => entry.kind === 'sequence' ? Math.max(0, ...entry.value.clips.map(clip => clip.start + clip.duration)) * entry.value.frameRate.denominator / entry.value.frameRate.numerator : media.get(entry.value.mediaId ?? '')?.durationSeconds ?? 0
  return entries.filter(entry => (!query ? (entry.value.binId ?? '') === binId : `${entry.value.name} ${entry.kind === 'item' ? entry.value.tags?.join(' ') ?? '' : '序列'}`.toLocaleLowerCase().includes(query)))
    .sort((left, right) => (sort === 'duration' ? duration(left) - duration(right) : sort === 'kind' ? (left.kind === 'item' ? left.value.kind : 'sequence').localeCompare(right.kind === 'item' ? right.value.kind : 'sequence') : 0) || left.value.name.localeCompare(right.value.name, 'zh-CN'))
}
export function videoEditBinRows(bins: VideoEditBin[], collapsed: ReadonlySet<string>): { bin: VideoEditBin; depth: number; hasChildren: boolean }[] {
  const rows: { bin: VideoEditBin; depth: number; hasChildren: boolean }[] = []
  const walk = (parentId: string | undefined, depth: number): void => {
    for (const bin of bins.filter(item => item.parentId === parentId).sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'))) {
      const hasChildren = bins.some(item => item.parentId === bin.id)
      rows.push({ bin, depth, hasChildren }); if (!collapsed.has(bin.id)) walk(bin.id, depth + 1)
    }
  }
  walk(undefined, 0); return rows
}
export function selectVideoEditProjectItems(ids: string[], current: string[], clicked: string, anchor: string | null, modifiers: { toggle: boolean; range: boolean }): string[] {
  if (modifiers.range && anchor && ids.includes(anchor)) {
    const from = ids.indexOf(anchor); const to = ids.indexOf(clicked)
    const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1)
    return modifiers.toggle ? [...new Set([...current, ...range])] : range
  }
  return modifiers.toggle ? (current.includes(clicked) ? current.filter(id => id !== clicked) : [...current, clicked]) : [clicked]
}
