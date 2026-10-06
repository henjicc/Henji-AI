import type { VideoEditClip, VideoEditSequence } from './document'
import { videoEditEdgeTracks, type VideoEditTrack } from './tracks'

/**
 * 拖到节目监视器上的落点方式（对齐 Premiere 节目监视器的拖放区）：
 * - `overwrite` 覆盖：在落点覆盖目标轨道上的已有内容（默认）
 * - `insert` 插入：在落点插入，同步锁定轨道上落点之后的片段整体后移
 * - `replace` 替换：替换播放头下的片段，保持它在时间线上的位置与时长，从素材开头填充，并沿用它的运动、不透明度与效果
 * - `top` 放在顶层：放到落点范围内最上层已占用轨道之上的第一条空轨，没有就新建轨道
 * - `end` 添加到末尾：接在序列最后一个片段之后
 */
export type VideoEditDropMode = 'overwrite' | 'insert' | 'replace' | 'top' | 'end'

/** 结构上不依附源素材时长、可任意拉长的片段（替换时直接拉到被替换片段的长度）。 */
const STRETCHABLE: ReadonlySet<VideoEditClip['kind']> = new Set(['image', 'text', 'graphic', 'code', 'adjustment'])
const trackKind = (sequence: Pick<VideoEditSequence, 'tracks'>, index: number): 'video' | 'audio' | undefined => sequence.tracks.find(track => track.index === index)?.kind

/** 替换目标：目标轨道上盖住落点的片段优先，否则取该类轨道里最上层盖住落点的片段（未锁定）。 */
export function findVideoEditReplaceTarget(sequence: VideoEditSequence, frame: number, targetTrackIds: readonly string[], kind?: 'video' | 'audio'): VideoEditClip | undefined {
  const kinds: Array<'video' | 'audio'> = kind ? [kind] : ['video', 'audio']
  for (const lane of kinds) {
    const tracks = sequence.tracks.filter(track => track.kind === lane && !track.locked)
    const covering = sequence.clips.filter(clip => clip.start <= frame && frame < clip.start + clip.duration && tracks.some(track => track.index === clip.track))
    const targeted = covering.find(clip => tracks.some(track => track.index === clip.track && targetTrackIds.includes(track.id)))
    const topmost = covering.sort((a, b) => b.track - a.track)[0]
    if (targeted ?? topmost) return targeted ?? topmost
  }
  return undefined
}

/**
 * 把“替换 / 放在顶层 / 添加到末尾”换算成共享时间线放置编辑（覆盖或插入）所需的落点、轨道与片段，
 * 素材面板、文件拖入与源监视器范围共用同一条换算，保证落点与拖放区所示一致。
 * `clips` 是已经按目标轨道排好的待放片段（起点任意，只看相对位置）；`tracks` 是这些片段可能用到的全部轨道（含刚新建的）。
 */
export function resolveVideoEditDropMode(sequence: VideoEditSequence, clips: readonly VideoEditClip[], request: { mode: VideoEditDropMode; frame: number; targetTrackIds: readonly string[]; tracks?: readonly VideoEditTrack[] }): { frame: number; mode: 'overwrite' | 'insert'; clips: VideoEditClip[]; newTracks: VideoEditTrack[] } {
  if (!clips.length) throw new Error('没有可放置的片段。')
  const lanes = { tracks: [...sequence.tracks, ...(request.tracks ?? []).filter(track => !sequence.tracks.some(item => item.index === track.index))] }
  const from = Math.min(...clips.map(clip => clip.start))
  const length = Math.max(...clips.map(clip => clip.start + clip.duration)) - from
  const kindOf = (clip: VideoEditClip): 'video' | 'audio' => trackKind(lanes, clip.track) ?? (clip.kind === 'audio' ? 'audio' : 'video')
  if (request.mode === 'overwrite' || request.mode === 'insert') return { frame: request.frame, mode: request.mode, clips: [...clips], newTracks: [] }
  if (request.mode === 'end') return { frame: sequence.clips.length ? Math.max(...sequence.clips.map(clip => clip.start + clip.duration)) : 0, mode: 'overwrite', clips: [...clips], newTracks: [] }
  if (request.mode === 'top') {
    const end = request.frame + length; const newTracks: VideoEditTrack[] = []; const map = new Map<number, number>()
    for (const kind of ['video', 'audio'] as const) {
      const needed = [...new Set(clips.filter(clip => kindOf(clip) === kind).map(clip => clip.track))].sort((a, b) => a - b)
      if (!needed.length) continue
      const occupied = sequence.clips.filter(clip => trackKind(sequence, clip.track) === kind && clip.start < end && clip.start + clip.duration > request.frame).map(clip => clip.track)
      const above = Math.max(-1, ...occupied)
      const free = sequence.tracks.filter(track => track.kind === kind && !track.locked && track.index > above).map(track => track.index).sort((a, b) => a - b)
      if (free.length < needed.length) {
        const added = videoEditEdgeTracks({ tracks: [...sequence.tracks, ...newTracks] }, kind, needed.length - free.length)
        newTracks.push(...added); free.push(...added.map(track => track.index))
      }
      needed.forEach((track, offset) => map.set(track, free[offset]))
    }
    return { frame: request.frame, mode: 'overwrite', clips: clips.map(clip => ({ ...clip, track: map.get(clip.track) ?? clip.track })), newTracks }
  }
  // 替换：与 Premiere 相同，被替换片段的位置与时长不变，新素材从开头填满；音视频素材不够长时拒绝（不留空隙）。
  const primary = kindOf(clips[0])
  const target = findVideoEditReplaceTarget(sequence, request.frame, request.targetTrackIds, primary)
  if (!target) throw new Error(primary === 'audio' ? '播放头下没有可替换的音频片段。' : '播放头下没有可替换的画面片段。')
  if (length < target.duration && clips.some(clip => !STRETCHABLE.has(clip.kind))) throw new Error('素材比被替换的片段短，无法替换。')
  const partners = target.linkId ? sequence.clips.filter(clip => clip.id !== target.id && clip.linkId === target.linkId) : []
  const map = new Map<number, number>()
  for (const kind of ['video', 'audio'] as const) {
    const incoming = [...new Set(clips.filter(clip => kindOf(clip) === kind).map(clip => clip.track))].sort((a, b) => a - b)
    const anchor = kind === primary ? target.track : Math.min(Infinity, ...partners.filter(clip => trackKind(sequence, clip.track) === kind).map(clip => clip.track))
    if (!incoming.length || !Number.isFinite(anchor)) continue
    const ordered = lanes.tracks.filter(track => track.kind === kind).map(track => track.index).sort((a, b) => a - b)
    const base = ordered.indexOf(anchor)
    incoming.forEach((track, offset) => { const lane = ordered[base + offset]; if (lane === undefined) throw new Error('替换后的片段超出可用轨道。'); map.set(track, lane) })
  }
  const replacing = clips[0]
  const result = clips.flatMap(clip => {
    const offset = clip.start - from
    const duration = STRETCHABLE.has(clip.kind) && clip.track === replacing.track ? target.duration - offset : Math.min(clip.duration, target.duration - offset)
    if (duration < 1) return []
    const moved = { ...clip, track: map.get(clip.track) ?? clip.track, duration }
    // 新片段沿用被替换片段的画面属性与效果（Premiere“替换”保留原片段的调整）。
    return clip === replacing && target.kind !== 'audio' && clip.kind !== 'audio'
      ? [{ ...moved, x: target.x, y: target.y, scale: target.scale, rotation: target.rotation, opacity: target.opacity, ...(target.effects ? { effects: structuredClone(target.effects) } : {}) }]
      : [moved]
  })
  return { frame: target.start, mode: 'overwrite', clips: result, newTracks: [] }
}
