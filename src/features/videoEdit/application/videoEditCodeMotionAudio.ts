import type { AudioContentAnalysis } from '@/core/audioAnalysis/contentAnalysis'
import { videoEditAudioContent } from '@/core/videoEdit/audioContent'
import { codeAudioComposition, codeAudioReferenceMediaId, codeMotionAudioKey, type CodeAudioComposition } from '@/core/videoEdit/codeAudio'
import { prepareCodeMaterialParameters } from '@/core/videoEdit/codeMaterialAnimation'
import { codeMaterialUsesAudio } from '@/core/videoEdit/codeMaterialResources'
import type { CodeAuthorProgram as CodeMaterialProgram } from '@/core/videoEdit/codeAuthorProgram'
import type { VideoEditComposition, VideoEditMedia } from '@/core/videoEdit/document'
import { VideoEditSourceMapIndex, visitVideoEditPictureInstances, type VideoEditSourceMapRange } from '@/core/videoEdit/sourceMap'
import { VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET } from '@/core/videoEdit/motionStructure'
import { VideoEditContentAudio } from '../engine/videoEditContentAudio'
import { VideoEditRenderSession } from '../engine/videoEditRenderSession'
import { beginVideoEditContentQuery } from './videoEditContentQueryProgress'
import { pinVideoEditMotionSources, verifyVideoEditMotionSources } from './videoEditPixelMotion'
import type { VideoEditInstance } from './videoEditService'

interface Plan { source: CodeAudioComposition; keys: string[]; itemId: string }
const caches = new WeakMap<VideoEditInstance, VideoEditContentAudio>()
/** Reuse the rendering producer and finished-result cache, never fake audio with
 * zeros. Audio references are non-animatable; numeric author curves remain per-frame. */
export async function readVideoEditCodeMotionAudio(owner: VideoEditInstance, composition: VideoEditComposition, range: VideoEditSourceMapRange, programs: Readonly<Record<string, CodeMaterialProgram>>, signal: AbortSignal, assertCurrent: () => void): Promise<{ audios: Record<string, AudioContentAnalysis>; sources: VideoEditMedia[] }> {
  signal.throwIfAborted(); assertCurrent()
  const plans = new Map<string, Plan>(), instances = new Set<string>()
  let frames = 0
  visitVideoEditPictureInstances(composition, range, { sequence() {}, clip(local, entry) {
    const clip = entry.path.at(-1)!.clip, program = clip.code && programs[clip.code.versionId]
    if (clip.kind !== 'code' || !clip.code || !program || program.languageVersion !== 4 || !codeMaterialUsesAudio(program)) return
    frames += entry.timeline.to - entry.timeline.from
    if (frames > VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET) throw new Error('声音驱动运动审查超过60000帧实例预算，请缩小 from/to。')
    const key = codeMotionAudioKey(local.id, clip.id)
    if (instances.has(key)) return
    instances.add(key)
    const values = prepareCodeMaterialParameters(program, clip.code).values
    const source = codeAudioComposition(local, clip, codeAudioReferenceMediaId(values)), sound = JSON.stringify([source.start, source.duration, videoEditAudioContent(source.document)])
    const previous = plans.get(sound)
    if (previous) previous.keys.push(key)
    else plans.set(sound, { source, keys: [key], itemId: clip.itemId })
  } })
  if (plans.size > 32 || [...plans.values()].reduce((seconds, plan) => seconds + plan.source.duration, 0) > 300) throw new Error('声音驱动审查单次最多32组、300秒完整声音上下文；请缩短代码片段或选择较短声音素材，不截断节拍上下文。')
  const audios: Record<string, AudioContentAnalysis> = {}, sources = new Map<string, VideoEditMedia>()
  if (!plans.size) return { audios, sources: [] }
  let cache = caches.get(owner)
  if (!cache) {
    cache = new VideoEditContentAudio(document => {
      const renderer = new VideoEditRenderSession(document, 1)
      return { async mixAudio(start, duration) { const audio = await renderer.mixAudio(start, duration); return Array.from({ length: audio.numberOfChannels }, (_, channel) => audio.getChannelData(channel).slice()) }, dispose: () => renderer.dispose() }
    })
    caches.set(owner, cache)
  }
  for (const { source, keys, itemId } of plans.values()) {
    assertCurrent()
    const entries = new VideoEditSourceMapIndex().query(source.document, { from: Math.floor(source.start * source.document.fps), to: Math.max(1, Math.ceil((source.start + source.duration) * source.document.fps)) }, ['audio'])
    const ids = new Set(entries.map(entry => entry.mediaId))
    const task = beginVideoEditContentQuery(owner, itemId, signal)
    try {
      const pinned = await pinVideoEditMotionSources(source.document.media.filter(media => ids.has(media.id)), task.signal, assertCurrent)
      for (const media of pinned) {
        const previous = sources.get(media.id)
        if (previous && JSON.stringify(previous.assetContent) !== JSON.stringify(media.assetContent)) throw new Error(`素材“${media.name}”在声音审查期间已改变，请重新查询。`)
      }
      const byId = new Map(pinned.map(media => [media.id, media]))
      const document = { ...source.document, media: source.document.media.map(media => byId.get(media.id) ?? media) }
      task.report({ phase: 'analyzing_audio', message: '分析动画使用的声音' })
      const audio = await cache.analyze(document, source.start, source.duration, task.signal, value => task.report({ phase: 'analyzing_audio', message: '分析动画使用的声音', phaseProgress: value }))
      task.signal.throwIfAborted(); assertCurrent()
      await verifyVideoEditMotionSources(pinned, task.signal, assertCurrent)
      for (const key of keys) audios[key] = audio
      for (const media of pinned) sources.set(media.id, media)
      task.finish('completed')
    } catch (error) { task.finish('failed', error); throw error }
  }
  await verifyVideoEditMotionSources([...sources.values()], signal, assertCurrent)
  return { audios, sources: [...sources.values()] }
}
