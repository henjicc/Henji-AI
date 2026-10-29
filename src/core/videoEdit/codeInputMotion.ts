import { isCodeImageReference } from './codeMaterial/contract'
import { codeMediaInputComposition, codeMediaInputSample } from './codeMediaInput'
import { videoEditCodeInputParameters, type VideoEditCodeDeclarationReader } from './codeInputParameters'
import type { VideoEditComposition } from './document'
import { VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET } from './motionStructure'
import type { VideoEditPixelMotionPlacement } from './pixelMotionReview'
import { VideoEditSourceMapIndex, videoEditSourceMapLocalFrame, videoEditSourceMapSampleSeconds, visitVideoEditPictureInstances, type VideoEditSourceMapEntry, type VideoEditSourceMapRange } from './sourceMap'

/** Match the renderer's prepared input parameters, not a claim that author code
 * draws them or that a raw source survives the lower composition/effects.
 * `declarations`：片子数据派生的取帧参数要按代码声明解析，读不到声明的片段只看片段上存的参数。 */
export function videoEditCodeInputMotionPlacements(root: VideoEditComposition, range: VideoEditSourceMapRange, declarations?: VideoEditCodeDeclarationReader): VideoEditPixelMotionPlacement[] {
  const result: VideoEditPixelMotionPlacement[] = []
  let frames = 0, work = 0
  const append = (owner: VideoEditSourceMapEntry, source: VideoEditSourceMapEntry | undefined, parameter: string, kind: 'video' | 'sequence', mediaId: string, times: number[], from: number, duration: number): void => {
    if (!times.length) return
    frames += times.length
    if (frames > VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET) throw new Error('代码画面输入超过60000帧实例预算，请缩小 from/to；未截断证据。')
    const first = times[0], last = times.at(-1)!, low = Math.min(first, last), high = Math.max(first, last)
    result.push({ entry: { ...owner, id: `${owner.id}:input:${JSON.stringify([parameter, source?.id, mediaId, from])}`, kind: 'video', mediaId, sourceKind: 'media', mediaDuration: duration,
      timeline: { from, to: from + times.length }, source: { fromUs: low * 1e6, toUs: Math.min(duration, high + 1 / 15) * 1e6, direction: first === last ? 'static' : first < last ? 'forward' : 'reverse', basis: 'sampled_envelope' } },
      sourceTimes: times, input: { parameter, kind, mediaId } })
  }
  const charge = (): void => { if (++work > 200000) throw new Error('代码画面输入映射超过200000次访问预算，请缩小 from/to；未截断证据。') }
  visitVideoEditPictureInstances(root, range, { sequence() {}, clip(local, owner) {
    const clip = owner.path.at(-1)!.clip
    if (clip.kind !== 'code' || !clip.code) return
    for (const [parameter, reference] of Object.entries(videoEditCodeInputParameters(local, clip.code, declarations))) {
      // 网页画面不来自工程素材，没有源素材运动可映射。
      if (!isCodeImageReference(reference) || reference.kind === 'image' || reference.kind === 'web') continue
      if (reference.kind === 'video') {
        const media = local.media.find(media => media.id === reference.mediaId && media.kind === 'video')
        if (!media || !local.items.some(item => item.mediaId === media.id)) throw new Error('视频图片参数引用的素材不存在。')
        // 带时间表的参数只记参与的帧，每一段单独成一条（段内取帧时刻单调：正常、快放或停住），段间空档与跳过不连成一条。
        let times: number[] = [], from = owner.timeline.from, run: unknown
        const flush = (): void => { append(owner, undefined, parameter, 'video', media.id, times, from, media.durationSeconds); times = [] }
        for (let frame = owner.timeline.from; frame < owner.timeline.to; frame++) {
          charge()
          const sample = codeMediaInputSample(clip, reference, videoEditSourceMapLocalFrame(owner, frame), local.frameRate)
          if (!sample) { flush(); continue }
          if (times.length && sample.span !== run) flush()
          if (!times.length) from = frame
          run = sample.span
          if (sample.seconds < 0 || sample.seconds >= media.durationSeconds) throw new Error('视频图片参数的取帧时间超出素材范围。')
          times.push(sample.seconds)
        }
        flush()
      } else {
        const below = codeMediaInputComposition(local, clip, reference, 0)!.document
        const a = videoEditSourceMapLocalFrame(owner, owner.timeline.from), b = videoEditSourceMapLocalFrame(owner, owner.timeline.to - 1)
        const entries = new VideoEditSourceMapIndex().query(below, { from: Math.max(0, Math.min(a, b)), to: Math.max(a, b) + 1 }, ['video'])
        for (const entry of entries) {
          const media = local.media.find(media => media.id === entry.mediaId && media.kind === 'video')
          if (!media) continue
          let times: number[] = [], from = owner.timeline.from
          const flush = (): void => { append(owner, entry, parameter, 'sequence', media.id, times, from, media.durationSeconds); times = [] }
          for (let frame = owner.timeline.from; frame < owner.timeline.to; frame++) {
            charge()
            const localFrame = videoEditSourceMapLocalFrame(owner, frame)
            if (localFrame < entry.timeline.from || localFrame >= entry.timeline.to) { flush(); from = frame + 1; continue }
            if (!times.length) from = frame
            times.push(videoEditSourceMapSampleSeconds(entry, localFrame))
          }
          flush()
        }
      }
    }
  } })
  return result
}
