import type { z } from 'zod'
import type { placeVideoEditSoundEffectsCapability } from '@/core/application-control/domains/videoEdit/videoEditSoundEffectCapability'
import { ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { ApplicationPreflightFailure } from '@/core/application-control/execution/transactionFailure'
import { createLogger } from '@/core/logging'
import type { VideoEditDocument, VideoEditSequence } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { videoEditFps } from '@/core/videoEdit/time'
import { videoEditEdgeTracks } from '@/core/videoEdit/tracks'
import { locateSoundLibrarySound } from '@/commands/soundLibrary'
import type { SoundLibrarySoundLocation } from '@/platform/contracts/soundLibrary'
import { verifyVideoEditContentSaved } from './videoEditDocumentAlgorithm'
import { importVideoEditSources, sameVideoEditMediaPath } from './videoEditMedia'
import { splitVideoEditRef } from './videoEditReflection'
import { requireVideoEditInstance, saveVideoEdit } from './videoEditService'

/*
 * 音效卡点：把音效库里的音效放进序列，让击中点（或起音点）精确落在目标时刻。
 *
 * 片段起点只能是整数帧，所以起点取“不早于 目标 - 击中点”的第一帧，再用源入点（微秒）裁掉多出的那一点开头，
 * 击中点就正好落在目标时刻；目标离序列开头比击中点还近时，起点为 0、开头裁得更多。
 * 导入与放置在同一次剪辑编辑里提交（一步撤销），之后保存并按保存后的片段回算每个击中点核对。
 */

type Input = z.infer<typeof placeVideoEditSoundEffectsCapability.inputSchema>
type Output = z.infer<typeof placeVideoEditSoundEffectsCapability.outputSchema>
type Placement = Input['placements'][number]

const logger = createLogger('features.videoEdit.soundEffects')
/** 对齐核对的容差：源入点按微秒取整。 */
const ALIGN_TOLERANCE_SECONDS = 1e-5

interface Planned { placement: Placement; sound: SoundLibrarySoundLocation; targetSeconds: number; anchorSeconds: number }

function childOf(projectId: string, value: { kind: string; id: string }): string {
  const parsed = splitVideoEditRef(value)
  if (parsed.projectId !== projectId || !parsed.childId) throw new Error(`${value.kind} 必须属于目标剪辑，请使用目录返回的完整引用。`)
  return parsed.childId
}

function targetFrame(projectId: string, sequence: VideoEditSequence, at: Placement['at']): number {
  if (at.kind === 'frame') return at.frame
  if (at.kind === 'marker') {
    const marker = sequence.markers?.find(value => value.id === childOf(projectId, at.markerRef))
    if (!marker) throw new Error(`序列里没有这个标记；现有 ${sequence.markers?.length ?? 0} 个标记，可沿 video_edit.marker 列出。`)
    return marker.frame
  }
  const clip = sequence.clips.find(value => value.id === childOf(projectId, at.clipRef))
  if (!clip) throw new Error('切点所在片段不在这个序列里。')
  return at.edge === 'start' ? clip.start : clip.start + clip.duration
}

/** 与界面同一个正式入口：公共能力只把引用换成目标时刻。 */
export async function placeVideoEditSoundEffects(input: Input, signal?: AbortSignal): Promise<Output> {
  const projectId = input.documentRef.id
  const sequenceId = childOf(projectId, input.sequenceRef)
  const owner = requireVideoEditInstance(projectId)
  let planned: Planned[]
  try {
    const sequence = owner.document.sequences.find(value => value.id === sequenceId)
    if (!sequence) throw new Error('目标序列不存在。')
    const fps = videoEditFps(sequence.frameRate)
    const sounds = new Map<string, SoundLibrarySoundLocation>()
    for (const placement of input.placements) if (!sounds.has(placement.soundRef.id)) sounds.set(placement.soundRef.id, await locateSoundLibrarySound(placement.soundRef.id))
    planned = input.placements.map(placement => {
      const sound = sounds.get(placement.soundRef.id)!
      if (sound.features.peakDbfs === null) throw new Error(`${sound.label} 是静音文件，没有可对齐的击中点。`)
      const frame = targetFrame(projectId, sequence, placement.at) + placement.offsetFrames
      if (frame < 0) throw new Error('提前的帧数超过了序列开头。')
      return { placement, sound, targetSeconds: frame / fps, anchorSeconds: placement.anchor === 'attack' ? sound.features.attackSeconds : sound.features.hitSeconds }
    })
  } catch (error) { throw new ApplicationPreflightFailure(error) }
  signal?.throwIfAborted()
  const contentVersion = owner.contentVersion
  const results: Output['placements'] = []
  const paths = [...new Map(planned.map(plan => [plan.sound.path.toLowerCase(), plan.sound.path])).values()]
  logger.info('音效卡点开始', { event: 'video_edit.sound_effects.start', context: { projectId, sequenceId, placements: planned.length, sounds: paths.length } })
  try {
    await importVideoEditSources(projectId, paths.map(path => ({ path })), undefined, signal, (document: VideoEditDocument) => {
      if (owner.contentVersion !== contentVersion) throw new Error('剪辑在准备音效期间已有修改，请重新放置。')
      let sequence = document.sequences.find(value => value.id === sequenceId)!
      const fps = videoEditFps(sequence.frameRate)
      for (const plan of planned) {
        const media = document.media.find(value => sameVideoEditMediaPath(value.path, plan.sound.path))
        const item = media && document.items.find(value => value.mediaId === media.id)
        if (!media || !item) throw new Error(`${plan.sound.label} 未能导入剪辑。`)
        const start = Math.max(0, Math.ceil((plan.targetSeconds - plan.anchorSeconds) * fps - 1e-9))
        const sourceInUs = Math.max(0, Math.round((plan.anchorSeconds - (plan.targetSeconds - start / fps)) * 1e6))
        const free = (track: number, duration: number): boolean => !sequence.clips.some(clip => clip.track === track && clip.start < start + duration && clip.start + clip.duration > start)
        // 与 makeVideoEditItemClip 相同的可用时长（源入点之后的整帧数），先用它挑空闲轨道。
        const duration = Math.floor((Math.round(media.durationSeconds * 1e6) - sourceInUs) / 1e6 * fps + 1e-6)
        if (duration < 1) throw new Error(`${plan.sound.label} 在对齐点之后不足一帧，无法放置。`)
        let track = plan.placement.trackRef ? sequence.tracks.find(value => value.id === childOf(projectId, plan.placement.trackRef!)) : sequence.tracks.filter(value => value.kind === 'audio' && !value.locked && value.enabled).sort((a, b) => a.index - b.index).find(value => free(value.index, duration))
        if (plan.placement.trackRef && (!track || track.kind !== 'audio' || track.locked)) throw new Error('指定的轨道不是可用的音频轨道（不存在、是视频轨道或已锁定）。')
        if (track && !free(track.index, duration)) throw new Error(`指定的音频轨道在第 ${start} 帧起已有片段，请换一条轨道或省略 trackRef。`)
        if (!track) { [track] = videoEditEdgeTracks(sequence, 'audio', 1); sequence = { ...sequence, tracks: [...sequence.tracks, track] } }
        const clip = { ...makeVideoEditItemClip({ ...document, sequences: document.sequences.map(value => value.id === sequenceId ? sequence : value) }, item.id, sequenceId, { frame: start, track: track.index, sourceInUs }), audioRole: 'sound_effect' as const, ...(plan.placement.gainDb !== undefined ? { gainDb: plan.placement.gainDb } : {}) }
        sequence = { ...sequence, clips: [...sequence.clips, clip] }
        results.push({ clipRef: { kind: 'video_edit.clip', id: `${projectId}:${clip.id}` }, soundRef: plan.placement.soundRef, startFrame: start, targetSeconds: plan.targetSeconds, anchorSeconds: plan.anchorSeconds, alignedSeconds: start / fps + plan.anchorSeconds - sourceInUs / 1e6, trimmedHeadSeconds: sourceInUs / 1e6, trackRef: { kind: 'video_edit.track', id: `${projectId}:${track.id}` } })
      }
      return { ...document, sequences: document.sequences.map(value => value.id === sequenceId ? sequence : value) }
    })
  } catch (error) {
    logger.warn('音效卡点未完成，剪辑未改动', { event: 'video_edit.sound_effects.failed', error, context: { projectId, sequenceId } })
    if (owner.contentVersion === contentVersion) throw new ApplicationPreflightFailure(error)
    throw error
  }
  const expected = owner.document, committed = owner.contentVersion
  try { await saveVideoEdit(projectId) } catch (error) {
    throw new ApplicationPersistenceFailure('音效已放进剪辑但未保存，请重试保存，不要重复放置。', { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document', recovery: { capabilityId: 'save_video_edit', target: input.documentRef, replayMutation: false } }, error)
  }
  const saved = await verifyVideoEditContentSaved(owner, expected, committed)
  const sequence = owner.document.sequences.find(value => value.id === sequenceId)
  const fps = sequence ? videoEditFps(sequence.frameRate) : 1
  const aligned = Boolean(sequence) && results.every(result => {
    const clip = sequence!.clips.find(value => `${projectId}:${value.id}` === result.clipRef.id)
    return clip && Math.abs(clip.start / fps + result.anchorSeconds - clip.sourceInUs / 1e6 - result.targetSeconds) <= ALIGN_TOLERANCE_SECONDS
  })
  logger.info('音效卡点完成', { event: 'video_edit.sound_effects.completed', context: { projectId, sequenceId, placements: results.length, saved, aligned } })
  return {
    resultRefs: results.map(result => result.clipRef), documentRef: input.documentRef, placements: results,
    message: `已放入 ${results.length} 个音效，击中点对齐到目标时刻，可一步撤销。`,
    verification: { verified: saved && aligned, condition: saved && aligned ? '已保存并按保存后的片段起点与源入点回算，每个音效的对齐点都落在目标时刻（误差不超过 10 微秒）。' : '保存回读或对齐核对未通过，请读回片段检查。' },
  }
}
