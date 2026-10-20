import { createVideoEditDocument, createVideoEditSequence, videoEditComposition, type VideoEditClip } from '@/core/videoEdit/document'
import { addressCodeMaterialFiles } from '@/core/videoEdit/codeMaterial/sources'
import { isUiInspectionActive } from '@/platform/runtime'
import { VideoEditRenderer } from './videoEditRenderer'
import { videoEditPreparationSnapshot } from './videoEditPreparationTiming'

/** Fixed four-input workload, only callable by the formal Electron inspection.
 * The scene supplies its own generated video; no project or user data is used. */
export async function runVideoEditCodeInputProbe(host: HTMLElement, path: string, source: string): Promise<Record<string, unknown>> {
  if (!isUiInspectionActive()) throw new Error('视频输入测量仅由正式桌面验收运行。')
  const model = createVideoEditDocument('代码视频输入测量'), sequence = createVideoEditSequence('输入')
  model.sequences.push(sequence)
  sequence.width = 640; sequence.height = 360; sequence.frameRate = { numerator: 60, denominator: 1 }
  sequence.tracks = [1, 2].map(index => ({ id: `v${index}`, name: `视频${index}`, kind: 'video', index, locked: false, enabled: true, muted: true, solo: false }))
  model.media = [{ id: 'video', name: '测试视频', path, kind: 'video', width: 360, height: 640, durationSeconds: 2, hasAudio: false, frameRate: { numerator: 60, denominator: 1 } }]
  const { codeSources: _sources, ...manifest } = await addressCodeMaterialFiles(source)
  void _sources
  model.codeMaterials = [{ id: 'code', name: '四路输入', defaultVersionId: 'v', versions: [{ id: 'v', apiVersion: 4, languageVersion: 4, ...manifest }] }]
  const code = { definitionId: 'code', versionId: 'v', parameters: { a: { kind: 'video' as const, mediaId: 'video' }, b: { kind: 'video' as const, mediaId: 'video' }, c: { kind: 'sequence' as const, mediaId: 'below' as const }, d: { kind: 'sequence' as const, mediaId: 'below' as const } } }
  model.items = [{ id: 'video-item', name: '原片', kind: 'video', mediaId: 'video' }, { id: 'code-item', name: '四路输入', kind: 'code', code }]
  const base: VideoEditClip = { id: 'base', itemId: 'video-item', name: '原片', kind: 'video', start: 0, duration: 120, track: 1, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 0, text: '' }
  sequence.clips = [base, { ...base, id: 'code', itemId: 'code-item', kind: 'code', track: 2, code }]
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360; canvas.style.cssText = 'width:100%;max-height:65vh;object-fit:contain'; host.replaceChildren(canvas)
  const renderer = new VideoEditRenderer(videoEditComposition(model, sequence.id), undefined, canvas.transferControlToOffscreen())
  const phases: Record<string, unknown> = {}
  const evidence: Record<string, unknown> = { completed: false, phases }
  const render = async (frame: number, sequential = false): Promise<void> => { const result = await renderer.render(frame, sequential, false, () => true, undefined, undefined, sequential ? 'final' : 'interactive'); await result.completion; if (!result.presented) throw new Error('输入测量帧没有提交') }
  const measure = async (name: string, frames: number[], sequential = false): Promise<void> => {
    const before = videoEditPreparationSnapshot(), started = performance.now()
    for (const frame of frames) await render(frame, sequential)
    const elapsedMs = performance.now() - started, after = videoEditPreparationSnapshot()
    phases[name] = { frames: frames.length, elapsedMs, perFrameMs: elapsedMs / frames.length, stages: Object.fromEntries(Object.entries(after).map(([stage, value]) => [stage, { count: value.count - (before[stage]?.count ?? 0), ms: value.ms - (before[stage]?.ms ?? 0) }])) }
  }
  try {
    await measure('cold', [0]); await measure('pausedFrames', Array.from({ length: 12 }, (_, i) => i + 1))
    await measure('seek', [60, 0, 60]); await measure('exportRender', [60, 61, 62, 63, 64, 65], true)
    let captured: Promise<ImageBitmap> | undefined
    const result = await renderer.render(60, false, false, () => true, undefined, undefined, 'interactive', pixels => { captured = pixels })
    await result.completion
    if (!captured) throw new Error('输入测量没有返回像素')
    const bitmap = await captured, sample = new OffscreenCanvas(640, 360), ctx = sample.getContext('2d', { willReadFrequently: true })!
    try { ctx.drawImage(bitmap, 0, 0) } finally { bitmap.close() }
    const pixels = [80, 240, 400, 560].map(x => [...ctx.getImageData(x, 180, 1, 1).data])
    if (pixels.some(rgba => rgba[0] < 245 || rgba[1] < 245 || rgba[2] > 8)) throw new Error(`四路视频输入应显示同一黄色帧：${JSON.stringify(pixels)}`)
    const letterbox = [...ctx.getImageData(330, 180, 1, 1).data]
    if (letterbox.some((value, index) => Math.abs(value - [0, 0, 0, 255][index]) > 3)) throw new Error(`输入留白须保持原画布黑底：${JSON.stringify(letterbox)}`)
    const inspection = document.createElement('canvas'); inspection.width = 640; inspection.height = 360; inspection.style.cssText = canvas.style.cssText
    inspection.getContext('2d')!.drawImage(sample, 0, 0); host.replaceChildren(inspection)
    Object.assign(evidence, { completed: true, pixels, letterbox, diagnostics: renderer.codeDiagnostics() })
  } finally {
    await renderer.dispose()
    evidence.disposed = renderer.codeDiagnostics()
  }
  const disposed = renderer.codeDiagnostics()
  if (disposed.codeInputSessions || disposed.gpu?.residentBytes || disposed.gpu?.surfaces || disposed.images?.textures) throw new Error('视频输入测量结束后仍有驻留资源')
  return evidence
}
