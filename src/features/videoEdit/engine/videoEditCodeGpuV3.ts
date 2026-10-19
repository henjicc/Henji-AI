import { rasterizeCodeShape } from './videoEditCodeRaster'
export { rasterizeCodeShape } from './videoEditCodeRaster'
import { CODE_BLEND_INDICES, CODE_BLEND_WGSL } from '@/core/videoEdit/codeMaterial/compositing'
import { COMPOSITING_WGSL } from '@/core/imaging/compositing/wgsl'
import type { GpuBuffer, GpuDevice, GpuRenderPipeline, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { CodeMaterialError, CODE_V3_LIMITS } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeBlend, CodeColor, CodeDrawCommand, CodeMatrix, CodePaint } from '@/core/videoEdit/codeMaterial/contract'
import { CODE_IDENTITY, codeElementBounds, codeLocalBounds, codeMultiply, codePoint, codeTextBaseBounds, codeTransform } from '@/core/videoEdit/codeMaterial/geometry'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'
import { ShaderGraphCache } from './shaderEngines/shaderGraphCache'
import { codeShaderFailure } from './shaderEngines/codeShaderFailure'
import diffusionSource from '@/core/imageEdit/shaders/diffusion.wgsl?raw'
import { renderScatterPyramid } from '@/core/imageEdit/webgpu/scatterPyramidRenderer'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'
import { traceVideoEditFrame } from './videoEditFrameTrace'
import { documentFontRevision } from '@/platform/fontFaces'
import { videoEditTextResolution } from './videoEditTextSurface'
import { CodeVectorGpu, type CodeVectorInstance } from './videoEditCodeVectorGpu'
import { isCodeVector, supportsCodeVector } from './videoEditCodeVectorGeometry'
import { codeHasLiveImage, codeInvisible, codeVisualCommands } from '@/core/videoEdit/codeMaterial/visibility'
import { CodeReuseProbe } from './videoEditCodeReuse'
import type { CodeHeavyStructure } from '@/core/videoEdit/codeMaterial/performance'
import { CODE_MOTION_PIXEL_SAMPLE_BUDGET, CODE_MOTION_UNIFORM_BYTES, CODE_MOTION_WGSL, prepareCodeMotion } from './videoEditCodeMotion'
import type { CodeMotionSample } from '@/core/videoEdit/codeMaterial/motionSampling'

interface Image { texture: GpuTexture; width: number; height: number; x: number; y: number; resolution?: number }
interface CachedImage extends Image { bytes: number; used: boolean; glyph?: boolean }
interface Allocator { allocate(width: number, height: number): GpuTexture; release(texture: GpuTexture): void; canRetain?(bytes: number): boolean }
type Encoder = ReturnType<GpuDevice['createCommandEncoder']>
const normalBlend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }
function characterCommand(command: Extract<CodeDrawCommand, { kind: 'text' }>, index: number, opacity: number, path: string[]): CodeDrawCommand {
  const layout = command.layout!; const box = codeTextBaseBounds(command)
  const glyph = layout.glyphs[index]; const transform = command.perChar![index]
  const row = Math.round(glyph.y / (layout.fontSize * (command.lineHeight ?? 1.2))); const lineWidth = layout.lineWidths?.[row] ?? layout.width
  return { ...command, x: box.x + glyph.x + (command.align === 'center' ? (box.width - lineWidth) / 2 : command.align === 'right' ? box.width - lineWidth : 0), y: box.y + glyph.y, text: glyph.text, align: 'left', baseline: 'top', perChar: undefined, letterSpacing: command.letterSpacing ? 1 : 0, layout: { ...layout, width: glyph.width, height: layout.fontSize * (command.lineHeight ?? 1.2), lines: [glyph.text], lineWidths: [glyph.width], glyphs: [{ ...glyph, x: 0, y: 0 }] }, opacity: opacity * transform.opacity, rotation: transform.rotation, skewX: transform.skewX, skewY: 0, paint: transform.fill ?? command.paint, blur: transform.blur ?? command.blur, glow: transform.glow ?? command.glow, elementTransform: undefined, scaleX: transform.scale, scaleY: transform.scale, anchorX: 0, anchorY: 0, elementPath: [...path, `char:${index}`] }
}
function identityPrimitive(command: CodeDrawCommand): boolean {
  return command.kind !== 'group' && !command.elementTransform && !command.rotation && !command.skewX && !command.skewY && (command.scaleX ?? 1) === 1 && (command.scaleY ?? 1) === 1
}
const shader = COMPOSITING_WGSL + CODE_BLEND_WGSL + `
struct P { box:vec4f, color:vec4f, canvas:vec4f, matrix0:vec4f, matrix1:vec4f, stroke:vec4f, extra:vec4f }
@group(0) @binding(0) var<uniform> p:P;
struct V { @builtin(position) position:vec4f, @location(0) uv:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->V {
 let uv=array<vec2f,6>(vec2f(0,0),vec2f(0,1),vec2f(1,0),vec2f(1,0),vec2f(0,1),vec2f(1,1))[i];
 let local=p.box.xy+uv*p.box.zw;
 let q=vec2f(p.matrix0.x*local.x+p.matrix0.z*local.y+p.matrix1.x,p.matrix0.y*local.x+p.matrix0.w*local.y+p.matrix1.y)/p.canvas.xy;
 return V(vec4f(q.x*2-1,1-q.y*2,0,1),uv);
}
@fragment fn shape(v:V)->@location(0) vec4f {
 let half=p.box.zw*.5; let point=v.uv*p.box.zw; let radius=min(p.extra.x,min(half.x,half.y));
 let q=abs(point-half)-half+vec2f(radius); var d=length(max(q,vec2f(0)))+min(max(q.x,q.y),0.0)-radius;
 if(p.extra.y==1.0) { d=(length((point-half)/max(half,vec2f(.000001)))-1.0)*min(half.x,half.y); }
 let outer=clamp(.5-d,0.0,1.0); let edge=outer*(1.0-clamp(.5-d-p.extra.z,0.0,1.0));
 let fill=vec4f(p.color.rgb*p.color.a,p.color.a)*outer;
 let stroke=vec4f(p.stroke.rgb*p.stroke.a,p.stroke.a)*edge;
 return (stroke+fill*(1.0-stroke.a))*p.canvas.z;
}
@group(0) @binding(1) var image:texture_2d<f32>;
@group(0) @binding(2) var sampler0:sampler;
@fragment fn textured(v:V)->@location(0) vec4f {
 let c=textureSampleLevel(image,sampler0,v.uv,0.0);
 return vec4f(select(c.rgb*c.a,c.rgb,p.extra.w==1.0),c.a)*p.canvas.z;
}
@group(0) @binding(3) var background:texture_2d<f32>;
@fragment fn composite(v:V)->@location(0) vec4f {
 let a=textureSampleLevel(image,sampler0,v.uv,0.0)*p.canvas.z; let b=textureSampleLevel(background,sampler0,v.position.xy/p.canvas.xy,0.0);
 let s=select(vec3f(0),a.rgb/a.a,a.a>0.0); let d=select(vec3f(0),b.rgb/b.a,b.a>0.0);
 let rgb=codeBlendRgb(d,s,u32(p.extra.x));
 return compositeWithBlend(b,a,rgb,false);
}
@fragment fn masked(v:V)->@location(0) vec4f {
 let content=textureSampleLevel(image,sampler0,v.uv,0.0);
 let mask=textureSampleLevel(background,sampler0,v.uv,0.0);
 var coverage=clamp(select(mask.a,dot(mask.rgb,vec3f(.2126,.7152,.0722)),p.extra.x==1.0),0.0,1.0);
 if(p.extra.y==1.0) { coverage=1.0-coverage; }
 return content*coverage;
}
@fragment fn effects(v:V)->@location(0) vec4f {
 let base=textureSampleLevel(background,sampler0,v.uv,0.0);
 let glow=textureSampleLevel(image,sampler0,v.uv,0.0).a*p.color.a;
 let alpha=clamp(glow,0.0,1.0);
 let halo=vec4f(p.color.rgb*alpha,alpha);
 return base+halo*(1.0-base.a);
}
@fragment fn bright(v:V)->@location(0) vec4f {
 let c=textureSampleLevel(image,sampler0,v.uv,0.0); let peak=max(c.r,max(c.g,c.b))/max(c.a,.000001);
 if(peak<=0.0) { return vec4f(0); }
 let threshold=clamp(p.color.a,0.0,1.0); let knee=max(threshold*.25,.00001);
 let soft=clamp(peak-threshold+knee,0.0,2.0*knee); let response=max(peak-threshold,soft*soft/(4.0*knee))/max(peak,.000001);
 return c*clamp(response,0.0,1.0);
}
@fragment fn tint(v:V)->@location(0) vec4f {
 let alpha=textureSampleLevel(image,sampler0,v.uv,0.0).a*p.color.a;
 return vec4f(p.color.rgb*alpha,alpha);
}`
// Trusted instancing variant shares the exact geometry/SDF with the single-quad path.
const shapeBody = shader.slice(shader.indexOf('@fragment fn shape(v:V)->@location(0) vec4f {') + '@fragment fn shape(v:V)->@location(0) vec4f {'.length, shader.indexOf('\n}\n@group(0) @binding(1)'))
// Per-instance data arrives as vertex attributes, not a vertex-stage storage buffer: compatibility-mode WebGPU allows none there.
const instanceShader = `
struct P { box:vec4f, color:vec4f, canvas:vec4f, matrix0:vec4f, matrix1:vec4f, stroke:vec4f, extra:vec4f }
struct V { @builtin(position) position:vec4f, @location(0) uv:vec2f, @location(1) @interpolate(flat, either) box:vec4f, @location(2) @interpolate(flat, either) color:vec4f, @location(3) @interpolate(flat, either) canvas:vec4f, @location(4) @interpolate(flat, either) stroke:vec4f, @location(5) @interpolate(flat, either) extra:vec4f }
@vertex fn vs(@builtin(vertex_index) i:u32,@location(0) box:vec4f,@location(1) color:vec4f,@location(2) canvas:vec4f,@location(3) matrix0:vec4f,@location(4) matrix1:vec4f,@location(5) stroke:vec4f,@location(6) extra:vec4f)->V {
 let uv=array<vec2f,6>(vec2f(0,0),vec2f(0,1),vec2f(1,0),vec2f(1,0),vec2f(0,1),vec2f(1,1))[i];
 let local=box.xy+uv*box.zw;
 let q=vec2f(matrix0.x*local.x+matrix0.z*local.y+matrix1.x,matrix0.y*local.x+matrix0.w*local.y+matrix1.y)/canvas.xy;
 return V(vec4f(q.x*2-1,1-q.y*2,0,1),uv,box,color,canvas,stroke,extra);
}
@fragment fn shape(v:V)->@location(0) vec4f {
 let p=P(v.box,v.color,v.canvas,vec4f(0),vec4f(0),v.stroke,v.extra);${shapeBody}
}`
const INSTANCE_LAYOUT = { arrayStride: 112, stepMode: 'instance', attributes: Array.from({ length: 7 }, (_, index) => ({ shaderLocation: index, offset: index * 16, format: 'float32x4' })) }
/** v3 tree compositor. GPU resources are allocated through the original resident-byte owner. */
export class VideoEditCodeGpuV3 {
  recordedAt = 0
  completedAt = 0
  private readonly pipelines = new Map<string, GpuRenderPipeline>()
  private readonly cached = new Map<string, CachedImage>()
  private readonly layers = new Map<string, CachedImage>()
  private readonly scratch: (CachedImage & { busy: boolean })[] = []
  private readonly uniforms: { buffer: GpuBuffer; data: Float32Array; start: number; end: number }[] = []
  private readonly glyphResults = new Map<string, { signature: string; image: CachedImage; used: boolean }>()
  private readonly instanceBuffers: { buffer: GpuBuffer; data: Float32Array }[] = []
  private instanceIndex = 0
  private readonly openPasses = new WeakMap<Encoder, { target: GpuTexture; pass: ReturnType<Encoder['beginRenderPass']> }>()
  private cachedBytes = 0; private uniformIndex = 0
  private motionIndex = 0
  private motionPixelSamples = 0
  private readonly motionUniforms: GpuBuffer[] = []
  private module: unknown; private sampler: unknown; private ready: Promise<void>
  private disposed = false
  private rendering = false
  private recording?: Encoder
  private recordingDirty = false
  private flushRecording?: () => void
  private readonly retired: CachedImage[] = []
  private ownGraphs?: ShaderGraphCache
  private vectors?: CodeVectorGpu
  private readonly frames = new WeakMap<GpuTexture, string>()
  private readonly frameProbes = new WeakMap<GpuTexture, CodeReuseProbe>()
  private readonly groupProbes = new WeakMap<GpuTexture, Map<string, CodeReuseProbe>>()
  private readonly groupSignatures = new WeakMap<GpuTexture, Map<string, string>>()
  readonly reuse = { culledDraws: 0, frameHits: 0, subtreeHits: 0, subtreeMisses: 0 }
  readonly drawCosts: Array<CodeHeavyStructure & { gpuMs: number }> = []
  readonly counts = { uploads: 0, allocations: 0, submissions: 0, passes: 0 }
  constructor(private readonly device: GpuDevice, private readonly allocator: Allocator, private readonly rasterize: (command: CodeDrawCommand, image: Omit<Image, 'texture'>) => OffscreenCanvas | Promise<OffscreenCanvas> = rasterizeCodeShape, private graphs?: () => ShaderGraphCache, private readonly nativeVectors = true) {
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
    this.ready = this.prepare()
  }
  private async prepare(): Promise<void> {
    const started = performance.now()
    const pending: Promise<void>[] = []
    const pipeline = (key: string, descriptor: unknown): void => {
      const ready = this.device.createRenderPipelineAsync?.(descriptor) ?? Promise.resolve(this.device.createRenderPipeline(descriptor))
      pending.push(ready.then(value => { this.pipelines.set(key, value) }))
    }
    this.device.pushErrorScope('validation')
    try {
      this.module = this.device.createShaderModule({ code: shader })
      for (const entry of ['shape', 'textured', 'composite', 'effects', 'tint', 'bright', 'masked']) pipeline(entry, { layout: 'auto', vertex: { module: this.module, entryPoint: 'vs' }, fragment: { module: this.module, entryPoint: entry, targets: [{ format: 'rgba8unorm', ...(['shape', 'textured', 'tint'].includes(entry) ? { blend: normalBlend } : {}) }] }, primitive: { topology: 'triangle-list' } })
      const instanced = this.device.createShaderModule({ code: instanceShader })
      const motion = this.device.createShaderModule({ code: CODE_MOTION_WGSL })
      pipeline('motion', { layout: 'auto', vertex: { module: motion, entryPoint: 'vs' }, fragment: { module: motion, entryPoint: 'motion', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } })
      pipeline('instances', { layout: 'auto', vertex: { module: instanced, entryPoint: 'vs', buffers: [INSTANCE_LAYOUT] }, fragment: { module: instanced, entryPoint: 'shape', targets: [{ format: 'rgba8unorm', blend: normalBlend }] }, primitive: { topology: 'triangle-list' } })
      if (this.nativeVectors) { this.vectors = new CodeVectorGpu(this.device, true); pending.push(this.vectors.ready) }
      const diffusion = this.device.createShaderModule({ code: diffusionSource })
      for (const entry of ['fragment_scatter_downsample', 'fragment_scatter_upsample']) pipeline(entry, { layout: 'auto', vertex: { module: diffusion, entryPoint: 'vertex_main' }, fragment: { module: diffusion, entryPoint: entry, targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } })
      await Promise.all(pending)
    } catch (error) {
      const validation = await this.device.popErrorScope().catch(() => null)
      if (validation) throw new CodeMaterialError('CONTEXT', `v3 GPU 管线失败：${validation.message}`)
      throw error
    }
    recordVideoEditPreparation('codePipelines', performance.now() - started)
    const error = await this.device.popErrorScope(); if (error) throw new CodeMaterialError('CONTEXT', `v3 GPU 管线失败：${error.message}`)
  }
  private uniform(data: number[]): { buffer: GpuBuffer; offset: number; size: number } {
    // WebGPU uniform offsets are 256-byte aligned. Upload one arena range per
    // submission, instead of a queue.writeBuffer for every glyph/filter pass.
    const index = this.uniformIndex++; const slot = index % 256
    const arena = this.uniforms[Math.floor(index / 256)] ??= { buffer: this.device.createBuffer({ size: 65536, usage: 0x08 | 0x40 }), data: new Float32Array(16384), start: 16384, end: 0 }
    const offset = slot * 64; arena.data.set(data, offset)
    arena.start = Math.min(arena.start, offset); arena.end = Math.max(arena.end, offset + data.length)
    return { buffer: arena.buffer, offset: slot * 256, size: 112 }
  }
  private image(width: number, height: number, x = 0, y = 0): CachedImage {
    const bytes = width * height * 4
    // Retired textures are still referenced by the encoder. Submit before
    // asking the resident-byte owner for more memory under pressure.
    if (this.retired.length && !(this.allocator.canRetain?.(bytes) ?? true)) this.flushRecording?.()
    this.counts.allocations++
    return { texture: this.allocator.allocate(width, height), width, height, x, y, bytes, used: true }
  }
  private release(image: CachedImage): void {
    if (this.recording) this.retired.push(image)
    else this.allocator.release(image.texture)
  }
  private encoder(): Encoder { return this.recording ?? this.device.createCommandEncoder() }
  private pruneScratch(): void {
    let bytes = this.scratch.reduce((sum, image) => sum + image.bytes, 0)
    // Keep the current working set hot; animated raster sizes cannot accumulate forever.
    for (let i = 0; i < this.scratch.length && bytes > 32 * 1024 ** 2;) {
      const image = this.scratch[i]
      if (image.busy) { i++; continue }
      this.release(image); bytes -= image.bytes; this.scratch.splice(i, 1)
    }
  }
  private layer(key: string, width: number, height: number, x = 0, y = 0): CachedImage {
    let image = this.layers.get(key)
    if (image && (image.width !== width || image.height !== height)) { this.release(image); this.layers.delete(key); image = undefined }
    if (!image) { image = this.image(width, height, x, y); this.layers.set(key, image) }
    image.x = x; image.y = y; image.used = true; return image
  }
  private dropGlyphLayer(key: string, image: CachedImage): void {
    this.release(image); this.layers.delete(key)
    for (const [path, result] of this.glyphResults) if (result.image === image) this.glyphResults.delete(path)
  }
  private pruneGlyphLayers(): void {
    const entries = [...this.layers].filter(([key]) => key.startsWith('glyph:'))
    const final = new Set([...this.glyphResults.values()].map(result => result.image))
    let retained = this.cachedBytes + entries.reduce((sum, [, image]) => sum + image.bytes, 0)
    // Intermediates are reusable working storage, not a second unbounded cache.
    // Prefer the final glyph when trimming the original 48 MiB retention budget.
    entries.sort((a, b) => Number(final.has(a[1])) - Number(final.has(b[1])))
    for (const [key, image] of entries) {
      if (retained <= 48 * 1024 ** 2 && (this.allocator.canRetain?.(0) ?? true)) break
      this.dropGlyphLayer(key, image); retained -= image.bytes
    }
  }
  private close(encoder: Encoder): void { const open = this.openPasses.get(encoder); if (open) { open.pass.end(); this.openPasses.delete(encoder) } }
  private pass(encoder: Encoder, target: Image): ReturnType<Encoder['beginRenderPass']> {
    const open = this.openPasses.get(encoder)
    if (open?.target === target.texture) return open.pass
    this.close(encoder)
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.texture.createView(), loadOp: 'load', storeOp: 'store' }] })
    this.openPasses.set(encoder, { target: target.texture, pass }); this.counts.passes++; return pass
  }
  private submit(encoder: Encoder): void {
    this.close(encoder)
    if (encoder === this.recording) { this.recordingDirty = true; return }
    for (const arena of this.uniforms) if (arena.end > arena.start) {
      this.device.queue.writeBuffer(arena.buffer, arena.start * 4, arena.data.subarray(arena.start, arena.end))
      arena.start = arena.data.length; arena.end = 0
    }
    this.device.queue.submit([encoder.finish()]); this.counts.submissions++
    for (const image of this.retired) this.allocator.release(image.texture)
    this.retired.length = 0
  }
  private clear(encoder: Encoder, image: Image): void {
    this.close(encoder)
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: image.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
    this.openPasses.set(encoder, { target: image.texture, pass }); this.counts.passes++
  }
  private paint(encoder: Encoder, target: Image, box: Image | { x: number; y: number; width: number; height: number }, matrix: CodeMatrix, opacity: number, entry: string, color: CodeColor = [1, 1, 1, 1], extra: number[] = [0, 0, 0, 1], stroke: CodeColor = [0, 0, 0, 0], background?: Image): void {
    const pipeline = this.pipelines.get(entry)!
    const uniform = this.uniform([box.x, box.y, box.width, box.height, ...color, target.width, target.height, opacity, 0, ...matrix.slice(0, 4), matrix[4], matrix[5], 0, 0, ...stroke, ...extra])
    const entries: { binding: number; resource: unknown }[] = [{ binding: 0, resource: uniform }]
    if ('texture' in box) entries.push({ binding: 1, resource: box.texture.createView() }, { binding: 2, resource: this.sampler })
    if (background) entries.push({ binding: 3, resource: background.texture.createView() })
    const pass = this.pass(encoder, target)
    pass.setPipeline(pipeline); pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6)
  }
  private motion(encoder: Encoder, image: Image, target: Image, parent: CodeMatrix, samples: readonly CodeMotionSample[], key: string): Image | undefined {
    const prepared = prepareCodeMotion(image, parent, samples, target.width, target.height, CODE_MOTION_PIXEL_SAMPLE_BUDGET - this.motionPixelSamples)
    if (!prepared) return undefined
    this.motionPixelSamples += prepared.pixelSamples
    const { bounds, data } = prepared
    const output = this.layer(`${key}:motion`, bounds.width, bounds.height, bounds.x, bounds.y)
    const index = this.motionIndex++
    const buffer = this.motionUniforms[index] ??= this.device.createBuffer({ size: CODE_MOTION_UNIFORM_BYTES, usage: 0x08 | 0x40 })
    this.device.queue.writeBuffer(buffer, 0, data)
    const pipeline = this.pipelines.get('motion')!
    this.clear(encoder, output)
    const pass = this.pass(encoder, output)
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [
      { binding: 0, resource: { buffer, offset: 0, size: CODE_MOTION_UNIFORM_BYTES } },
      { binding: 1, resource: image.texture.createView() }, { binding: 2, resource: this.sampler },
    ] }))
    pass.draw(6)
    return output
  }
  private instances(encoder: Encoder, target: Image, shapes: { command: Extract<CodeDrawCommand, { kind: 'rect' | 'ellipse' }>; matrix: CodeMatrix; opacity: number }[]): void {
    if (!shapes.length) return
    const index = this.instanceIndex++; let entry = this.instanceBuffers[index]
    if (!entry || entry.data.length < shapes.length * 28) {
      entry?.buffer.destroy(); const data = new Float32Array(2 ** Math.ceil(Math.log2(shapes.length)) * 28)
      entry = { buffer: this.device.createBuffer({ size: data.byteLength, usage: 0x08 | 0x20 }), data }; this.instanceBuffers[index] = entry
    }
    shapes.forEach(({ command, matrix, opacity }, i) => {
      const color = Array.isArray(command.paint) ? command.paint : command.fill
      entry!.data.set([command.x, command.y, command.width, command.height, ...color, target.width, target.height, opacity, 0, ...matrix.slice(0, 4), matrix[4], matrix[5], 0, 0, 0, 0, 0, 0, command.kind === 'rect' ? command.radius : 0, command.kind === 'ellipse' ? 1 : 0, 0, 0], i * 28)
    })
    this.device.queue.writeBuffer(entry.buffer, 0, entry.data.subarray(0, shapes.length * 28))
    const pipeline = this.pipelines.get('instances')!; const pass = this.pass(encoder, target)
    pass.setPipeline(pipeline)
    const instancedPass = pass as unknown as { setVertexBuffer(slot: number, buffer: GpuBuffer): void; draw(vertices: number, instances: number): void }
    instancedPass.setVertexBuffer(0, entry.buffer); instancedPass.draw(6, shapes.length)
  }
  private async blur(source: Image, radius: number): Promise<{ image: Image; release: () => void }> {
    if (radius <= 0) return { image: source, release: () => {} }
    // Reuse the exact positive-weight adjacent-texel pyramid used by 辉光PRO. No sparse large-radius kernel.
    const count = Math.max(1, Math.min(8, Math.ceil(Math.log2(radius + 1))))
    const result = await renderScatterPyramid({ device: this.device, sampler: this.sampler, downsamplePipeline: this.pipelines.get('fragment_scatter_downsample')!, upsamplePipeline: this.pipelines.get('fragment_scatter_upsample')!, source: source.texture, width: source.width, height: source.height,
      recording: this.recording ? {
        uniform: values => this.uniform(Array.from(values)),
        pass: (pipeline, entries, texture) => {
          const encoder = this.recording!; this.close(encoder)
          const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store' }] })
          pass.setPipeline(pipeline); pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6); pass.end(); this.counts.passes++
        },
      } : undefined,
      levels: Array.from({ length: count }, (_, i) => ({ divisor: 2 ** (i + 1), weight: [1 / count, 1 / count, 1 / count] as const })),
      acquireTexture: (width, height) => {
        let entry = this.scratch.find(image => !image.busy && image.width === width && image.height === height)
        if (!entry) { entry = { ...this.image(width, height), busy: true }; this.scratch.push(entry) }
        entry.busy = true; return entry.texture
      }, releaseTexture: texture => { const entry = this.scratch.find(image => image.texture === texture); if (entry) entry.busy = false } })
    return { image: { ...source, texture: result.scales[0] }, release: () => { result.textures.forEach(texture => { const entry = this.scratch.find(image => image.texture === texture); if (entry) entry.busy = false }); this.pruneScratch() } }
  }
  async filterBlur(texture: GpuTexture, width: number, height: number, radius: number, threshold?: number): Promise<{ texture: GpuTexture; release: () => void }> {
    await this.ready; if (this.disposed) throw new CodeMaterialError('CONTEXT', 'v3 渲染器已释放。')
    // Each primitive submits before returning: queue writes may safely reuse its small uniform set.
    this.uniformIndex = 0
    let source: Image = { texture, width, height, x: 0, y: 0 }; let bright: CachedImage | undefined
    if (threshold !== undefined) {
      if (threshold < 0 || threshold > 1) throw new CodeMaterialError('PARAMETERS', 'glow 阈值须为 0–1。')
      bright = this.image(width, height); const encoder = this.device.createCommandEncoder(); this.clear(encoder, bright); this.paint(encoder, bright, source, CODE_IDENTITY, 1, 'bright', [0, 0, 0, threshold]); this.submit(encoder); source = bright
    }
    try {
      const result = await this.blur(source, radius)
      return { texture: result.image.texture, release: () => { result.release(); if (bright) this.release(bright) } }
    } catch (error) { if (bright) this.release(bright); throw error }
  }
  private async effects(image: Image, command: CodeDrawCommand, key: string): Promise<Image> {
    let current = image
    const temporaries: (() => void)[] = []
    try {
      if (command.blur) {
        const blurred = await this.blur(current, command.blur); temporaries.push(blurred.release)
        const target = this.layer(`${key}:blur`, image.width, image.height, image.x, image.y); const encoder = this.encoder(); this.clear(encoder, target)
        this.paint(encoder, target, { ...blurred.image, x: 0, y: 0 }, CODE_IDENTITY, 1, 'textured'); this.submit(encoder); current = target
      }
      if (command.shadow) {
        const blurred = await this.blur(current, command.shadow.blur); temporaries.push(blurred.release)
        const target = this.layer(`${key}:shadow`, image.width, image.height, image.x, image.y); const encoder = this.encoder(); this.clear(encoder, target)
          const shadow = command.shadow
          this.paint(encoder, target, { ...blurred.image, x: shadow.x, y: shadow.y }, CODE_IDENTITY, 1, 'tint', shadow.color)
          this.paint(encoder, target, { ...current, x: 0, y: 0 }, CODE_IDENTITY, 1, 'textured')
        this.submit(encoder); current = target
      }
      if (command.glow) {
        const blurred = await this.blur(current, command.glow.radius); temporaries.push(blurred.release)
        const target = this.layer(`${key}:glow`, image.width, image.height, image.x, image.y); const encoder = this.encoder(); this.clear(encoder, target)
        this.paint(encoder, target, { ...blurred.image, x: 0, y: 0 }, CODE_IDENTITY, 1, 'effects', [...command.glow.color.slice(0, 3), command.glow.color[3] * command.glow.intensity] as CodeColor, [0, 0, 0, 1], [0, 0, 0, 0], current)
        this.submit(encoder); current = target
      }
      return current
    } finally { temporaries.forEach(release => release()) }
  }
  private async raster(command: CodeDrawCommand, matrix: CodeMatrix, sourcePadding?: number): Promise<Image> {
    const position = command.kind === 'text' ? { x: command.x, y: command.y } : { x: 0, y: 0 }
    if (command.kind === 'text') {
      const localPaint = (paint: CodePaint | undefined): CodePaint | undefined => !paint || Array.isArray(paint) ? paint : { ...paint, ...(paint.kind === 'linearGradient' ? { x1: paint.x1! - position.x, y1: paint.y1! - position.y, x2: paint.x2! - position.x, y2: paint.y2! - position.y } : { cx: paint.cx! - position.x, cy: paint.cy! - position.y }) }
      command = { ...command, x: 0, y: 0, paint: localPaint(command.paint), stroke: localPaint(command.stroke) }
    }
    // Largest singular value includes nested rotation, non-uniform scale and shear.
    const [a, b, c, d] = matrix; const trace = a * a + b * b + c * c + d * d; const determinant = a * d - b * c
    const resolution = command.kind === 'text' ? videoEditTextResolution(Math.sqrt((trace + Math.sqrt(Math.max(0, trace * trace - 4 * determinant * determinant))) / 2)) : 1
    const box = codeLocalBounds(command)
    const padding = sourcePadding ?? Math.ceil(Math.max(command.strokeWidth ?? 0, command.kind === 'line' ? command.width : 0) / 2 + Math.max(command.blur ?? 0, command.glow?.radius ?? 0, command.shadow?.blur ?? 0) * 4 + Math.max(Math.abs(command.shadow?.x ?? 0), Math.abs(command.shadow?.y ?? 0)) + 2)
    const dimensions = { x: Math.floor(box.x - padding), y: Math.floor(box.y - padding), width: Math.max(1, Math.ceil(box.width + padding * 2)), height: Math.max(1, Math.ceil(box.height + padding * 2)) }
    const { elementId: _id, elementPath: _path, sourceSpan: _span, opacity: _opacity, rotation: _rotation, scaleX: _sx, scaleY: _sy, anchorX: _ax, anchorY: _ay, blend: _blend, skewX: _kx, skewY: _ky, elementTransform: _transform, ...content } = command
    void _id; void _path; void _span; void _opacity; void _rotation; void _sx; void _sy; void _ax; void _ay; void _blend; void _kx; void _ky; void _transform
    const positioned = 'x' in content && 'y' in content && (!command.paint || Array.isArray(command.paint)) && (!command.stroke || Array.isArray(command.stroke))
    const key = JSON.stringify([positioned ? { ...content, x: 0, y: 0 } : content, command.kind === 'text' ? documentFontRevision() : 0, resolution, sourcePadding])
    const placed = (image: Image): Image => ({ ...image, width: image.width / resolution, height: image.height / resolution, x: dimensions.x + position.x, y: dimensions.y + position.y })
    const cached = this.cached.get(key)
    if (cached) { cached.used = true; this.cached.delete(key); this.cached.set(key, cached); return placed(cached) }
    const bytes = dimensions.width * dimensions.height * resolution * resolution * 4
    while (this.cachedBytes + bytes > 48 * 1024 ** 2 && this.cached.size) {
      const oldest = [...this.cached].find(([, value]) => !value.used); if (!oldest) break
      this.release(oldest[1]); this.cachedBytes -= oldest[1].bytes; this.cached.delete(oldest[0])
    }
    const transientGlyph = this.recording && command.kind === 'text' && sourcePadding === undefined && (command.blur || command.glow || command.shadow)
    const layerKey = transientGlyph ? `glyph:${command.elementPath?.join('/') ?? command.elementId ?? key}` : `raster:${key}`
    const previousGlyph = transientGlyph ? this.glyphResults.get(layerKey) : undefined
    if (previousGlyph?.signature === key) { previousGlyph.used = true; previousGlyph.image.used = true; return placed(previousGlyph.image) }
    if (transientGlyph) this.glyphResults.delete(layerKey)
    const glyphPadding = 2 ** Math.ceil(Math.log2(padding))
    const glyphWidth = Math.ceil(box.width + glyphPadding * 2) * resolution
    const glyphHeight = Math.ceil(box.height + glyphPadding * 2) * resolution
    const retainSource = transientGlyph && glyphWidth <= 8192 && glyphHeight <= 8192 && (this.allocator.canRetain?.(glyphWidth * glyphHeight * 4) ?? true)
    const raw = transientGlyph
      ? this.layer(`${layerKey}:source`, dimensions.width * resolution, dimensions.height * resolution, dimensions.x * resolution, dimensions.y * resolution)
      : this.image(dimensions.width * resolution, dimensions.height * resolution, dimensions.x * resolution, dimensions.y * resolution)
    raw.glyph = command.kind === 'text'
    try {
      if (retainSource && command.kind === 'text') {
        // Radius changes must not rerasterize the glyph. A larger integer-aligned
        // source is cropped into the EXACT old effect extent before filtering.
        // Padding buckets also preserve ink overhangs outside measured advances.
        const source = await this.raster({ ...command, blur: undefined, glow: undefined, shadow: undefined }, matrix, glyphPadding)
        const encoder = this.encoder(); this.clear(encoder, raw)
        this.paint(encoder, raw, { ...source, x: (source.x - dimensions.x) * resolution, y: (source.y - dimensions.y) * resolution, width: source.width * resolution, height: source.height * resolution }, CODE_IDENTITY, 1, 'textured'); this.submit(encoder)
      } else if (this.vectors && supportsCodeVector(command)) {
        const encoder = this.encoder(); this.clear(encoder, raw)
        this.vectors.draw(this.pass(encoder, raw), raw.width, raw.height, [{ command, matrix: [1, 0, 0, 1, -raw.x, -raw.y], opacity: 1 }]); this.submit(encoder)
      } else {
        const rasterStarted = performance.now()
        const canvas = await this.rasterize(command, { ...dimensions, resolution })
        recordVideoEditPreparation(command.kind === 'text' ? 'glyphRaster' : 'shapeRaster', performance.now() - rasterStarted)
        this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture: raw.texture, premultipliedAlpha: true }, [raw.width, raw.height]); this.counts.uploads++
      }
      const appearance = resolution === 1 ? command : { ...command, blur: (command.blur ?? 0) * resolution, ...(command.glow ? { glow: { ...command.glow, radius: command.glow.radius * resolution } } : {}), ...(command.shadow ? { shadow: { ...command.shadow, x: command.shadow.x * resolution, y: command.shadow.y * resolution, blur: command.shadow.blur * resolution } } : {}) }
      const effected = await this.effects(raw, appearance, layerKey)
      if (transientGlyph) {
        this.glyphResults.set(layerKey, { signature: key, image: effected as CachedImage, used: true })
        return placed(effected)
      }
      // Cache only the final texture, never one scratch layer for every historical radius/paint value.
      if (effected !== raw) {
        const final = this.image(raw.width, raw.height, raw.x, raw.y); const encoder = this.encoder(); this.clear(encoder, final); this.paint(encoder, final, { ...effected, x: 0, y: 0 }, CODE_IDENTITY, 1, 'textured'); this.submit(encoder); this.release(raw)
        final.glyph = raw.glyph; this.cached.set(key, final); this.cachedBytes += final.bytes; return placed(final)
      }
      this.cached.set(key, raw); this.cachedBytes += raw.bytes; return placed(raw)
    } catch (error) { if (!transientGlyph) this.release(raw); throw error }
  }
  /** 着色器图层：优先用宿主共享的会话缓存（与效果、转场同一份），独立使用时自建。 */
  private shaderGraphs(): ShaderGraphCache { return this.graphs?.() ?? (this.ownGraphs ??= new ShaderGraphCache(this.device)) }
  private simple(command: CodeDrawCommand): command is Extract<CodeDrawCommand, { kind: 'rect' | 'ellipse' }> {
    return (command.kind === 'rect' || command.kind === 'ellipse') && !command.shadow && !command.glow && !command.blur && (!command.paint || Array.isArray(command.paint)) && !(command.stroke && command.strokeWidth) && !(command.kind === 'rect' && command.radii)
  }
  private groupBounds(children: readonly CodeDrawCommand[]): { x: number; y: number; width: number; height: number } {
    const containsMotion = (commands: readonly CodeDrawCommand[]): boolean => commands.some(command => command.kind === 'group' && (!!command.motionSamples || containsMotion(command.children)))
    if (containsMotion(children)) {
      // Parent rasters include the complete child exposure, even when the child
      // is transparent/offscreen at the center. Clipping remains group-local.
      const boxes: Array<{ x: number; y: number; width: number; height: number }> = []
      for (const command of children) {
        if (command.kind !== 'group') { boxes.push(this.groupBounds([command])); continue }
        let box = this.groupBounds(command.children)
        const pad = Math.max(command.blur ?? 0, command.glow?.radius ?? 0, command.shadow?.blur ?? 0) * 4 + Math.max(Math.abs(command.shadow?.x ?? 0), Math.abs(command.shadow?.y ?? 0)) + 2
        box = { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
        if (command.clip) {
          const x = Math.max(box.x, command.clip.x), y = Math.max(box.y, command.clip.y)
          box = { x, y, width: Math.max(0, Math.min(box.x + box.width, command.clip.x + command.clip.width) - x), height: Math.max(0, Math.min(box.y + box.height, command.clip.y + command.clip.height) - y) }
        }
        const matrices = command.motionSamples ? command.motionSamples.flatMap(sample => sample.pose && sample.pose.opacity > 0 && sample.weight > 0 ? [sample.pose.matrix] : []) : [codeTransform(command)]
        for (const matrix of matrices) {
          const points = [[box.x, box.y], [box.x + box.width, box.y], [box.x, box.y + box.height], [box.x + box.width, box.y + box.height]].map(([x, y]) => codePoint(matrix, x, y))
          const x = Math.min(...points.map(point => point[0])), y = Math.min(...points.map(point => point[1]))
          boxes.push({ x, y, width: Math.max(...points.map(point => point[0])) - x, height: Math.max(...points.map(point => point[1])) - y })
        }
      }
      if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 }
      const x = Math.min(...boxes.map(box => box.x)), y = Math.min(...boxes.map(box => box.y))
      return { x, y, width: Math.max(...boxes.map(box => box.x + box.width)) - x, height: Math.max(...boxes.map(box => box.y + box.height)) - y }
    }
    // Flat vector batches need a union, not an element-inspection tree with four transformed
    // corners, source paths and intermediate arrays per primitive. Keep the general path below
    // for nesting, text, effects and transforms; the padding arithmetic is the same as geometry.ts.
    if (this.vectors && children.length && children.every(command => isCodeVector(command) && identityPrimitive(command) && !command.blur && !command.glow && !command.shadow)) {
      let left = Infinity; let top = Infinity; let right = -Infinity; let bottom = -Infinity
      for (const command of children) {
        const box = codeLocalBounds(command)
        const padding = command.kind === 'line' ? command.width / 2 : command.stroke ? (command.strokeWidth ?? 0) / 2 : 0
        const x = box.x - padding; const y = box.y - padding
        left = Math.min(left, x); top = Math.min(top, y)
        right = Math.max(right, x + (box.width + padding * 2)); bottom = Math.max(bottom, y + (box.height + padding * 2))
      }
      return { x: left, y: top, width: right - left, height: bottom - top }
    }
    const bounds = codeElementBounds(children).map(element => {
      const command = element.command; const m = element.matrix; const scale = Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]))
      const glyphPad = command.kind === 'text' ? Math.max(0, ...(command.perChar ?? []).map(char => Math.max(char.blur ?? command.blur ?? 0, char.glow?.radius ?? command.glow?.radius ?? 0) * Math.abs(char.scale))) : 0
      const pad = (Math.max(glyphPad, command.blur ?? 0, command.glow?.radius ?? 0, command.shadow?.blur ?? 0) * 4 + Math.max(Math.abs(command.shadow?.x ?? 0), Math.abs(command.shadow?.y ?? 0))) * scale
      return { x: element.x - pad, y: element.y - pad, width: element.width + pad * 2, height: element.height + pad * 2 }
    })
    if (!bounds.length) return { x: 0, y: 0, width: 0, height: 0 }
    const x = Math.min(...bounds.map(box => box.x)); const y = Math.min(...bounds.map(box => box.y))
    return { x, y, width: Math.max(...bounds.map(box => box.x + box.width)) - x, height: Math.max(...bounds.map(box => box.y + box.height)) - y }
  }
  /** Prepare typography and pipelines only; no frame target, presentation or time advancement. */
  async prepareContent(commands: readonly CodeDrawCommand[], current: () => boolean): Promise<void> {
    await this.ready
    this.cached.forEach(value => { value.used = false })
    const visit = async (command: CodeDrawCommand, parent: CodeMatrix): Promise<void> => {
      if (!current()) throw new DOMException('旧内容预热已取消。', 'AbortError')
      const matrix = codeMultiply(parent, codeTransform(command))
      if (command.kind === 'group') {
        // Children rasterize in a local group surface in the production renderer.
        for (const child of command.children) await visit(child, CODE_IDENTITY)
        return
      }
      if (command.kind === 'shader') { await this.shaderGraphs().warm([command.graph]); return }
      if (command.kind !== 'text') return
      if (command.perChar && command.layout) {
        for (let i = 0; i < command.layout.glyphs.length; i++) {
          const transform = command.perChar[i]
          if (!transform.opacity) continue
          await visit(characterCommand(command, i, command.opacity ?? 1, command.elementPath ?? []), codeMultiply(matrix, [1, 0, 0, 1, transform.x, transform.y]))
        }
      } else {
        const padding = command.blur || command.glow || command.shadow
          ? 2 ** Math.ceil(Math.log2(Math.ceil((command.strokeWidth ?? 0) / 2 + Math.max(command.blur ?? 0, command.glow?.radius ?? 0, command.shadow?.blur ?? 0) * 4 + Math.max(Math.abs(command.shadow?.x ?? 0), Math.abs(command.shadow?.y ?? 0)) + 2)))
          : undefined
        await this.raster(padding === undefined ? command : { ...command, blur: undefined, glow: undefined, shadow: undefined }, matrix, padding)
      }
    }
    for (const command of commands) await visit(command, CODE_IDENTITY)
    await this.device.queue.onSubmittedWorkDone()
  }
  async render(texture: GpuTexture, width: number, height: number, commands: readonly CodeDrawCommand[], images?: ReadonlyMap<string, VideoEditCodeImageInput>, profile = false): Promise<void> {
    await this.ready; if (this.disposed) throw new CodeMaterialError('CONTEXT', 'v3 渲染器已释放。')
    Object.assign(this.reuse, { culledDraws: 0, frameHits: 0, subtreeHits: 0, subtreeMisses: 0 }); this.drawCosts.length = 0
    let visual: ReturnType<typeof codeVisualCommands> | undefined
    const visualCommands = (): ReturnType<typeof codeVisualCommands> => visual ??= codeVisualCommands(commands)
    const probe = this.frameProbes.get(texture) ?? new CodeReuseProbe(); this.frameProbes.set(texture, probe)
    const revision = documentFontRevision()
    const signature = codeHasLiveImage(commands) ? undefined : probe.signature([width, height, revision, commands], () => JSON.stringify([width, height, revision, visualCommands().commands]))
    const previous = this.frames.get(texture)
    if (signature && previous === signature) { this.reuse.frameHits++; this.recordedAt = this.completedAt = performance.now(); return }
    // A failed/partial render can never validate the previous contents.
    this.frames.delete(texture)
    const previousGroups = this.groupSignatures.get(texture); const currentGroups = new Map<string, string>()
    const previousProbes = this.groupProbes.get(texture); const currentProbes = new Map<string, CodeReuseProbe>()
    this.uniformIndex = 0; this.instanceIndex = 0; this.motionIndex = 0; this.motionPixelSamples = 0; this.cached.forEach(value => { value.used = false }); this.layers.forEach(value => { value.used = false })
    this.glyphResults.forEach(value => { value.used = false })
    this.vectors?.beginFrame()
    const target: Image = { texture, width, height, x: 0, y: 0 }; let encoder = this.device.createCommandEncoder(); this.clear(encoder, target); let count = 0; let shaderCount = 0
    const shaderResults = new Map<string, Image>()
    let batchTarget: Image | undefined
    const batch: { command: Extract<CodeDrawCommand, { kind: 'rect' | 'ellipse' }>; matrix: CodeMatrix; opacity: number }[] = []
    const vectors: CodeVectorInstance[] = []
    const flushBatch = (): void => {
      if (batchTarget && batch.length) { this.instances(encoder, batchTarget, batch); batch.length = 0 }
      if (batchTarget && vectors.length) { this.vectors!.draw(this.pass(encoder, batchTarget), batchTarget.width, batchTarget.height, vectors); vectors.length = 0 }
      batchTarget = undefined
    }
    const flush = (): void => { flushBatch(); this.submit(encoder); encoder = this.device.createCommandEncoder() }
    // Appending an instance is synchronous. Do not allocate/await a Promise for every vector.
    const draw = (command: CodeDrawCommand, target: Image, parent: CodeMatrix): void | Promise<void> => {
      if (!(command.kind === 'text' && command.perChar) && ++count > CODE_V3_LIMITS.draws) throw new CodeMaterialError('BUDGET', 'GPU 图形超出 4096。')
      // Evaluated primitives normally have identity element transforms. Reuse the parent matrix
      // in that case instead of allocating two matrices and evaluating four trig functions each.
      const identity = this.vectors && identityPrimitive(command)
      const matrix = identity ? parent : codeMultiply(parent, codeTransform(command)); const opacity = command.opacity ?? 1
      if (codeInvisible(command, matrix, target.width, target.height)) { this.reuse.culledDraws++; return }
      if (!this.vectors && this.simple(command) && (!command.blend || command.blend === 'normal')) {
        if (vectors.length || batchTarget && batchTarget.texture !== target.texture) flushBatch()
        batchTarget = target; batch.push({ command, matrix, opacity }); return
      }
      // The previous raster path is sampled in local pixel space before its element transform.
      // Keep that sampling for rotated/scaled/subpixel-translated complex shapes: draw their local
      // layer on GPU, cache it, then use the original texture compositor (no Canvas upload).
      const directVector = this.simple(command) || matrix[0] === 1 && matrix[1] === 0 && matrix[2] === 0 && matrix[3] === 1 && Number.isInteger(matrix[4]) && Number.isInteger(matrix[5])
      if (this.vectors && directVector && (supportsCodeVector(command) || this.simple(command)) && !command.shadow && !command.glow && !command.blur && (!command.blend || command.blend === 'normal')) {
        if (batch.length || batchTarget && batchTarget.texture !== target.texture) flushBatch()
        batchTarget = target; vectors.push({ command, matrix, opacity }); return
      }
      return drawLayer(command, target, matrix, opacity, command.elementPath?.join('/') ?? command.elementId ?? `draw:${count}`, parent)
    }
    const drawLayer = async (command: CodeDrawCommand, target: Image, matrix: CodeMatrix, opacity: number, key: string, parent: CodeMatrix): Promise<void> => {
      flushBatch()
      if (command.kind === 'text' && command.perChar && command.layout) {
        const layout = command.layout
        const glyphPath = command.elementPath ?? [`draw:${count}`]
        this.recording = encoder
        this.recordingDirty = false
        this.flushRecording = () => { this.recording = undefined; flush(); this.recording = encoder; this.recordingDirty = false }
        try {
          for (let i = 0; i < layout.glyphs.length; i++) {
            const transform = command.perChar[i]
            if (!transform.opacity) continue
            const char = characterCommand(command, i, opacity, glyphPath)
            // Animate in a translated parent, keeping the glyph raster identity independent of displacement.
            await draw(char, target, codeMultiply(matrix, [1, 0, 0, 1, transform.x, transform.y]))
            if (this.retired.reduce((sum, image) => sum + image.bytes, 0) > 4 * 1024 ** 2) this.flushRecording()
          }
        } finally {
          this.recording = undefined
          this.flushRecording = undefined
          if (this.recordingDirty || this.retired.length) flush()
          this.recordingDirty = false
        }
        return
      }
      if (command.kind === 'group') {
        // Placement, opacity and blending are applied only when composing the
        // finished layer; moving/fading a static group does not repaint it.
        const probe = previousProbes?.get(key) ?? new CodeReuseProbe(); currentProbes.set(key, probe)
        const fields = (content: typeof command): unknown[] => [revision, content.children, content.clip, content.mask, content.blur, content.shadow, content.glow]
        const exact = codeHasLiveImage([command]) ? undefined : probe.signature(fields(command), () => JSON.stringify(fields(visualCommands().groups.get(command) ?? command)))
        const cacheKey = exact === undefined ? undefined : `subtree:${exact}`
        if (cacheKey) currentGroups.set(key, cacheKey)
        const cached = cacheKey ? this.cached.get(cacheKey) : undefined
        if (cached) { cached.used = true; this.cached.delete(cacheKey!); this.cached.set(cacheKey!, cached); this.reuse.subtreeHits++; await compositeGroup(cached, command, target, parent, matrix, opacity, key); return }
        this.reuse.subtreeMisses++
        const bounds = this.groupBounds(command.children); const pad = Math.ceil(Math.max(command.blur ?? 0, command.glow?.radius ?? 0, command.shadow?.blur ?? 0) * 4 + Math.max(Math.abs(command.shadow?.x ?? 0), Math.abs(command.shadow?.y ?? 0)) + 2)
        const layer = this.layer(`${key}:group`, Math.max(1, Math.ceil(bounds.width + pad * 2)), Math.max(1, Math.ceil(bounds.height + pad * 2)), Math.floor(bounds.x - pad), Math.floor(bounds.y - pad))
        this.clear(encoder, layer)
        const contentParent: CodeMatrix = [1, 0, 0, 1, -layer.x, -layer.y]
        for (const child of command.children) { const pending = draw(child, layer, contentParent); if (pending) await pending }
        flush(); let image = await this.effects(layer, command, key)
        if (command.mask) {
          const mask = this.layer(`${key}:mask`, layer.width, layer.height, layer.x, layer.y)
          this.clear(encoder, mask)
          if (command.mask.shape) await draw(command.mask.shape, mask, [1, 0, 0, 1, -layer.x, -layer.y])
          flushBatch()
          const masked = this.layer(`${key}:masked`, layer.width, layer.height, layer.x, layer.y)
          this.clear(encoder, masked)
          this.paint(encoder, masked, { ...image, x: 0, y: 0 }, CODE_IDENTITY, 1, 'masked', [1, 1, 1, 1], [command.mask.mode === 'luma' ? 1 : 0, command.mask.invert ? 1 : 0, 0, 1], [0, 0, 0, 0], mask)
          flush(); image = masked
        }
        if (command.clip) {
          // Clip the effected layer in group-local coordinates before its transform is composited.
          const clip = command.clip; const clipped = this.layer(`${key}:clip`, Math.max(1, Math.ceil(clip.width)), Math.max(1, Math.ceil(clip.height)), clip.x, clip.y)
          this.clear(encoder, clipped); this.paint(encoder, clipped, { ...image, x: image.x - clip.x, y: image.y - clip.y }, CODE_IDENTITY, 1, 'textured'); flush()
          image = clipped
        }
        // Retain only the finished layer. It shares the raster LRU and the
        // allocator's resident-byte budget, never a separate unbounded pool.
        const bytes = image.width * image.height * 4
        if (cacheKey && previousGroups?.get(key) === cacheKey && bytes <= 48 * 1024 ** 2) {
          while (this.cachedBytes + bytes > 48 * 1024 ** 2) {
            const oldest = [...this.cached].find(([, value]) => !value.used)
            if (!oldest) break
            this.release(oldest[1]); this.cachedBytes -= oldest[1].bytes; this.cached.delete(oldest[0])
          }
          if (this.cachedBytes + bytes <= 48 * 1024 ** 2 && (this.allocator.canRetain?.(bytes) ?? true)) {
            const saved = this.image(image.width, image.height, image.x, image.y)
            this.clear(encoder, saved); this.paint(encoder, saved, { ...image, x: 0, y: 0 }, CODE_IDENTITY, 1, 'textured'); flush()
            this.cached.set(cacheKey, saved); this.cachedBytes += bytes
          }
        }
        await compositeGroup(image, command, target, parent, matrix, opacity, key)
        return
      }
      if (command.kind === 'shader') {
        if (++shaderCount > CODE_V3_LIMITS.shaderLayers) throw new CodeMaterialError('BUDGET', 'GPU 着色器层超出单帧预算。', command.sourceSpan)
        if (!command.width || !command.height) return
        const width = Math.max(1, Math.ceil(command.width)); const height = Math.max(1, Math.ceil(command.height))
        const signature = JSON.stringify([command.graph, command.time, width, height])
        let image = shaderResults.get(signature)
        if (!image) {
          flush()
          const output = this.layer(`shader:result:${shaderResults.size}`, width, height)
          try { await this.shaderGraphs().render(command.graph, { timeSeconds: command.time, width, height, output: output.texture, outputFormat: 'rgba8unorm' }, { input: false }) }
          catch (error) { throw codeShaderFailure(error, command.graph, command.sourceSpan) }
          image = output; shaderResults.set(signature, output)
        }
        await composite({ ...image, x: command.x, y: command.y, width: command.width, height: command.height }, target, matrix, opacity, command.blend ?? 'normal', key)
        return
      }
      if (command.kind === 'image') {
        const image = images?.get(command.source.mediaId)
        if (!image || image.owner !== this.device || image.texture === texture) throw new CodeMaterialError('CONTEXT', '图片输入缺失、设备不一致或输入输出重叠。')
        if (!command.shadow && !command.glow && !command.blur && (!command.blend || command.blend === 'normal')) {
          this.paint(encoder, target, { texture: image.texture, x: command.x, y: command.y, width: command.width, height: command.height }, matrix, opacity, 'textured', [1, 1, 1, 1], [0, 0, 0, image.premultiplied ? 1 : 0]); return
        }
        const pad = Math.ceil(Math.max(command.blur ?? 0, command.glow?.radius ?? 0, command.shadow?.blur ?? 0) * 4 + Math.max(Math.abs(command.shadow?.x ?? 0), Math.abs(command.shadow?.y ?? 0)) + 2)
        const layer = this.layer(`${key}:image`, Math.max(1, Math.ceil(command.width + pad * 2)), Math.max(1, Math.ceil(command.height + pad * 2)), command.x - pad, command.y - pad)
        this.clear(encoder, layer); this.paint(encoder, layer, { texture: image.texture, x: pad, y: pad, width: command.width, height: command.height }, CODE_IDENTITY, 1, 'textured', [1, 1, 1, 1], [0, 0, 0, image.premultiplied ? 1 : 0]); flush()
        await composite(await this.effects(layer, command, key), target, matrix, opacity, command.blend ?? 'normal', key); return
      }
      const raster = await this.raster(command, matrix); await composite(raster, target, matrix, opacity, command.blend ?? 'normal', key)
    }
    const compositeGroup = async (image: Image, command: Extract<CodeDrawCommand, { kind: 'group' }>, target: Image, parent: CodeMatrix, matrix: CodeMatrix, opacity: number, key: string): Promise<void> => {
      if (!command.motionSamples) { await composite(image, target, matrix, opacity, command.blend ?? 'normal', key); return }
      const exposure = this.motion(encoder, image, target, parent, command.motionSamples, key)
      if (exposure) await composite(exposure, target, CODE_IDENTITY, 1, command.blend ?? 'normal', key)
    }
    const composite = async (image: Image, target: Image, matrix: CodeMatrix, opacity: number, mode: CodeBlend, key: string): Promise<void> => {
      if (mode === 'normal') { this.paint(encoder, target, image, matrix, opacity, 'textured'); return }
      const copy = this.layer(`${key}:backdrop`, target.width, target.height); this.clear(encoder, copy)
      this.paint(encoder, copy, { ...target, x: 0, y: 0 }, CODE_IDENTITY, 1, 'textured')
      this.paint(encoder, target, image, matrix, opacity, 'composite', [1, 1, 1, 1], [CODE_BLEND_INDICES[mode], 0, 0, 1], [0, 0, 0, 0], copy)
    }
    this.rendering = true
    try {
      for (const command of commands) {
        const started = performance.now()
        const pending = draw(command, target, CODE_IDENTITY); if (pending) await pending
        if (profile && command.sourceSpan && !codeInvisible(command, codeTransform(command), width, height)) {
          // Attribution must not split vector batches or fence the GPU for every
          // source structure. Frame latency still waits for the queue in the host;
          // these inclusive scopes measure draw preparation, not GPU execution.
          this.drawCosts.push({ kind: command.kind, sourceSpan: command.sourceSpan, cpuMs: 0, gpuMs: performance.now() - started })
        }
      }
      flush()
      this.recordedAt = performance.now()
      if (profile) await this.device.queue.onSubmittedWorkDone()
      this.completedAt = performance.now()
      if (signature) this.frames.set(texture, signature)
      this.groupSignatures.set(texture, currentGroups)
      this.groupProbes.set(texture, currentProbes)
    }
    finally {
      const cleanupStarted = performance.now()
      this.close(encoder)
      this.rendering = false
      for (const [key, layer] of this.layers) if (!layer.used || key.startsWith('raster:')) { this.release(layer); this.layers.delete(key) }
      for (const [key, result] of this.glyphResults) if (!result.used) this.glyphResults.delete(key)
      while (this.motionUniforms.length > this.motionIndex) this.motionUniforms.pop()!.destroy()
      this.pruneGlyphLayers()
      this.ownGraphs?.releaseIdle()
      traceVideoEditFrame('cache.cleanup', -1, cleanupStarted)
      // Buffers are reusable until the next render. Texture ownership remains with the parent's resident-byte budget.
    }
  }
  invalidate(texture: GpuTexture): void { this.frames.delete(texture) }
  /** Return idle optional caches to the owning session before it rejects an
   * allocation. Textures referenced by the current encoder stay protected. */
  evictUnused(bytes: number): void {
    traceVideoEditFrame('cache.evict', -1, performance.now())
    let released = 0
    for (const [key, image] of this.layers) {
      if (!key.startsWith('glyph:') || this.rendering && image.used) continue
      this.dropGlyphLayer(key, image); released += image.bytes
      if (released >= bytes) return
    }
    for (const [key, image] of this.cached) {
      if (this.rendering && image.used) continue
      this.release(image); this.cached.delete(key); this.cachedBytes -= image.bytes; released += image.bytes
      if (released >= bytes) break
    }
  }
  diagnostics(): { cachedBytes: number; cachedImages: number; glyphs: number; layers: number; uniformBytes: number; pipelines: number } { return { cachedBytes: this.cachedBytes, cachedImages: this.cached.size, glyphs: [...this.cached.values()].filter(image => image.glyph).length, layers: this.layers.size, uniformBytes: this.uniforms.length * 65536 + this.motionUniforms.length * CODE_MOTION_UNIFORM_BYTES + this.instanceBuffers.reduce((sum, entry) => sum + entry.data.byteLength, 0) + (this.vectors?.bytes ?? 0), pipelines: this.pipelines.size + (this.vectors ? 2 : 0) } }
  async dispose(): Promise<void> { this.disposed = true; await this.ready.catch(() => {}); await this.device.queue.onSubmittedWorkDone().catch(() => {}); this.cached.forEach(value => this.release(value)); this.layers.forEach(value => this.release(value)); this.scratch.forEach(value => this.release(value)); this.scratch.length = 0; this.retired.forEach(image => this.allocator.release(image.texture)); this.retired.length = 0; this.uniforms.forEach(arena => arena.buffer.destroy()); this.motionUniforms.forEach(buffer => buffer.destroy()); this.motionUniforms.length = 0; this.glyphResults.clear(); this.instanceBuffers.forEach(entry => entry.buffer.destroy()); this.vectors?.dispose(); this.cached.clear(); this.layers.clear(); this.cachedBytes = 0; this.ownGraphs?.dispose() }
}
