import { expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { SHADER_GRAPH_EFFECT_DEFINITIONS } from '@/core/videoEdit/shaderGraph/effects'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditGpuFrame } from './videoEditGpuFrame'
import { VideoEditRenderer } from './videoEditRenderer'
import type { VideoEditFrameBackend } from './videoEditFrameSource'
import { initShaderGraphTestGpu } from './shaderEngines/shaderGraphGpu.testing'
import { videoEditParameterUpdate } from './videoEditParameterUpdate'
import { videoEditEffectSchema } from '@/core/videoEdit/compositing'

/** Same renderer/compositor as Worker; only native decode and Chromium surface are replaced. */
export function parameterBenchmark(setDevice: (device: GpuDevice) => void): void {
  it.skipIf(process.env.HENJI_PARAMETER_BENCH !== '1')('t96: 60 parameter writes to GPU completion, 1080p/4K × one/three tracks × five effects', async () => {
    const gpu = await initShaderGraphTestGpu()
    const device = gpu.gpu
    const counts = { textures: 0, pipelines: 0, bindings: 0, passes: 0, uniforms: 0 }
    setDevice(new Proxy(device, { get(target, key) {
      if (key === 'createTexture' || key === 'createRenderPipeline' || key === 'createBindGroup') return (descriptor: never) => {
        counts[key === 'createTexture' ? 'textures' : key === 'createRenderPipeline' ? 'pipelines' : 'bindings']++
        return target[key](descriptor)
      }
      if (key === 'queue') return new Proxy(target.queue, { get(queue, name) {
        if (name === 'writeBuffer') return (...args: Parameters<typeof queue.writeBuffer>) => { counts.uniforms++; queue.writeBuffer(...args) }
        const value: unknown = Reflect.get(queue, name); return value instanceof Function ? value.bind(queue) : value
      } })
      if (key === 'createCommandEncoder') return () => {
        const encoder = target.createCommandEncoder()
        return new Proxy(encoder, { get(owner, name) {
          if (name === 'beginRenderPass') return (...args: Parameters<typeof owner.beginRenderPass>) => { counts.passes++; return owner.beginRenderPass(...args) }
          const value: unknown = Reflect.get(owner, name); return value instanceof Function ? value.bind(owner) : value
        } })
      }
      const value: unknown = Reflect.get(target, key); return value instanceof Function ? value.bind(target) : value
    } }) as unknown as GpuDevice)
    const shader = SHADER_GRAPH_EFFECT_DEFINITIONS.find(value => value.id === 'shaders.Pixelate')!
    expect(shader).toBeDefined()
    const shaderParam = shader.params.find(value => value.type === 'number')!
    const filter = 'export default {apiVersion:1,name:"增益",kind:"filter",mode:"static",width:3840,height:2160,durationSeconds:10,seed:1,parameters:{gain:{type:"number",title:"增益",default:.8,min:0,max:1,step:.01,animatable:true}},render(ctx){const c=sample(ctx.u,ctx.v);return rgba(c.r*ctx.params.gain,c.g,c.b,c.a);}}'
    const reports: object[] = []
    try {
      for (const [width, height] of [[1920, 1080], [3840, 2160]]) for (const tracks of [1, 3]) for (const kind of ['grade', 'hsl', 'glow', 'shader', 'code']) {
        const project = createVideoEditTestDocument('t96')
        const sequence = project.sequences[0]; sequence.width = width; sequence.height = height
        sequence.tracks = Array.from({ length: tracks }, (_, index) => ({ ...sequence.tracks.find(value => value.kind === 'video')!, id: `track${index}`, index: index + 1 }))
        project.media = [{ id: 'media', name: 'GPU fixture', kind: 'video', path: '/fixture.mp4', width, height, durationSeconds: 10 }]
        project.items = [{ id: 'item', name: 'GPU fixture', kind: 'video', mediaId: 'media' }]
        project.codeMaterials = [{ id: 'filter', name: '增益', defaultVersionId: 'v', versions: [{ id: 'v', apiVersion: 1, languageVersion: 1, ...testCodeManifest(filter, project) }] }]
        sequence.clips = Array.from({ length: tracks }, (_, i) => ({ ...makeVideoEditItemClip(project, 'item', sequence.id, { frame: 0, track: i + 1 }), id: `clip${i}`, duration: 120, ...(i ? { scale: .4, x: .15 * i, y: .15 * i } : {}), effects: [videoEditEffectSchema.parse({ id: `effect${i}`, name: kind, enabled: true, amount: 1, ...(kind === 'code' ? { code: { definitionId: 'filter', versionId: 'v', parameters: { gain: .8 } } } : { builtin: { id: kind === 'glow' ? 'glow_pro' : kind === 'shader' ? shader.id : 'color_grade', params: kind === 'hsl' ? { exposure: .2, hsl_saturation: 30, hsl_denoise: 30, hsl_blur: 30 } : kind === 'grade' ? { exposure: .2 } : {} } }) })] }))
        for (const clip of sequence.clips.slice(1)) delete clip.effects
        const source = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: 4 | 16 })
        const encoder = device.createCommandEncoder(); encoder.beginRenderPass({ colorAttachments: [{ view: source.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: .6, g: .2, b: .1, a: 1 } }] }).end(); device.queue.submit([encoder.finish()])
        const picture = new VideoEditGpuFrame({ timestamp: 0, duration: 10, displayWidth: width, displayHeight: height, rotation: 0, flip: false }, source as unknown as GpuTexture, undefined, width * height * 4)
        let reads = 0
        const frames: VideoEditFrameBackend = { open: () => ({ key: 'fixture', ready: Promise.resolve({ clipFrames: () => ({ async *frames() {}, frameAt: async () => { throw new Error('unexpected decode') } }), clipAudio: () => undefined, async *schedule() {} }) }), release() {}, seeker: () => ({ sample: async () => { reads++; return { sample: picture.clone(), hit: true } }, async dispose() {} }) }
        const output = device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: 4 | 16 | 1 })
        const canvas = { width, height, getContext: () => ({ configure() {}, getCurrentTexture: () => output }) } as unknown as OffscreenCanvas
        let document = videoEditComposition(project, sequence.id)
        const renderer = new VideoEditRenderer(document, width, canvas, undefined, frames)
        const draw = async (): Promise<void> => { const result = await renderer.render(0); expect(result.effectErrors).toEqual([]); expect(result.presented).toBe(true); await result.completion }
        const pixels = async (): Promise<Buffer> => {
          const bytesPerRow = Math.ceil(width * 4 / 256) * 256
          const buffer = device.createBuffer({ size: bytesPerRow * height, usage: 1 | 8 })
          try {
            const encoder = device.createCommandEncoder(); encoder.copyTextureToBuffer({ texture: output }, { buffer, bytesPerRow }, [width, height]); device.queue.submit([encoder.finish()])
            await buffer.mapAsync(1); const data = Buffer.from(new Uint8Array(buffer.getMappedRange()).slice()); buffer.unmap(); return data
          } finally { buffer.destroy() }
        }
        try {
          await draw(); await draw()
          const before = { ...counts }; const initialReads = reads
          const samples: object[] = []; const times: number[] = []
          for (let i = 0; i < 60; i++) {
            const effect = document.clips[0].effects![0]
            const nextEffect = effect.code ? { ...effect, code: { ...effect.code, parameters: { gain: .2 + i / 100 } } } : { ...effect, builtin: { ...effect.builtin!, params: { ...effect.builtin!.params, [kind === 'shader' ? shaderParam.key : kind === 'glow' ? 'strength' : 'exposure']: kind === 'shader' ? 10 + i : kind === 'glow' ? 1 + i : i / 60 } } }
            const next = { ...document, revision: document.revision + 1, clips: document.clips.map((clip, index) => index ? clip : { ...clip, effects: [nextEffect] }) }
            const start = performance.now()
            const frameWork = { ...counts }; const frameReads = reads
            // Full Worker payload clone on baseline. Fast update uses the production detector/message.
            const fast = process.env.HENJI_PARAMETER_FAST === '1'
            const update = fast ? videoEditParameterUpdate(document, next) : undefined
            if (fast) expect(update).toBeDefined()
            const payload = update ? { kind: 'parameters' as const, update } : { kind: 'update' as const, document: next }
            const bytes = new TextEncoder().encode(JSON.stringify(payload)).byteLength
            const cloned = structuredClone(payload)
            const updateStart = performance.now()
            if (cloned.kind === 'parameters') renderer.updateParameters(cloned.update)
            else await renderer.updateDocument(cloned.document)
            const updateMs = performance.now() - updateStart
            await draw(); const ms = performance.now() - start; times.push(ms); samples.push({ ms, updateMs, bytes, work: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value - frameWork[key as keyof typeof frameWork]])), seekerReads: reads - frameReads }); document = next
          }
          const sorted = times.sort((a, b) => a - b)
          const work = Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, value - before[key as keyof typeof before]]))
          const seekerReads = reads - initialReads
          const dragged = await pixels()
          await renderer.updateDocument(structuredClone(document)); await draw()
          expect((await pixels()).equals(dragged)).toBe(true)
          reports.push({ width, height, tracks, kind, p50: sorted[30], p95: sorted[57], max: sorted[59], work, seekerReads, finalPixelsEqual: true, samples })
        } finally { await renderer.dispose(); picture.close(); output.destroy() }
      }
      const report = { backend: 'vgpu/node; production VideoEditRenderer; cached synthetic source; CPU clone + GPU completion, excludes React/IPC/display', adapter: gpu.adapter, fast: process.env.HENJI_PARAMETER_FAST === '1', reports }
      if (process.env.HENJI_PARAMETER_OUT) writeFileSync(process.env.HENJI_PARAMETER_OUT, JSON.stringify(report, null, 2))
      process.stdout.write(`${JSON.stringify(report)}\n`)
    } finally { gpu.dispose(); vi.unstubAllGlobals() }
  }, 180_000)
}
