import { videoEditClipPictureSize, videoEditClipToFrame, type VideoEditSize } from './clipGeometry'
import type { VideoEditClip, VideoEditComposition } from './document'
import { evaluateVideoEditClip } from './keyframes'
import { VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET, type VideoEditMotionStructureFact } from './motionStructure'
import { videoEditNestedCaptionSourceId } from './nestedCaptions'
import { videoEditRootMapper, videoEditSafeAreaFacts, videoEditSampleSegments, type VideoEditPictureSample, type VideoEditPicturePoint, type VideoEditSafeSegment } from './pictureReview'
import { projectVideoEditSequenceMapRange, videoEditSourceMapLocalFrame, visitVideoEditPictureInstances, type VideoEditSourceMapRange, type VideoEditSourceMapStep } from './sourceMap'
import { layoutVideoEditText, videoEditTextWidth } from './text'
import { videoEditCaptionClips, videoEditCaptionTextClip } from './timedContent'

export type VideoEditTextMeasure = (text: string, font: string) => number
const MOTION_KEYS = ['x', 'y', 'scale', 'rotation', 'anchorX', 'anchorY', 'opacity'] as const
const animated = (clip: VideoEditClip): boolean => MOTION_KEYS.some(key => clip.curves?.[key]?.length)

/** Measured ink box of the laid-out lines in picture pixels (alignment and background padding included). */
export function videoEditTextInkBox(clip: Pick<VideoEditClip, 'text' | 'textStyle'>, picture: VideoEditSize, measure: VideoEditTextMeasure): { left: number; top: number; width: number; height: number } | undefined {
  if (!clip.text.trim()) return undefined
  const layout = layoutVideoEditText(clip, picture, measure)
  if (!layout.lines.length) return undefined
  let left = Infinity, right = -Infinity
  for (const line of layout.lines) {
    const width = layout.style.align.startsWith('justify') ? layout.width : videoEditTextWidth(line, layout.style, measure)
    const offset = layout.style.align.includes('center') ? (layout.width - width) / 2 : layout.style.align.includes('right') ? layout.width - width : 0
    left = Math.min(left, layout.left + offset); right = Math.max(right, layout.left + offset + width)
  }
  const pad = layout.style.background.enabled ? layout.style.background.padding : 0
  return { left: left - pad, top: layout.contentTop - pad, width: right - left + 2 * pad, height: layout.lines.length * layout.lineHeight + 2 * pad }
}

function quadOf(root: VideoEditComposition, wrappers: readonly VideoEditSourceMapStep[], rootFrame: number, clip: VideoEditClip, picture: VideoEditSize, frame: VideoEditSize, box: NonNullable<ReturnType<typeof videoEditTextInkBox>>): VideoEditPicturePoint[] {
  const toRoot = videoEditRootMapper(root, wrappers, rootFrame)
  return [[box.left, box.top], [box.left + box.width, box.top], [box.left + box.width, box.top + box.height], [box.left, box.top + box.height]].map(([x, y]) => {
    const point = toRoot(videoEditClipToFrame(clip, picture, frame, x / picture.width, y / picture.height))
    return { x: point.x * root.width, y: point.y * root.height }
  })
}

/**
 * Title-safe check of native text clips and captions with the production text layout, mapped through nested
 * placements into the queried sequence. Text inside graphic clips is not measured here.
 */
export function collectVideoEditTextSafety(root: VideoEditComposition, range: VideoEditSourceMapRange, measure: VideoEditTextMeasure): VideoEditMotionStructureFact[] {
  const records: VideoEditMotionStructureFact[] = []
  let sampled = 0
  visitVideoEditPictureInstances(root, range, {
    sequence(instance) {
      const local = instance.composition
      for (const caption of local.captions ?? []) {
        const timeline = projectVideoEditSequenceMapRange(instance, { from: caption.start, to: caption.start + caption.duration })
        const rendered = timeline && videoEditCaptionClips(local, caption.start).find(clip => clip.id === `caption:${caption.id}`)
        if (!timeline || !rendered || timeline.to <= timeline.from) continue
        const clip = videoEditCaptionTextClip(rendered, local), box = videoEditTextInkBox(clip, local, measure)
        if (!box) continue
        const segment: VideoEditSafeSegment = { from: timeline.from, to: timeline.to, quad: quadOf(root, instance.path, timeline.from, clip, local, local, box), opacity: 1, atRest: true }
        records.push(...videoEditSafeAreaFacts([segment], root, root.fps, { sequenceId: local.id, path: instance.path, subjectId: videoEditNestedCaptionSourceId(caption), subjectType: 'video_edit.caption', basis: 'text_layout', label: caption.text }, 'text', '字幕'))
      }
    },
    clip(local, entry) {
      const step = entry.path.at(-1)!, wrappers = entry.path.slice(0, -1)
      if (step.clip.kind !== 'text') return
      const picture = videoEditClipPictureSize(local, step.clip), box = videoEditTextInkBox(step.clip, picture, measure)
      if (!box) return
      const base = { sequenceId: local.id, path: entry.path, subjectId: step.clipId, basis: 'text_layout' as const, label: step.clip.name || step.clip.text }
      if (![step.clip, ...wrappers.map(wrapper => wrapper.clip)].some(animated)) {
        const segment: VideoEditSafeSegment = { from: entry.timeline.from, to: entry.timeline.to, quad: quadOf(root, wrappers, entry.timeline.from, step.clip, picture, local, box), opacity: step.clip.opacity, atRest: true }
        records.push(...videoEditSafeAreaFacts([segment], root, root.fps, base, 'text'))
        return
      }
      sampled += entry.timeline.to - entry.timeline.from
      if (sampled > VIDEO_EDIT_MOTION_STRUCTURE_SAMPLE_BUDGET) throw new Error('文字安全框检查超过单次60000帧实例预算，请缩小 from/to；未截断证据。')
      const samples: VideoEditPictureSample[] = []
      for (let frame = entry.timeline.from; frame < entry.timeline.to; frame++) {
        const placement = evaluateVideoEditClip(step.clip, videoEditSourceMapLocalFrame(entry, frame))
        samples.push({ frame, quad: quadOf(root, wrappers, frame, placement, picture, local, box), opacity: placement.opacity })
      }
      records.push(...videoEditSafeAreaFacts(videoEditSampleSegments(samples, root.width, root.fps), root, root.fps, base, 'text'))
    },
  })
  return records
}
