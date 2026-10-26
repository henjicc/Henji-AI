import type { AudioEffectInstance } from '../audio/effects/audioEffectChain'
import type { VideoEditSequence } from './document'

type VideoEditTrack = VideoEditSequence['tracks'][number]

/**
 * 音轨混音（参照 Audition / PR 的音轨混合器）：每条轨道的片段先混进这条轨道的总线，过轨道效果、音量与声像后进主轨，
 * 主轨过主轨效果与主音量后输出。预览与导出都走剪辑混音（videoEditRenderer.mixAudio），逐样本一致。
 * 没有任何轨道或主轨设置时返回 null，混音按原来的方式把片段直接相加（结果与有总线时数值相同，只是更省）。
 */
export interface VideoEditTrackBus { key: string; index: number; gain: number; pan: number; effects: AudioEffectInstance[] }
export interface VideoEditAudioMixer { tracks: Map<number, VideoEditTrackBus>; master: { gain: number; effects: AudioEffectInstance[] } }

/** -60 dB 及以下视为静音（音轨混合器推子拉到底）。 */
export function videoEditBusGain(volumeDb: number | undefined): number {
  if (volumeDb === undefined) return 1
  return volumeDb <= -60 ? 0 : 10 ** (volumeDb / 20)
}
function activeEffects(effects: VideoEditTrack['effects']): AudioEffectInstance[] {
  return (effects ?? []).filter(effect => effect.enabled && effect.amount > 0 && effect.builtin).map(effect => ({ id: effect.id, builtin: { id: effect.builtin!.id, params: effect.builtin!.params }, amount: effect.amount }))
}
export function videoEditTrackHasMix(track: Pick<VideoEditTrack, 'volumeDb' | 'pan' | 'effects'>): boolean {
  return (track.volumeDb ?? 0) !== 0 || (track.pan ?? 0) !== 0 || activeEffects(track.effects).length > 0
}

export function videoEditAudioMixer(sequence: Pick<VideoEditSequence, 'tracks' | 'master'>): VideoEditAudioMixer | null {
  const masterEffects = activeEffects(sequence.master?.effects)
  const masterGain = videoEditBusGain(sequence.master?.volumeDb)
  const mixed = sequence.tracks.filter(videoEditTrackHasMix)
  if (!mixed.length && !masterEffects.length && masterGain === 1) return null
  return {
    tracks: new Map(sequence.tracks.map(track => [track.index, { key: `track:${track.id}`, index: track.index, gain: videoEditBusGain(track.volumeDb), pan: Math.max(-1, Math.min(1, (track.pan ?? 0) / 100)), effects: activeEffects(track.effects) }])),
    master: { gain: masterGain, effects: masterEffects },
  }
}

/** 声像按平衡处理（与 PR 立体声轨道一致）：居中不衰减，偏向一侧时压低另一侧。单声道序列不受声像影响。 */
export function videoEditPanGains(pan: number, channels: number): number[] {
  if (channels !== 2 || pan === 0) return Array.from({ length: channels }, () => 1)
  return [pan > 0 ? 1 - pan : 1, pan < 0 ? 1 + pan : 1]
}
