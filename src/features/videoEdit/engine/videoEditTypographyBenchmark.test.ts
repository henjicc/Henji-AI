import { afterEach, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { createVideoEditGraphic } from '@/core/videoEdit/graphics'
import { videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { VideoEditCodeSources } from './videoEditCodeSources'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'

afterEach(() => { vi.unstubAllGlobals() })
it('4K180帧动画基准：统计真实求值/栅格调用/上传工作量（Node替身不代表GPU耗时）', async () => {
  let paints = 0; let pixels = 0; let uploads = 0
  class Bitmap { width = 3840; height = 2160; close() {} }
  vi.stubGlobal('ImageBitmap', Bitmap)
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) { pixels += width * height }
    getContext() { return { save() {}, restore() {}, scale() {}, translate() {}, rotate() {}, transform() {}, beginPath() {}, roundRect() {}, ellipse() {}, fill() {}, fillRect() {}, clearRect() {}, drawImage() {}, strokeText() {}, fillText() { paints++ }, measureText(text: string) { return { width: text.length * 72 } } } }
    transferToImageBitmap() { return new Bitmap() }
  })
  const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }
  const device = { queue: { writeBuffer() {}, submit() {}, onSubmittedWorkDone: async () => {}, copyExternalImageToTexture() { uploads++ } }, createShaderModule() {}, createRenderPipeline: () => ({ getBindGroupLayout() {} }), createSampler() {}, createTexture: () => ({ createView() {}, destroy() {} }), createBuffer: () => ({ destroy() {} }), createBindGroup() {}, createCommandEncoder: () => ({ beginRenderPass: () => pass, finish() {} }), pushErrorScope() {}, popErrorScope: async () => null } as unknown as GpuDevice
  const project = createVideoEditTestDocument('t78 4K60'); Object.assign(project.sequences[0], { width: 3840, height: 2160, fps: 60, frameRate: { numerator: 60, denominator: 1 } })
  const graphic = createVideoEditGraphic('text', 3840, 2160)
  graphic.objects.push(...createVideoEditGraphic('rect', 3840, 2160).objects)
  graphic.objects[0].parameters.text = '痕迹AI Motion'
  graphic.objects[0].curves = Object.fromEntries(Object.entries({ x: [900, 2800], y: [600, 1400], rotation: [0, 90], opacity: [.3, 1], scale: [.5, 1] }).map(([key, values]) => [key, values.map((value, index) => ({ id: `${key}${index}`, sourceInUs: index * 3_000_000, sourceRemainder: { numerator: 0, denominator: 1 }, value, interpolation: 'linear' as const }))]))
  project.items.push({ id: 'graphic', name: '动画', kind: 'graphic', graphic })
  const clip = makeVideoEditItemClip(project, 'graphic', project.sequences[0].id, { frame: 0 }); project.sequences[0].clips.push(clip)
  const document = videoEditComposition(project, project.sequences[0].id); const runtime = new VideoEditCodeGpu(device); const sources = new VideoEditCodeSources(document, async () => runtime)
  const frames: Array<{ frame: number; rasterCalls: number; uploads: number; ms: number }> = []
  try {
    for (let frame = 0; frame < 180; frame++) {
      const before = paints; const copies = uploads; const start = performance.now()
      await sources.prepare(document, document.clips, frame, () => true)
      frames.push({ frame, rasterCalls: paints - before, uploads: uploads - copies, ms: performance.now() - start })
    }
    const sorted = frames.map(frame => frame.ms).sort((a, b) => a - b)
    const result = { frames: frames.length, rasterCalls: paints, uploads, allocatedCanvasPixels: pixels, totalMs: frames.reduce((sum, frame) => sum + frame.ms, 0), p95Ms: sorted[Math.floor(sorted.length * .95)], perFrame: frames }
    if (process.env.HENJI_TYPOGRAPHY_BENCH_OUT) writeFileSync(process.env.HENJI_TYPOGRAPHY_BENCH_OUT, JSON.stringify(result, null, 2))
    expect(frames).toHaveLength(180)
    if (!process.env.HENJI_TYPOGRAPHY_BASELINE) { expect(paints).toBe(1); expect(uploads).toBe(1); expect(pixels).toBeLessThan(3840 * 2160) }
  } finally { await sources.dispose(); await runtime.dispose() }
})
