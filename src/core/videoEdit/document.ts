import { z } from 'zod'

const frame = z.number().int().min(0).max(108_000)
const identifier = z.string().min(1).max(100)
export const videoEditMediaSchema = z.object({
  id: identifier, name: z.string().min(1).max(200), path: z.string().min(1).max(32768).regex(/^(?:[A-Za-z]:[\\/]|\\\\|\/)/, '素材必须引用本地绝对路径。'),
  kind: z.enum(['video', 'audio', 'image']), durationSeconds: z.number().finite().nonnegative(),
  width: z.number().int().nonnegative(), height: z.number().int().nonnegative(),
}).strict()
export const videoEditClipSchema = z.object({
  id: identifier, mediaId: identifier.optional(), name: z.string().min(1).max(200),
  kind: z.enum(['video', 'audio', 'image', 'text']), track: z.number().int().min(0).max(7),
  start: frame, duration: frame.min(1), sourceInUs: z.number().int().nonnegative(),
  x: z.number().finite().min(-2).max(2), y: z.number().finite().min(-2).max(2),
  scale: z.number().min(0.01).max(4), rotation: z.number().min(-360).max(360),
  opacity: z.number().min(0).max(1), volume: z.number().min(0).max(2),
  brightness: z.number().min(0).max(2), text: z.string().max(2000),
}).strict()
export const videoEditAnnotationSchema = z.object({
  id: identifier, clipId: identifier, frame, space: z.literal('composition-normalized'),
  kind: z.enum(['point', 'region']), x: z.number().min(0).max(1), y: z.number().min(0).max(1),
  width: z.number().min(0).max(1), height: z.number().min(0).max(1), text: z.string().max(2000),
}).strict()
export const videoEditDocumentSchema = z.object({
  format: z.literal('henji-video-project'), version: z.literal(1), id: identifier,
  name: z.string().trim().min(1).max(200), revision: z.number().int().nonnegative(),
  width: z.number().int().min(16).max(3840), height: z.number().int().min(16).max(2160),
  fps: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]),
  media: z.array(videoEditMediaSchema).max(200), clips: z.array(videoEditClipSchema).max(500),
  annotations: z.array(videoEditAnnotationSchema).max(500),
}).strict().superRefine((document, ctx) => {
  for (const items of [document.media, document.clips, document.annotations]) {
    if (new Set(items.map(item => item.id)).size !== items.length) ctx.addIssue({ code: 'custom', message: '工程包含重复标识。' })
  }
  for (const clip of document.clips) {
    const media = document.media.find(item => item.id === clip.mediaId)
    if (clip.kind !== 'text' && (!media || media.kind !== clip.kind)) ctx.addIssue({ code: 'custom', message: `片段 ${clip.name} 的素材引用无效。` })
    if (clip.start + clip.duration > document.fps * 1800) ctx.addIssue({ code: 'custom', message: '首版工程最长为 30 分钟。' })
    if (media && media.kind !== 'image' && clip.sourceInUs / 1e6 + clip.duration / document.fps > media.durationSeconds + 1 / document.fps) ctx.addIssue({ code: 'custom', message: `片段 ${clip.name} 超出源素材范围。` })
  }
  for (const annotation of document.annotations) if (!document.clips.some(clip => clip.id === annotation.clipId)) ctx.addIssue({ code: 'custom', message: '标注的片段不存在。' })
})
export type VideoEditDocument = z.infer<typeof videoEditDocumentSchema>
export type VideoEditClip = z.infer<typeof videoEditClipSchema>
export type VideoEditMedia = z.infer<typeof videoEditMediaSchema>
export type VideoEditAnnotation = z.infer<typeof videoEditAnnotationSchema>

export function createVideoEditDocument(name: string): VideoEditDocument {
  return { format: 'henji-video-project', version: 1, id: crypto.randomUUID(), name, revision: 0, width: 1920, height: 1080, fps: 30, media: [], clips: [], annotations: [] }
}
export function videoEditDuration(document: VideoEditDocument): number {
  return Math.max(1, ...document.clips.map(clip => clip.start + clip.duration))
}
export function clipSourceSeconds(clip: VideoEditClip, timelineFrame: number, fps: number): number {
  return clip.sourceInUs / 1e6 + (timelineFrame - clip.start) / fps
}
export function activeVideoEditClips(document: VideoEditDocument, at: number): VideoEditClip[] {
  return document.clips.filter(clip => at >= clip.start && at < clip.start + clip.duration).sort((a, b) => a.track - b.track)
}
export function splitVideoEditClip(document: VideoEditDocument, id: string, at: number): VideoEditDocument {
  const clip = document.clips.find(item => item.id === id)
  if (!clip || !Number.isInteger(at) || at <= clip.start || at >= clip.start + clip.duration) throw new Error('请将播放头置于片段内部再拆分。')
  const left = at - clip.start
  const right = { ...clip, id: crypto.randomUUID(), start: at, duration: clip.duration - left, sourceInUs: clip.sourceInUs + Math.round(left * 1e6 / document.fps) }
  return { ...document, clips: document.clips.flatMap(item => item.id === id ? [{ ...clip, duration: left }, right] : [item]), annotations: document.annotations.map(item => item.clipId === id && item.frame >= at ? { ...item, clipId: right.id } : item) }
}
export function snapVideoEditFrame(document: VideoEditDocument, value: number, excludedId: string, threshold: number): number {
  const candidates = [0, ...document.clips.filter(clip => clip.id !== excludedId).flatMap(clip => [clip.start, clip.start + clip.duration])]
  const nearest = candidates.sort((a, b) => Math.abs(a - value) - Math.abs(b - value))[0]
  return Math.max(0, Math.round(Math.abs(nearest - value) <= threshold ? nearest : value))
}
