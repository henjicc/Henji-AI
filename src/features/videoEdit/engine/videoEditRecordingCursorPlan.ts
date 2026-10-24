import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import { videoEditClipToFrame, videoEditClipPixelScaleY } from '@/core/videoEdit/clipGeometry'
import { cursorShapes } from '@/core/captureLog/events'
import type { RecordingCursorFrame, RecordingCursorSource } from '@/core/videoEdit/recordingCursor'
import type { VideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinPlan } from './videoEditBuiltinEffectPasses'

export interface RecordingCursorDraw { point: [number, number]; size: number; shape: number; rotation: number; opacity: number; style: number; button: number }
/** Transient render data, never persisted or exposed as editable GPU parameters. Coordinates are normalized. */
export interface RecordingCursorRenderInput { cursorDraws?: RecordingCursorDraw[] }
export function recordingCursorDraws(sample: RecordingCursorFrame, source: RecordingCursorSource, clip: VideoEditClip, document: Pick<VideoEditComposition, 'width' | 'height'>, params: VideoEditBuiltinParams): RecordingCursorDraw[] {
  const result: RecordingCursorDraw[] = []
  const size = source.height * Number(params.size) / 100 * videoEditClipPixelScaleY(clip, source, document) / document.height
  const point = (p: [number, number]): [number, number] => { const v = videoEditClipToFrame(clip, source, document, p[0] / source.width, p[1] / source.height); return [v.x, v.y] }
  if (params.click_style !== 'none') for (const click of sample.clicks) {
    result.push({ point: point(click.point), size: size * (params.click_style === 'ripple' ? 0.3 + click.progress : 0.7), shape: -1, rotation: 0, opacity: (1 - click.progress) * 0.85, style: params.click_style === 'ripple' ? 0 : 1, button: params.distinguish_buttons ? click.button === 'right' ? 1 : click.button === 'middle' ? 2 : 0 : 0 })
  }
  if (sample.cursor) result.push({ point: point(sample.cursor.point), size, shape: cursorShapes.indexOf(sample.cursor.shape), rotation: clip.rotation * Math.PI / 180, opacity: sample.cursor.opacity, style: params.style === 'dark' ? 1 : 0, button: 0 })
  return result
}
export function planRecordingCursor(draws: readonly RecordingCursorDraw[], width: number, height: number): VideoEditBuiltinPlan {
  if (!draws.length) return { width, height, scratch: [], passes: [{ entry: 'copy', source: 'input', target: 'output', uniforms: new Float32Array([width, height, width, height, ...Array(12).fill(0)]) }] }
  return { width, height, scratch: draws.length > 1 ? [{ width, height }, { width, height }] : [], passes: draws.map((draw, index) => ({
    entry: draw.shape < 0 ? 'recording_click' : 'recording_cursor', source: index === 0 ? 'input' : (index - 1) % 2, target: index === draws.length - 1 ? 'output' : index % 2,
    uniforms: new Float32Array([width, height, width, height, draw.point[0] * width, draw.point[1] * height, draw.size * height, draw.shape, Math.cos(draw.rotation), Math.sin(draw.rotation), draw.style, draw.opacity, draw.button, 0, 0, 0]),
  })) }
}
