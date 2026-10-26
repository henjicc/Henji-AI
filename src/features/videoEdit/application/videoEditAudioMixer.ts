import type { VideoEditDocument, VideoEditSequence } from '@/core/videoEdit/document'
import type { EssentialSoundSettings } from '@/core/audio/essentialSound'
import { beginVideoEditGesture, editVideoProject, finishVideoEditGesture, updateVideoEditParameterGesture, type VideoEditGesture } from './videoEditService'

/*
 * 音轨混合器与片段基本声音的写入（参照 Audition / PR 的音轨混合器）：轨道音量、声像、轨道效果，主轨音量与效果，
 * 片段的基本声音。拖动推子、旋钮、效果参数时走参数手势（实时试听、松手一步撤销），其余每次修改一步撤销。
 */

type Track = VideoEditSequence['tracks'][number]
export type VideoEditTrackMixPatch = Partial<Pick<Track, 'volumeDb' | 'pan' | 'effects'>>
export type VideoEditMasterPatch = NonNullable<VideoEditSequence['master']>

function editSequence(document: VideoEditDocument, sequenceId: string, update: (sequence: VideoEditSequence) => VideoEditSequence): VideoEditDocument {
  if (!document.sequences.some(sequence => sequence.id === sequenceId)) throw new Error('目标序列不存在。')
  return { ...document, sequences: document.sequences.map(sequence => sequence.id === sequenceId ? update(sequence) : sequence) }
}
function trackPatch(sequence: VideoEditSequence, trackId: string, patch: VideoEditTrackMixPatch): VideoEditSequence {
  const track = sequence.tracks.find(value => value.id === trackId)
  if (!track) throw new Error('目标轨道不存在。')
  if (track.kind !== 'audio' && patch.effects?.length) throw new Error('只有音频轨道可以加轨道效果。')
  const next = { ...track, ...patch }
  for (const key of ['volumeDb', 'pan'] as const) if (next[key] === 0) delete next[key]
  if (next.effects && !next.effects.length) delete next.effects
  return { ...sequence, tracks: sequence.tracks.map(value => value.id === trackId ? next : value) }
}
function masterPatch(sequence: VideoEditSequence, patch: VideoEditMasterPatch): VideoEditSequence {
  const master = { ...sequence.master, ...patch }
  if (master.volumeDb === 0) delete master.volumeDb
  if (master.effects && !master.effects.length) delete master.effects
  const { master: _previous, ...rest } = sequence
  return Object.keys(master).length ? { ...rest, master } : rest
}

/** 混合器的写入器：手势进行中写进手势（不进历史），否则直接一步编辑。 */
export function createVideoEditMixWriter(projectId: string) {
  let handle: VideoEditGesture | null = null
  const write = (update: (document: VideoEditDocument) => VideoEditDocument): void => { if (handle) updateVideoEditParameterGesture(handle, update); else editVideoProject(projectId, update) }
  return {
    gesture: () => {
      handle = beginVideoEditGesture(projectId)
      const end = (commit: boolean): void => { if (!handle) return; const current = handle; handle = null; finishVideoEditGesture(current, commit) }
      return { finish: () => end(true), cancel: () => end(false) }
    },
    track: (sequenceId: string, trackId: string, patch: VideoEditTrackMixPatch): void => write(document => editSequence(document, sequenceId, sequence => trackPatch(sequence, trackId, patch))),
    master: (sequenceId: string, patch: VideoEditMasterPatch): void => write(document => editSequence(document, sequenceId, sequence => masterPatch(sequence, patch))),
    essentialSound: (sequenceId: string, clipIds: readonly string[], essentialSound: EssentialSoundSettings | undefined): void => write(document => editSequence(document, sequenceId, sequence => ({
      ...sequence, clips: sequence.clips.map(clip => {
        if (!clipIds.includes(clip.id)) return clip
        if (clip.kind !== 'audio') throw new Error('基本声音只能用在声音片段上。')
        // 基本声音的类型就是片段的声音类型（回避等按它找片段），同一步写入。
        const next = { ...clip, essentialSound, ...(essentialSound ? { audioRole: essentialSound.type } : {}) }
        if (!essentialSound) delete next.essentialSound
        return next
      }),
    }))),
  }
}
export type VideoEditMixWriter = ReturnType<typeof createVideoEditMixWriter>
