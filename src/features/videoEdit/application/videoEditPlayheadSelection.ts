import type { VideoEditSequence } from '@/core/videoEdit/document'

/**
 * PR“选择跟随播放指示器”：播放头所在帧最上面的那个可见画面片段（轨道号越大越靠上）；
 * 没有画面时退到最上面的音频片段，什么都没有时为 `null`。隐藏（未启用）或锁定的轨道不参与。
 */
export function videoEditClipUnderPlayhead(sequence: Pick<VideoEditSequence, 'clips' | 'tracks'>, frame: number): string | null {
  const usable = new Map(sequence.tracks.filter(track => !track.locked && (track.kind === 'audio' ? !track.muted : track.enabled)).map(track => [track.index, track.kind]))
  let picture: { id: string; track: number } | undefined
  let sound: { id: string; track: number } | undefined
  for (const clip of sequence.clips) {
    if (frame < clip.start || frame >= clip.start + clip.duration) continue
    const kind = usable.get(clip.track); if (!kind) continue
    if (kind === 'video' && clip.kind !== 'audio') { if (!picture || clip.track > picture.track) picture = { id: clip.id, track: clip.track } }
    else if (kind === 'audio' && clip.kind === 'audio') { if (!sound || clip.track > sound.track) sound = { id: clip.id, track: clip.track } }
  }
  return picture?.id ?? sound?.id ?? null
}
