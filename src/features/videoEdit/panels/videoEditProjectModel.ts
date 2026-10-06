import type { VideoEditBin, VideoEditDocument, VideoEditItem, VideoEditSequence } from '@/core/videoEdit/document'
import { videoEditLabelOf, type VideoEditLabel } from '@/core/videoEdit/labels'
import { videoEditFps } from '@/core/videoEdit/time'
import { videoEditFrameTimecode } from '@/core/videoEdit/timecode'

export type VideoEditProjectEntry = { kind: 'item'; value: VideoEditItem } | { kind: 'sequence'; value: VideoEditSequence } | { kind: 'bin'; value: VideoEditBin }
/** 列表视图可排序的列（PR 素材面板列表：名称、帧速率、媒体开始、媒体结束、媒体持续时间），另有图标视图沿用的“类型”。 */
export type VideoEditProjectSortKey = 'name' | 'kind' | 'frameRate' | 'mediaStart' | 'mediaEnd' | 'duration'
export interface VideoEditProjectSort { key: VideoEditProjectSortKey; direction: 'asc' | 'desc' }
/** 列表的一行：素材箱可展开（PR 三角），子项缩进一级。 */
export interface VideoEditProjectRow { entry: VideoEditProjectEntry; depth: number; expandable: boolean; expanded: boolean }
/** 一行的列内容：`frameRate`／`duration` 是排序用的数值（没有则 undefined，排在最后）。 */
export interface VideoEditProjectColumns { label: VideoEditLabel; frameRateText: string; frameRate?: number; mediaStart: string; mediaEnd: string; durationText: string; duration?: number }

const kindOf = (entry: VideoEditProjectEntry): string => entry.kind === 'item' ? entry.value.kind : entry.kind
/**
 * 一行的列内容。视频按素材帧率算时间码；序列按序列帧率；音频没有帧率，按 `fallbackFps`（当前序列）显示时间码、帧速率列显示采样率。
 * 图片、文字、图形等没有媒体时长的项留空。媒体开始总是 00:00:00:00（素材没有内嵌时间码时 PR 也从零起）。
 */
export function videoEditProjectColumns(document: VideoEditDocument, entry: VideoEditProjectEntry, fallbackFps: number): VideoEditProjectColumns {
  if (entry.kind === 'bin') return { label: videoEditLabelOf('bin', entry.value.label), frameRateText: '', mediaStart: '', mediaEnd: '', durationText: '' }
  const timed = (fps: number, frames: number, frameRateText: string, frameRate: number | undefined, label: VideoEditLabel): VideoEditProjectColumns => ({
    label, frameRateText, frameRate, mediaStart: videoEditFrameTimecode(0, fps), mediaEnd: videoEditFrameTimecode(Math.max(0, frames - 1), fps), durationText: videoEditFrameTimecode(frames, fps), duration: frames / fps,
  })
  const rateText = (fps: number): string => `${Number(fps.toFixed(3))} fps`
  if (entry.kind === 'sequence') {
    const fps = videoEditFps(entry.value.frameRate)
    return timed(fps, Math.max(0, ...entry.value.clips.map(clip => clip.start + clip.duration)), rateText(fps), fps, videoEditLabelOf('sequence', entry.value.label))
  }
  const item = entry.value
  const label = videoEditLabelOf(item.kind, item.label)
  const media = document.media.find(value => value.id === item.mediaId)
  if (!media || media.kind === 'image' || !media.durationSeconds) return { label, frameRateText: '', mediaStart: '', mediaEnd: '', durationText: '' }
  if (media.kind === 'audio' || !media.frameRate) {
    const sampleRate = media.audioStreams?.[0]?.sampleRate
    return timed(fallbackFps, Math.round(media.durationSeconds * fallbackFps), sampleRate ? `${sampleRate} Hz` : '', sampleRate, label)
  }
  const fps = videoEditFps(media.frameRate)
  return timed(fps, Math.round(media.durationSeconds * fps), rateText(fps), fps, label)
}

function compare(document: VideoEditDocument, sort: VideoEditProjectSort, fallbackFps: number): (left: VideoEditProjectEntry, right: VideoEditProjectEntry) => number {
  const columns = new Map<VideoEditProjectEntry, VideoEditProjectColumns>()
  const of = (entry: VideoEditProjectEntry): VideoEditProjectColumns => { let value = columns.get(entry); if (!value) { value = videoEditProjectColumns(document, entry, fallbackFps); columns.set(entry, value) } return value }
  const byName = (left: VideoEditProjectEntry, right: VideoEditProjectEntry): number => left.value.name.localeCompare(right.value.name, 'zh-CN', { numeric: true })
  const numeric = (key: 'frameRate' | 'duration') => (left: VideoEditProjectEntry, right: VideoEditProjectEntry): number => {
    const a = of(left)[key]; const b = of(right)[key]
    // 没有这一列数值的（素材箱、图片等）不论升降序都排在最后。
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? 1 : -1
    return (a - b) * (sort.direction === 'asc' ? 1 : -1)
  }
  const direction = sort.direction === 'asc' ? 1 : -1
  return (left, right) => {
    if (sort.key === 'frameRate' || sort.key === 'duration' || sort.key === 'mediaEnd') return numeric(sort.key === 'frameRate' ? 'frameRate' : 'duration')(left, right) || byName(left, right)
    if (sort.key === 'kind') return kindOf(left).localeCompare(kindOf(right)) * direction || byName(left, right)
    // 名称与媒体开始（都从零起）按名称排。
    return byName(left, right) * direction
  }
}

/**
 * 素材面板的行（PR 列表视图）：当前素材箱里的素材箱、素材项与序列按所选列排序，展开的素材箱把内容缩进列在下面。
 * 有搜索词时跨全部素材箱平铺匹配的素材项与序列（匹配名称与标签文字）。
 */
export function videoEditProjectRows(document: VideoEditDocument, binId: string, keyword: string, sort: VideoEditProjectSort, expanded: ReadonlySet<string>, fallbackFps = 30): VideoEditProjectRow[] {
  const query = keyword.trim().toLocaleLowerCase()
  const order = compare(document, sort, fallbackFps)
  if (query) {
    const entries: VideoEditProjectEntry[] = [...document.items.map(value => ({ kind: 'item' as const, value })), ...document.sequences.map(value => ({ kind: 'sequence' as const, value }))]
    return entries.filter(entry => `${entry.value.name} ${entry.kind === 'item' ? entry.value.tags?.join(' ') ?? '' : '序列'}`.toLocaleLowerCase().includes(query)).sort(order).map(entry => ({ entry, depth: 0, expandable: false, expanded: false }))
  }
  const rows: VideoEditProjectRow[] = []
  const walk = (parent: string, depth: number): void => {
    const children: VideoEditProjectEntry[] = [
      ...document.bins.filter(bin => (bin.parentId ?? '') === parent).map(value => ({ kind: 'bin' as const, value })),
      ...document.items.filter(item => (item.binId ?? '') === parent).map(value => ({ kind: 'item' as const, value })),
      ...document.sequences.filter(sequence => (sequence.binId ?? '') === parent).map(value => ({ kind: 'sequence' as const, value })),
    ].sort(order)
    for (const entry of children) {
      const open = entry.kind === 'bin' && expanded.has(entry.value.id)
      rows.push({ entry, depth, expandable: entry.kind === 'bin', expanded: open })
      if (open) walk(entry.value.id, depth + 1)
    }
  }
  walk(binId, 0)
  return rows
}
/** 从根到 `binId` 的素材箱链（面板顶部的位置与“上一级”）。 */
export function videoEditBinPath(bins: readonly VideoEditBin[], binId: string): VideoEditBin[] {
  const path: VideoEditBin[] = []
  for (let current = bins.find(bin => bin.id === binId); current && path.length <= bins.length; current = bins.find(bin => bin.id === current!.parentId)) path.unshift(current)
  return path
}
export function selectVideoEditProjectItems(ids: string[], current: string[], clicked: string, anchor: string | null, modifiers: { toggle: boolean; range: boolean }): string[] {
  if (modifiers.range && anchor && ids.includes(anchor)) {
    const from = ids.indexOf(anchor); const to = ids.indexOf(clicked)
    const range = ids.slice(Math.min(from, to), Math.max(from, to) + 1)
    return modifiers.toggle ? [...new Set([...current, ...range])] : range
  }
  return modifiers.toggle ? (current.includes(clicked) ? current.filter(id => id !== clicked) : [...current, clicked]) : [clicked]
}
