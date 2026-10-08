import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { afterEach, expect, it, vi } from 'vitest'
import { writeFileSync } from 'node:fs'
import { init } from 'vgpu/node'
import sharp from 'sharp'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { activeVideoEditClips, videoEditComposition } from '@/core/videoEdit/document'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { buildVideoEditCompositePlan } from '@/core/videoEdit/compositing'
import { videoEditCaptionClips } from '@/core/videoEdit/timedContent'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditGpuCompositor } from './videoEditGpuCompositor'
import { VideoEditCodeSources } from './videoEditCodeSources'
import { VideoEditGpuFrame } from './videoEditGpuFrame'
import { VideoEditCodeGpu } from './videoEditCodeGpu'
import { renderVideoEditCompositeScene, videoEditCompositeSurfaceKeys } from './videoEditCompositeScene'
import { parameterBenchmark } from './videoEditParameterBenchmark'

vi.mock('./videoEditCodeCompiler', async () => {
  const { compileCodeMaterial } = await import('@/core/videoEdit/codeMaterial/compiler')
  return { VideoEditCodeCompiler: class { async compile(source: Parameters<typeof compileCodeMaterial>[0]) { return compileCodeMaterial(source) } dispose() {} } }
})

const state = vi.hoisted(() => ({ device: undefined as GpuDevice | undefined }))
parameterBenchmark(device => { state.device = device })
vi.mock('@/core/imageEdit/webgpu/deviceManager', () => ({ ImageEditWebGpuDeviceManager: class {
  onDeviceLost() {}
  async acquire() { return { device: state.device!, provider: { getPreferredCanvasFormat: () => 'rgba8unorm' } } }
  destroy() {}
} }))
// Exact v1 sources from the code-controls/composite-edit Reality fixtures.
const generator = 'export default {apiVersion:1,name:"原创轨道标题",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:91,parameters:{speed:{type:"number",title:"移动速度",default:80,min:0,max:400,step:1,animatable:true},ink:{type:"color",title:"标题颜色",default:[0.2,1,1,0.8],animatable:true},enabled:{type:"boolean",title:"显示图形",default:true},shape:{type:"choice",title:"图形样式",default:"圆",options:["圆","方"]},label:{type:"text",title:"标题文字",default:"原创代码 · 混合剪辑",maxLength:128}},render(ctx){const x=250+ctx.time*ctx.params.speed;return [rect({x:x,y:1100,width:260,height:260,radius:ctx.params.shape==="圆"?130:0,fill:ctx.params.enabled?ctx.params.ink:[0,0,0,0]}),line({x1:x,y1:1420,x2:x+1800,y2:1420,width:14,color:ctx.params.ink}),text({x:x+150,y:1600,text:ctx.params.label,fontSize:130,color:[1,1,1,1]})];}}'
const filter = 'export default {apiVersion:1,name:"原创红色处理",kind:"filter",mode:"static",width:3840,height:2160,durationSeconds:10,seed:21,parameters:{gain:{type:"number",title:"红色增益",default:.8,min:0,max:1,step:.01,animatable:true}},render(ctx){const c=sample(ctx.u,ctx.v);return rgba(c.r*ctx.params.gain,c.g,c.b,c.a);}}'

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
it('180帧时间码/计数器内容变化只新栅格当前内容，运动中的固定文字不被LRU逐出，纹理驻留有界', async () => {
  let paints = 0; let copies = 0
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { font: '', fillText() { paints++ }, measureText(text: string) { return { width: text.length * 30, actualBoundingBoxRight: text.length * 30, actualBoundingBoxLeft: 0 } } } }
  })
  const pass = { setPipeline() {}, setBindGroup() {}, draw() {}, end() {} }
  const device = { queue: { writeBuffer() {}, submit() {}, onSubmittedWorkDone: async () => {}, copyExternalImageToTexture() { copies++ } }, createShaderModule() {}, createRenderPipeline: () => ({ getBindGroupLayout() {} }), createSampler() {}, createTexture: () => ({ createView() { return {} }, destroy() {} }), createBuffer: () => ({ destroy() {} }), createBindGroup() {}, createCommandEncoder: () => ({ beginRenderPass: () => pass, finish() {} }), pushErrorScope() {}, popErrorScope: async () => null } as unknown as GpuDevice
  const runtime = new VideoEditCodeGpu(device)
  const program = compileCodeMaterial('export default {apiVersion:1,name:"计数器",kind:"generator",mode:"dynamic",width:3840,height:2160,durationSeconds:10,seed:1,parameters:{label:{type:"text",title:"时间码",default:"0",maxLength:128}},render(ctx){return [text({x:ctx.frame,y:200,text:"固定标题",fontSize:32,color:[1,1,1,1]}),text({x:100,y:300,text:ctx.params.label,fontSize:32,color:[1,1,1,1]})];}}')
  try {
    for (let frame = 0; frame < 180; frame++) {
      const before = copies
      await runtime.generator('counter', program, { width: 3840, height: 2160, frame, time: frame / 60, localTime: frame / 60, sequenceTime: frame / 60, fps: 60 }, { label: `00:00:${Math.floor(frame / 60)}:${frame % 60} ${frame}` })
      expect(copies - before).toBe(frame === 0 ? 2 : 1)
      expect(runtime.diagnostics().glyphs).toBeLessThanOrEqual(64)
      expect(runtime.diagnostics().residentBytes).toBeLessThan(256 * 1024 ** 2)
    }
    expect(paints).toBe(181)
  } finally { await runtime.dispose() }
})

it.skipIf(process.env.HENJI_VIDEO_PRESSURE_BENCH !== '1')('原4K60等价500片段500字幕逐帧GPU分阶段基准', async () => {
  const gpu = await init({ requiredFeatures: ['timestamp-query'] }); const device = gpu.gpu
  let stage = ''; let copies = 0; let allocations = 0; let compiles = 0; let bindings = 0
  const queries = device.createQuerySet({ type: 'timestamp', count: 64 })
  const queryResolve = device.createBuffer({ size: 512, usage: 0x200 | 0x04 })
  const queryRead = device.createBuffer({ size: 512, usage: 0x01 | 0x08 })
  let spans: Array<{ stage: string; begin: number }> = []
  const stageCpu: Record<string, number> = {}
  // Node has no Chromium Canvas. The one invariant v1 glyph is shaped/rasterized with libvips before warmup;
  // the production glyph-cache/upload path is retained. This cannot measure Chromium Canvas cold-raster cost.
  const label = '原创代码 · 混合剪辑'; const glyphWidth = 1500; const glyphHeight = 199
  const glyphPixels = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${glyphWidth}" height="${glyphHeight}"><text x="2" y="140" font-size="130" fill="white">${label}</text></svg>`)).ensureAlpha().raw().toBuffer()
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return { font: '', fillStyle: '', textBaseline: '', fillText() {}, measureText: () => ({ width: glyphWidth - 4, actualBoundingBoxRight: glyphWidth - 4, actualBoundingBoxLeft: 0 }) } }
  })
  const queue = new Proxy(device.queue, { get(target, key) {
    if (key === 'copyExternalImageToTexture') return (_from: unknown, to: Parameters<typeof target.writeTexture>[0], size: [number, number]) => {
      const start = performance.now(); copies++; target.writeTexture(to, glyphPixels, { bytesPerRow: size[0] * 4 }, size)
      stageCpu.textUpload = (stageCpu.textUpload ?? 0) + performance.now() - start
    }
    const value: unknown = Reflect.get(target, key); return value instanceof Function ? value.bind(target) : value
  } })
  state.device = new Proxy(device, { get(target, key) {
    if (key === 'queue') return queue
    if (key === 'createTexture') return (descriptor: Parameters<typeof target.createTexture>[0]) => { allocations++; return target.createTexture({ ...descriptor, usage: descriptor.usage | 1 }) }
    if (key === 'createRenderPipeline') return (descriptor: Parameters<typeof target.createRenderPipeline>[0]) => { compiles++; return target.createRenderPipeline(descriptor) }
    if (key === 'createBindGroup') return (descriptor: Parameters<typeof target.createBindGroup>[0]) => { bindings++; return target.createBindGroup(descriptor) }
    if (key === 'createCommandEncoder') return () => {
      const encoder = target.createCommandEncoder()
      return new Proxy(encoder, { get(target, key) {
        if (key === 'beginRenderPass') return (descriptor: Parameters<typeof target.beginRenderPass>[0]) => {
          if (!stage) return target.beginRenderPass(descriptor)
          const begin = spans.length * 2; spans.push({ stage, begin })
          return target.beginRenderPass({ ...descriptor, timestampWrites: { querySet: queries, beginningOfPassWriteIndex: begin, endOfPassWriteIndex: begin + 1 } })
        }
        const value: unknown = Reflect.get(target, key); return value instanceof Function ? value.bind(target) : value
      } })
    }
    const value: unknown = Reflect.get(target, key); return value instanceof Function ? value.bind(target) : value
  } }) as unknown as GpuDevice
  const project = createVideoEditTestDocument('t79 压力')
  const sequence = project.sequences[0]
  Object.assign(sequence, { width: 3840, height: 2160, fps: 60, frameRate: { numerator: 60, denominator: 1 } })
  sequence.tracks = Array.from({ length: 32 }, (_, index) => ({ ...sequence.tracks[0], id: `track-${index}`, index, kind: index ? 'video' as const : 'audio' as const }))
  project.items.push({ id: 'video', name: '解码模拟', kind: 'video' }, { id: 'code', name: '压力原创动态代码', kind: 'code', code: { definitionId: 'generator', versionId: 'v', parameters: {} } })
  project.codeMaterials = [generator, filter].map((source, index) => ({ id: index ? 'filter' : 'generator', name: index ? '原创红色处理' : '原创轨道标题', defaultVersionId: 'v', versions: [{ id: 'v', apiVersion: 1, languageVersion: 1, ...testCodeManifest(source, document) }] }))
  const base = { ...makeVideoEditItemClip(project, 'video', sequence.id, { frame: 0, track: 1 }), id: 'base', duration: 360 }
  base.effects = [{ id: 'red', name: '原创红色处理', enabled: true, amount: 1, code: { definitionId: 'filter', versionId: 'v', parameters: {} } }]
  sequence.clips = [base, { ...base, id: 'overlay', track: 2, x: .3, y: .3, scale: .3, effects: undefined, sourceInUs: 1_000_000 }, { ...base, id: 'dynamic', kind: 'code', itemId: 'code', code: { definitionId: 'generator', versionId: 'v', parameters: {} }, track: 3, effects: undefined, duration: 360 }, ...Array.from({ length: 497 }, (_, index) => ({ ...base, id: `offscreen-${index}`, start: 3600 + index * 4, duration: 2, track: 31, effects: undefined }))]
  sequence.captions = Array.from({ length: 500 }, (_, index) => ({ id: `caption-${index}`, start: 7200 + index * 2, duration: 1, text: `范围字幕 ${index}` }))
  const document = videoEditComposition(project, sequence.id)
  const output = device.createTexture({ size: [3840, 2160], format: 'rgba8unorm', usage: 4 | 16 | 1 })
  const canvas = { width: 3840, height: 2160, getContext: () => ({ configure() {}, getCurrentTexture: () => output }) } as unknown as OffscreenCanvas
  const compositor = new VideoEditGpuCompositor(canvas)
  const runtime = await compositor.code()
  // The failed Electron evidence retains 3,732,480,000 bytes = 300 original 4K 4:2:0 frames.
  // Materialize those planes, rather than benchmarking only one hot texture and hiding residency pressure.
  const decoded: VideoEditGpuFrame[] = []
  for (let frame = 0; frame < 300; frame++) {
    const y = device.createTexture({ size: [3840, 2160], format: 'r8unorm', usage: 4 | 16 })
    const uv = device.createTexture({ size: [1920, 1080], format: 'rg8unorm', usage: 4 | 16 })
    const encoder = device.createCommandEncoder()
    for (const plane of [y, uv]) encoder.beginRenderPass({ colorAttachments: [{ view: plane.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: .5 + frame / 1200, g: .5, b: 0, a: 1 } }] }).end()
    device.queue.submit([encoder.finish()])
    decoded.push(new VideoEditGpuFrame({ timestamp: frame / 60, duration: 1 / 60, displayWidth: 3840, displayHeight: 2160, rotation: 0, flip: false }, y as unknown as GpuTexture, uv as unknown as GpuTexture, 3840 * 2160 * 1.5))
  }
  await device.queue.onSubmittedWorkDone()
  const sources = new VideoEditCodeSources(document, async () => runtime, { compile: async source => compileCodeMaterial(source), dispose() {} })
  let phases: Record<string, number> = {}
  const time = async <T>(name: string, work: () => Promise<T>): Promise<T> => {
    stage = name; const start = performance.now(); const value = await work(); await device.queue.onSubmittedWorkDone()
    phases[name] = (phases[name] ?? 0) + performance.now() - start; stage = ''; return value
  }
  const originalFilter = runtime.filter.bind(runtime); runtime.filter = (...args) => time('codeFilter', () => originalFilter(...args))
  const originalBuiltin = runtime.builtin.bind(runtime); runtime.builtin = (...args) => time('builtinEffects', () => originalBuiltin(...args))
  const originalDraw = compositor.draw.bind(compositor); compositor.draw = (...args) => time('composition', () => originalDraw(...args))
  const frames: Array<Record<string, unknown> & { frame: number; ms: number }> = []
  const render = async (frame: number, record: boolean) => {
    spans = []
    phases = { subtitleRaster: 0, textUpload: 0, codeGenerator: 0, codeFilter: 0, builtinEffects: 0, composition: 0 }; stageCpu.textUpload = 0
    const before = { copies, allocations, compiles, bindings }; const start = performance.now()
    const active = [...activeVideoEditClips(document, frame), ...videoEditCaptionClips(document, frame)]
    const nodes = buildVideoEditCompositePlan(active, [])
    await compositor.prepareImages(new Map(), () => true, new Set(), new Set(active.map(clip => clip.id)))
    const prepared = await time('codeGenerator', () => sources.prepare(document, active, frame, () => true, undefined, { surfaceKeys: videoEditCompositeSurfaceKeys(nodes) }))
    const pictures = new Map(active.map(clip => [clip.id, prepared.pictures.get(clip.id) ?? decoded[frame + (clip.id === 'overlay' ? 60 : 0)]]))
    const result = await renderVideoEditCompositeScene(document, nodes, pictures, prepared.effects, compositor, frame, () => true)
    await result.completion
    phases.textUpload = stageCpu.textUpload
    const ms = performance.now() - start
    const encoder = device.createCommandEncoder(); encoder.resolveQuerySet(queries, 0, spans.length * 2, queryResolve, 0); encoder.copyBufferToBuffer(queryResolve, 0, queryRead, 0, spans.length * 16); device.queue.submit([encoder.finish()])
    await queryRead.mapAsync(1)
    const timestamps = new BigUint64Array(queryRead.getMappedRange()); const gpuPhases: Record<string, number> = {}
    spans.forEach(span => { gpuPhases[span.stage] = (gpuPhases[span.stage] ?? 0) + Number(timestamps[span.begin + 1] - timestamps[span.begin]) / 1e6 })
    queryRead.unmap()
    const gpuMs = Object.values(gpuPhases).reduce((sum, ms) => sum + ms, 0)
    if (record) frames.push({ frame, ms, gpuMs, gpuPhases, ...phases, uploads: copies - before.copies, allocations: allocations - before.allocations, compiles: compiles - before.compiles, bindings: bindings - before.bindings, resources: runtime.diagnostics() })
  }
  try {
    expect(sequence.clips).toHaveLength(500); expect(sequence.captions).toHaveLength(500)
    expect(videoEditCaptionClips(document, 179)).toHaveLength(0)
    await render(179, false); await render(0, false)
    for (let frame = 0; frame < 180; frame++) await render(frame, true)
    const sorted = frames.map(frame => frame.ms).sort((a, b) => a - b)
    const gpuSorted = frames.map(frame => Number(frame.gpuMs)).sort((a, b) => a - b)
    const report = { backend: 'vgpu/node; 300 decoded 4K 4:2:0 planes simulated; invariant glyph libvips before warmup; wall + GPU pass timestamp queries (query readback excluded)', adapter: gpu.adapter, decodedBytes: decoded.reduce((sum, frame) => sum + frame.allocationSize(), 0), stage, frames: frames.length, medianMs: sorted[90], p95Ms: sorted[171], maxMs: sorted[179], gpuMedianMs: gpuSorted[90], gpuP95Ms: gpuSorted[171], gpuMaxMs: gpuSorted[179], spikes: frames.filter(frame => frame.ms >= 16), perFrame: frames }
    if (process.env.HENJI_VIDEO_PRESSURE_OUT) writeFileSync(process.env.HENJI_VIDEO_PRESSURE_OUT, JSON.stringify(report, null, 2))
    expect(frames).toHaveLength(180)
    expect(frames.every(frame => frame.compiles === 0 && frame.allocations === 0 && frame.uploads === 0)).toBe(true)
  } finally { await sources.dispose(); await compositor.dispose(); decoded.forEach(frame => frame.close()); output.destroy(); queries.destroy(); queryResolve.destroy(); queryRead.destroy(); gpu.dispose() }
}, 120_000)


