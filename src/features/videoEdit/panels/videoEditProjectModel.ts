import type { VideoEditBin, VideoEditDocument, VideoEditItem, VideoEditSequence, VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditLabelOf, type VideoEditLabel } from '@/core/videoEdit/labels'
import { videoEditFps } from '@/core/videoEdit/time'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'
import { videoEditDuration } from '@/core/videoEdit/document'

export type VideoEditProjectEntry = { kind: 'item'; value: VideoEditItem } | { kind: 'sequence'; value: VideoEditSequence } | { kind: 'bin'; value: VideoEditBin }
/** 列表视图可排序的列（PR 素材面板列表：名称、帧速率、媒体开始、媒体结束、媒体持续时间），另有图标视图沿用的“类型”。 */
export type VideoEditProjectSortKey = 'name' | 'kind' | 'frameRate' | 'mediaStart' | 'mediaEnd' | 'duration'
export interface VideoEditProjectSort { key: VideoEditProjectSortKey; direction: 'asc' | 'desc' }
/** 列表的一行：素材箱可展开（PR 三角），子项缩进一级。 */
export interface VideoEditProjectRow { entry: VideoEditProjectEntry; depth: number; expandable: boolean; expanded: boolean }
/** 一行的列内容：`frameRate`／`duration` 是排序用的数值（没有则 undefined，排在最后）。 */
export interface VideoEditProjectColumns { label: VideoEditLabel; frameRateText: string; frameRate?: number; mediaStart: string; mediaEnd: string; mediaStartSeconds?: number; mediaEndSeconds?: number; durationText: string; duration?: number }

const kindOf = (entry: VideoEditProjectEntry): string => entry.kind === 'item' ? entry.value.kind : entry.kind
/**
 * 一行的列内容。视频按素材帧率算时间码；序列按序列帧率；音频没有帧率，按 `fallbackFps`（当前序列）显示时间码、帧速率列显示采样率。
 * 图片、文字、图形等没有媒体时长的项留空。子剪辑按源范围显示开始、结束与持续时间。
 */
export function videoEditProjectColumns(document: VideoEditDocument, entry: VideoEditProjectEntry, fallbackFps: number, mediaById?: ReadonlyMap<string, VideoEditMedia>): VideoEditProjectColumns {
  if (entry.kind === 'bin') return { label: videoEditLabelOf('bin', entry.value.label), frameRateText: '', mediaStart: '', mediaEnd: '', durationText: '' }
  const timed = (fps: number, frames: number, frameRateText: string, frameRate: number | undefined, label: VideoEditLabel, start = 0): VideoEditProjectColumns => ({
    label, frameRateText, frameRate, mediaStart: videoEditFrameTimecode(start, fps), mediaEnd: videoEditFrameTimecode(start + Math.max(0, frames - 1), fps), mediaStartSeconds: start / fps, mediaEndSeconds: (start + Math.max(0, frames - 1)) / fps, durationText: videoEditFrameTimecode(frames, fps), duration: frames / fps,
  })
  const rateText = (fps: number): string => `${Number(fps.toFixed(3))} fps`
  if (entry.kind === 'sequence') {
    const fps = videoEditFps(entry.value.frameRate)
    return timed(fps, entry.value.clips.length || entry.value.captions?.length || entry.value.markers?.length ? videoEditDuration(entry.value) : 0, rateText(fps), fps, videoEditLabelOf('sequence', entry.value.label))
  }
  const item = entry.value
  const label = videoEditLabelOf(item.kind, item.label)
  const media = mediaById ? mediaById.get(item.mediaId ?? '') : document.media.find(value => value.id === item.mediaId)
  if (!media || media.kind === 'image' || !media.durationSeconds) return { label, frameRateText: '', mediaStart: '', mediaEnd: '', durationText: '' }
  const startSeconds = (item.sourceRange?.inUs ?? 0) / 1e6
  const durationSeconds = item.sourceRange ? (item.sourceRange.outUs - item.sourceRange.inUs) / 1e6 : media.durationSeconds
  if (media.kind === 'audio' || !media.frameRate) {
    const sampleRate = media.audioStreams?.[0]?.sampleRate
    return timed(fallbackFps, Math.round(durationSeconds * fallbackFps), sampleRate ? `${sampleRate} Hz` : '', sampleRate, label, Math.round(startSeconds * fallbackFps))
  }
  const fps = videoEditFps(media.frameRate)
  return timed(fps, Math.round(durationSeconds * fps), rateText(fps), fps, label, Math.round(startSeconds * fps))
}

function compare(document: VideoEditDocument, sort: VideoEditProjectSort, fallbackFps: number, binsFirst: boolean): (left: VideoEditProjectEntry, right: VideoEditProjectEntry) => number {
  const columns = new Map<VideoEditProjectEntry, VideoEditProjectColumns>()
  const mediaById = new Map(document.media.map(media => [media.id, media]))
  const of = (entry: VideoEditProjectEntry): VideoEditProjectColumns => { let value = columns.get(entry); if (!value) { value = videoEditProjectColumns(document, entry, fallbackFps, mediaById); columns.set(entry, value) } return value }
  const byName = (left: VideoEditProjectEntry, right: VideoEditProjectEntry): number => left.value.name.localeCompare(right.value.name, 'zh-CN', { numeric: true })
  const numeric = (key: 'frameRate' | 'duration' | 'mediaStartSeconds' | 'mediaEndSeconds') => (left: VideoEditProjectEntry, right: VideoEditProjectEntry): number => {
    const a = of(left)[key]; const b = of(right)[key]
    // 没有这一列数值的（素材箱、图片等）不论升降序都排在最后。
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1
    return (a - b) * (sort.direction === 'asc' ? 1 : -1)
  }
  const direction = sort.direction === 'asc' ? 1 : -1
  return (left, right) => {
    if (sort.key === 'name' && binsFirst && (left.kind === 'bin') !== (right.kind === 'bin')) return left.kind === 'bin' ? -1 : 1
    if (sort.key === 'frameRate' || sort.key === 'duration' || sort.key === 'mediaStart' || sort.key === 'mediaEnd') return numeric(sort.key === 'mediaStart' ? 'mediaStartSeconds' : sort.key === 'mediaEnd' ? 'mediaEndSeconds' : sort.key)(left, right) || byName(left, right)
    if (sort.key === 'kind') return kindOf(left).localeCompare(kindOf(right)) * direction || byName(left, right)
    return byName(left, right) * direction
  }
}

/**
 * 素材面板的行（PR 列表视图）：当前素材箱里的素材箱、素材项与序列按所选列排序，展开的素材箱把内容缩进列在下面。
 * 有搜索词时跨全部素材箱平铺匹配的素材项与序列（匹配名称与标签文字）。
 */
export function videoEditProjectRows(document: VideoEditDocument, binId: string, keyword: string, sort: VideoEditProjectSort, expanded: ReadonlySet<string>, fallbackFps = 30, binsFirst = true): VideoEditProjectRow[] {
  const query = keyword.trim().toLocaleLowerCase()
  const order = compare(document, sort, fallbackFps, binsFirst)
  if (query) {
    const entries: VideoEditProjectEntry[] = [...document.items.filter(value => value.kind !== 'sequence').map(value => ({ kind: 'item' as const, value })), ...document.sequences.map(value => ({ kind: 'sequence' as const, value }))]
    return entries.filter(entry => `${entry.value.name} ${entry.kind === 'item' ? entry.value.tags?.join(' ') ?? '' : '序列'}`.toLocaleLowerCase().includes(query)).sort(order).map(entry => ({ entry, depth: 0, expandable: false, expanded: false }))
  }
  const rows: VideoEditProjectRow[] = []
  const children = new Map<string, VideoEditProjectEntry[]>()
  const add = (parent: string, entry: VideoEditProjectEntry): void => { const values = children.get(parent) ?? []; values.push(entry); children.set(parent, values) }
  for (const value of document.bins) add(value.parentId ?? '', { kind: 'bin', value })
  for (const value of document.items) if (value.kind !== 'sequence') add(value.binId ?? '', { kind: 'item', value })
  for (const value of document.sequences) add(value.binId ?? '', { kind: 'sequence', value })
  const pending: Array<{ entry: VideoEditProjectEntry; depth: number }> = []
  const push = (parent: string, depth: number): void => { const values = (children.get(parent) ?? []).sort(order); for (let index = values.length - 1; index >= 0; index--) pending.push({ entry: values[index], depth }) }
  const visited = new Set<string>(); push(binId, 0)
  while (pending.length) {
    const { entry, depth } = pending.pop()!
    const open = entry.kind === 'bin' && expanded.has(entry.value.id)
    rows.push({ entry, depth, expandable: entry.kind === 'bin', expanded: open })
    if (open && !visited.has(entry.value.id)) { visited.add(entry.value.id); push(entry.value.id, depth + 1) }
  }
  return rows
}
/** 从根到 `binId` 的素材箱链（面板顶部的位置与“上一级”）。 */
export function videoEditBinPath(bins: readonly VideoEditBin[], binId: string): VideoEditBin[] {
  const path: VideoEditBin[] = []; const byId = new Map(bins.map(bin => [bin.id, bin])); const visited = new Set<string>()
  for (let current = byId.get(binId); current && !visited.has(current.id); current = byId.get(current.parentId ?? '')) { visited.add(current.id); path.push(current) }
  return path.reverse()
}
export function selectVideoEditProjectItems(ids: string[], current: string[], clicked: string, anchor: string | null, modifiers: { toggle: boolean; range: boolean }): string[] {
  if (modifiers.range && anchor && ids.includes(anchor)) {
    const from = ids.indexOf(anchor); const to = ids.indexOf(clicked)
    const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1)
    return modifiers.toggle ? [...new Set([...current, ...range])] : range
  }
  return modifiers.toggle ? (current.includes(clicked) ? current.filter(id => id !== clicked) : [...current, clicked]) : [clicked]
}
