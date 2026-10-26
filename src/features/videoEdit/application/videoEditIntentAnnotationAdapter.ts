import { z } from 'zod'
import { intentAnnotationSchema, type IntentAnnotation } from '@/core/creativeIntent/annotationConstraints'
import type { ReferenceTransformTrack } from '@/core/creativeIntent/referenceTransforms'
import { videoEditClipSchema, type VideoEditClip, type VideoEditComposition } from '@/core/videoEdit/document'
import type { VideoEditAnnotation } from '@/core/videoEdit/annotations'
import { videoEditClipPictureSize } from '@/core/videoEdit/clipGeometry'

export const videoMotionConstraintOptionsSchema = z.object({
  kind: z.literal('video-motion-constraints'), version: z.literal(1),
  annotations: z.array(z.object({ id: z.string(), role: z.enum(['path', 'target', 'dwell', 'text']), span: z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]) }).strict()),
  reference: z.object({ clip: videoEditClipSchema, mode: z.enum(['local', 'composition']), picture: z.object({ width: z.number().positive(), height: z.number().positive() }).strict(), width: z.number().positive(), height: z.number().positive() }).strict().optional(),
}).strict()
export type VideoMotionConstraintOptions = z.infer<typeof videoMotionConstraintOptionsSchema>

/** Read-only projection. Never changes authors, discussion history, artwork, or review state. */
export function readVideoIntentAnnotation(projectId: string, sequence: VideoEditComposition, annotation: VideoEditAnnotation, targetId: string, role: VideoMotionConstraintOptions['annotations'][number]['role'], span?: [number, number]): IntentAnnotation {
  if (annotation.status === 'resolved') throw new Error('该标注已确认，请重开后使用')
  if (annotation.clipId && annotation.clipId !== targetId) throw new Error('标注属于另一个片段，请选择对应目标')
  const clip = sequence.clips.find(c => c.id === targetId)
  const range = span ?? [annotation.frame, annotation.endFrame ?? annotation.frame]
  if (!clip || range[0] < clip.start || range[1] >= clip.start + clip.duration) throw new Error('标注动作超出片段区间，请调整开始和结束时间')
  const target = annotation.target
  let geometry: IntentAnnotation['geometry']
  if (role === 'text') geometry = { kind: 'text', at: target.kind === 'point' || target.kind === 'marker' || target.kind === 'text' ? [target.x, target.y] : [.5, .5] }
  else if (role === 'path' && target.kind === 'arrow') geometry = { kind: 'path', points: [[target.from.x, target.from.y], [target.to.x, target.to.y]] }
  else if (role === 'path') {
    if (target.kind !== 'stroke' || target.strokes[0].length < 2) throw new Error('请用箭头或笔画标出从起点到终点的方向')
    // The first stroke is the explicitly chosen shaft. Later strokes can be arrowheads.
    geometry = { kind: 'path', points: target.strokes[0].map(p => [p.x, p.y]) }
  } else {
    if (target.kind === 'ellipse') {
      // 椭圆按 32 段多边形投影，包含判断与手画闭合圈走同一条路径。
      const cx = target.x + target.width / 2; const cy = target.y + target.height / 2
      geometry = { kind: 'region', role, outline: Array.from({ length: 32 }, (_, index): [number, number] => [cx + Math.cos(index / 16 * Math.PI) * target.width / 2, cy + Math.sin(index / 16 * Math.PI) * target.height / 2]) }
    } else if (target.kind === 'region') geometry = { kind: 'region', role, outline: [[target.x, target.y], [target.x + target.width, target.y], [target.x + target.width, target.y + target.height], [target.x, target.y + target.height]] }
    else if (target.kind === 'stroke' && target.strokes.length === 1 && target.strokes[0].length >= 3) {
      const points = target.strokes[0]; const first = points[0]; const last = points.at(-1)!
      if (Math.hypot(first.x - last.x, first.y - last.y) > .02) throw new Error('停留区域需要闭合的圈，请补齐圈线')
      geometry = { kind: 'region', role, outline: points.map(p => [p.x, p.y]) }
    } else throw new Error('请先圈定区域，再选择目标或停留')
  }
  const sourceIdentity = JSON.stringify({ id: annotation.id, clipId: annotation.clipId, frame: annotation.frame, endFrame: annotation.endFrame, target, text: annotation.text, author: annotation.author, createdAt: annotation.createdAt })
  return intentAnnotationSchema.parse({ sourceRef: { kind: 'video_edit.annotation', id: `${projectId}:${annotation.id}` }, sourceIdentity, geometryIdentity: JSON.stringify([sequence.id, sequence.width, sequence.height, sequence.pixelAspectRatio]), targetRefs: [{ kind: 'video_edit.clip', id: `${projectId}:${targetId}` }], span: span ?? [annotation.frame, annotation.endFrame ?? annotation.frame], text: annotation.text, geometry })
}

export function captureVideoMotionReference(sequence: VideoEditComposition, clip: VideoEditClip, mode: 'local' | 'composition'): NonNullable<VideoMotionConstraintOptions['reference']> {
  if (clip.follow || clip.kind === 'audio' || clip.kind === 'adjustment' || clip.disabledIntrinsicSections?.includes('motion')) throw new Error('请选择启用运动且没有其他跟随绑定的画面片段作为参照')
  return { clip: structuredClone(clip), mode, picture: videoEditClipPictureSize(sequence, clip), width: sequence.width, height: sequence.height }
}

/** Send compact native channels to the Worker; duration never expands a renderer-side frame array. */
export function sampleVideoMotionReference(projectId: string, reference: NonNullable<VideoMotionConstraintOptions['reference']>, ranges: readonly [number, number][]): ReferenceTransformTrack {
  const { clip, picture, width, height } = reference
  for (const [start, end] of ranges) {
    if (start < clip.start || end >= clip.start + clip.duration) throw new Error('参照片段未覆盖整段示范，请延长参照或缩短示范')
  }
  return { ref: { kind: 'video_edit.clip', id: `${projectId}:${clip.id}` }, identity: JSON.stringify(reference), native: {
    start: clip.start, end: clip.start + clip.duration - 1, base: { x: clip.x, y: clip.y, scale: clip.scale, rotation: clip.rotation, anchorX: clip.anchorX ?? .5, anchorY: clip.anchorY ?? .5 },
    curves: clip.curves, pictureSize: [picture.width, picture.height], compositionSize: [width, height],
  } }
}
