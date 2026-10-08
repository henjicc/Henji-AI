import type { GpuBuffer, GpuDevice, GpuRenderPipeline, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { CodeMaterialError, CODE_V3_LIMITS } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeBlend, CodeColor, CodeDrawCommand, CodeMatrix, CodePaint } from '@/core/videoEdit/codeMaterial/contract'
import { CODE_IDENTITY, codeElementBounds, codeLocalBounds, codeMultiply, codeTextBaseBounds, codeTransform, trimCodePath } from '@/core/videoEdit/codeMaterial/geometry'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'
import { ShaderGraphCache } from './shaderEngines/shaderGraphCache'
import { codeShaderFailure } from './shaderEngines/codeShaderFailure'
import diffusionSource from '@/core/imageEdit/shaders/diffusion.wgsl?raw'
import { renderScatterPyramid } from '@/core/imageEdit/webgpu/scatterPyramidRenderer'
import { documentFontRevision } from '@/platform/fontFaces'
import { videoEditTextResolution } from './videoEditTextSurface'

interface Image { texture: GpuTexture; width: number; height: number; x: number; y: number; resolution?: number }
interface CachedImage extends Image { bytes: number; used: boolean; glyph?: boolean }
interface Allocator { allocate(width: number, height: number): GpuTexture; release(texture: GpuTexture): void }
type Encoder = ReturnType<GpuDevice['createCommandEncoder']>
const normalBlend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }
const shader = `
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
 let s=a.rgb/max(a.a,.000001); let d=b.rgb/max(b.a,.000001); var rgb=s;
 if(p.extra.x==1.0) { rgb=s*d; } else if(p.extra.x==2.0) { rgb=s+d-s*d; }
 else if(p.extra.x==3.0) { rgb=select(2.0*s*d,1.0-2.0*(1.0-s)*(1.0-d),d>vec3f(.5)); }
 else if(p.extra.x==4.0) { rgb=min(s+d,vec3f(1)); } else if(p.extra.x==5.0) { rgb=max(s,d); } else if(p.extra.x==6.0) { rgb=min(s,d); }
 return vec4f(a.rgb*(1.0-b.a)+b.rgb*(1.0-a.a)+rgb*a.a*b.a,a.a+b.a-a.a*b.a);
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
const blendNames: CodeBlend[] = ['normal', 'multiply', 'screen', 'overlay', 'add', 'lighten', 'darken']
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
function cssColor(color: CodeColor): string { return `rgba(${color[0] * 255},${color[1] * 255},${color[2] * 255},${color[3]})` }
function canvasPaint(context: OffscreenCanvasRenderingContext2D, paint: CodePaint): string | CanvasGradient {
  if (Array.isArray(paint)) return cssColor(paint)
  const gradient = paint.kind === 'linearGradient' ? context.createLinearGradient(paint.x1!, paint.y1!, paint.x2!, paint.y2!) : context.createRadialGradient(paint.cx!, paint.cy!, 0, paint.cx!, paint.cy!, paint.r!)
  paint.stops.forEach(([offset, color]) => gradient.addColorStop(offset, cssColor(color))); return gradient
}
/** No blur/shadow/filter is run on Canvas. Rasterization is cached and independent of animation transforms. */
export function rasterizeCodeShape(command: CodeDrawCommand, image: Omit<Image, 'texture'>): OffscreenCanvas {
  const canvas = new OffscreenCanvas(Math.ceil(image.width * (image.resolution ?? 1)), Math.ceil(image.height * (image.resolution ?? 1))); const context = canvas.getContext('2d')
  if (!context) throw new CodeMaterialError('CONTEXT', '无法创建代码图形栅格环境。')
  if ((image.resolution ?? 1) !== 1) context.scale(image.resolution!, image.resolution!)
  context.translate(-image.x, -image.y)
  context.fillStyle = canvasPaint(context, command.paint ?? ('fill' in command ? command.fill : 'color' in command ? command.color : [1, 1, 1, 1]))
  if (command.stroke) context.strokeStyle = canvasPaint(context, command.stroke)
  context.lineWidth = command.strokeWidth ?? (command.kind === 'line' ? command.width : 0); context.lineCap = command.lineCap ?? 'butt'; context.lineJoin = command.lineJoin ?? 'miter'
  context.setLineDash(command.dash ?? [])
  if (command.kind === 'text') {
    if (!command.layout) throw new CodeMaterialError('CONTEXT', '文字缺少共享度量。')
    const box = codeLocalBounds(command); context.font = command.layout.font; context.textBaseline = 'alphabetic'; context.textAlign = 'left'
    const lineHeight = command.layout.fontSize * (command.lineHeight ?? 1.2)
    const lineOffset = (row: number): number => {
      const lineWidth = command.layout!.lineWidths?.[row] ?? command.layout!.width
      return command.align === 'center' ? (box.width - lineWidth) / 2 : command.align === 'right' ? box.width - lineWidth : 0
    }
    const baselineOffset = command.layout.baselineOffset ?? lineHeight / 2
    if (command.letterSpacing) {
      command.layout.glyphs.forEach(glyph => { const x = box.x + glyph.x + lineOffset(Math.round(glyph.y / lineHeight)); const y = box.y + glyph.y + baselineOffset; if (command.stroke && command.strokeWidth) context.strokeText(glyph.text, x, y); context.fillText(glyph.text, x, y) })
    } else command.layout.lines.forEach((line, row) => { const y = box.y + row * lineHeight + baselineOffset; const x = box.x + lineOffset(row); if (command.stroke && command.strokeWidth) context.strokeText(line, x, y); context.fillText(line, x, y) })
    return canvas
  }
  context.beginPath()
  if (command.kind === 'rect') context.roundRect(command.x, command.y, command.width, command.height, command.radii ?? command.radius)
  else if (command.kind === 'ellipse') context.ellipse(command.x + command.width / 2, command.y + command.height / 2, command.width / 2, command.height / 2, 0, 0, Math.PI * 2)
  else if (command.kind === 'line' || command.kind === 'path') {
    const paths = command.kind === 'path' ? command.points : [[[command.x1, command.y1], [command.x2, command.y2]] as [number, number][]]
    for (const path of paths) { if (!path.length) continue; context.moveTo(...path[0]); path.slice(1).forEach(point => context.lineTo(...point)); if (command.kind === 'path' && command.closed) context.closePath() }
    if (command.kind === 'path') context.fill()
    context.beginPath()
    for (const path of trimCodePath(paths, command.trimStart, command.trimEnd)) { context.moveTo(...path[0]); path.slice(1).forEach(point => context.lineTo(...point)) }
    if (command.kind === 'line') context.strokeStyle = canvasPaint(context, command.stroke ?? command.color)
    if (command.kind === 'line' || command.stroke && command.strokeWidth) context.stroke()
    return canvas
  } else throw new CodeMaterialError('TYPE', '此图形不能栅格化。')
  context.fill(); if (command.stroke && command.strokeWidth) context.stroke(); return canvas
}

/** v3 tree compositor. GPU resources are allocated through the original resident-byte owner. */
export class VideoEditCodeGpuV3 {
  private readonly pipelines = new Map<string, GpuRenderPipeline>()
  private readonly cached = new Map<string, CachedImage>()
  private readonly layers = new Map<string, CachedImage>()
  private readonly scratch: (CachedImage & { busy: boolean })[] = []
  private readonly uniforms: GpuBuffer[] = []
  private readonly instanceBuffers: { buffer: GpuBuffer; data: Float32Array }[] = []
  private instanceIndex = 0
  private readonly openPasses = new WeakMap<Encoder, { target: GpuTexture; pass: ReturnType<Encoder['beginRenderPass']> }>()
  private cachedBytes = 0; private uniformIndex = 0
  private module: unknown; private sampler: unknown; private ready: Promise<void>
  private disposed = false
  private ownGraphs?: ShaderGraphCache
  readonly counts = { uploads: 0, allocations: 0, submissions: 0, passes: 0 }
  constructor(private readonly device: GpuDevice, private readonly allocator: Allocator, private readonly rasterize: (command: CodeDrawCommand, image: Omit<Image, 'texture'>) => OffscreenCanvas | Promise<OffscreenCanvas> = rasterizeCodeShape, private graphs?: () => ShaderGraphCache) {
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' })
    this.ready = this.prepare()
  }
  private async prepare(): Promise<void> {
    this.device.pushErrorScope('validation')
    try {
      this.module = this.device.createShaderModule({ code: shader })
      for (const entry of ['shape', 'textured', 'composite', 'effects', 'tint', 'bright']) this.pipelines.set(entry, this.device.createRenderPipeline({ layout: 'auto', vertex: { module: this.module, entryPoint: 'vs' }, fragment: { module: this.module, entryPoint: entry, targets: [{ format: 'rgba8unorm', ...(['shape', 'textured', 'tint'].includes(entry) ? { blend: normalBlend } : {}) }] }, primitive: { topology: 'triangle-list' } }))
      const instanced = this.device.createShaderModule({ code: instanceShader })
      this.pipelines.set('instances', this.device.createRenderPipeline({ layout: 'auto', vertex: { module: instanced, entryPoint: 'vs', buffers: [INSTANCE_LAYOUT] }, fragment: { module: instanced, entryPoint: 'shape', targets: [{ format: 'rgba8unorm', blend: normalBlend }] }, primitive: { topology: 'triangle-list' } }))
      const diffusion = this.device.createShaderModule({ code: diffusionSource })
      for (const entry of ['fragment_scatter_downsample', 'fragment_scatter_upsample']) this.pipelines.set(entry, this.device.createRenderPipeline({ layout: 'auto', vertex: { module: diffusion, entryPoint: 'vertex_main' }, fragment: { module: diffusion, entryPoint: entry, targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } }))
    } catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
    const error = await this.device.popErrorScope(); if (error) throw new CodeMaterialError('CONTEXT', `v3 GPU 管线失败：${error.message}`)
  }
  private uniform(data: number[]): GpuBuffer {
    const index = this.uniformIndex++; const buffer = this.uniforms[index] ??= this.device.createBuffer({ size: 112, usage: 0x08 | 0x40 })
    this.device.queue.writeBuffer(buffer, 0, new Float32Array(data)); return buffer
  }
  private image(width: number, height: number, x = 0, y = 0): CachedImage { this.counts.allocations++; return { texture: this.allocator.allocate(width, height), width, height, x, y, bytes: width * height * 4, used: true } }
  private release(image: CachedImage): void { this.allocator.release(image.texture) }
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
  private close(encoder: Encoder): void { const open = this.openPasses.get(encoder); if (open) { open.pass.end(); this.openPasses.delete(encoder) } }
  private pass(encoder: Encoder, target: Image): ReturnType<Encoder['beginRenderPass']> {
    const open = this.openPasses.get(encoder)
    if (open?.target === target.texture) return open.pass
    this.close(encoder)
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.texture.createView(), loadOp: 'load', storeOp: 'store' }] })
    this.openPasses.set(encoder, { target: target.texture, pass }); this.counts.passes++; return pass
  }
  private submit(encoder: Encoder): void { this.close(encoder); this.device.queue.submit([encoder.finish()]); this.counts.submissions++ }
  private clear(encoder: Encoder, image: Image): void { this.close(encoder); const pass = encoder.beginRenderPass({ colorAttachments: [{ view: image.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] }); pass.end(); this.counts.passes++ }
  private paint(encoder: Encoder, target: Image, box: Image | { x: number; y: number; width: number; height: number }, matrix: CodeMatrix, opacity: number, entry: string, color: CodeColor = [1, 1, 1, 1], extra: number[] = [0, 0, 0, 1], stroke: CodeColor = [0, 0, 0, 0], background?: Image): void {
    const pipeline = this.pipelines.get(entry)!
    const uniform = this.uniform([box.x, box.y, box.width, box.height, ...color, target.width, target.height, opacity, 0, ...matrix.slice(0, 4), matrix[4], matrix[5], 0, 0, ...stroke, ...extra])
    const entries: { binding: number; resource: unknown }[] = [{ binding: 0, resource: { buffer: uniform } }]
    if ('texture' in box) entries.push({ binding: 1, resource: box.texture.createView() }, { binding: 2, resource: this.sampler })
    if (background) entries.push({ binding: 3, resource: background.texture.createView() })
    const pass = this.pass(encoder, target)
    pass.setPipeline(pipeline); pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries })); pass.draw(6)
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
        const target = this.layer(`${key}:blur`, image.width, image.height, image.x, image.y); const encoder = this.device.createCommandEncoder(); this.clear(encoder, target)
        this.paint(encoder, target, { ...blurred.image, x: 0, y: 0 }, CODE_IDENTITY, 1, 'textured'); this.submit(encoder); current = target
      }
      if (command.shadow) {
        const blurred = await this.blur(current, command.shadow.blur); temporaries.push(blurred.release)
        const target = this.layer(`${key}:shadow`, image.width, image.height, image.x, image.y); const encoder = this.device.createCommandEncoder(); this.clear(encoder, target)
          const shadow = command.shadow
          this.paint(encoder, target, { ...blurred.image, x: shadow.x, y: shadow.y }, CODE_IDENTITY, 1, 'tint', shadow.color)
          this.paint(encoder, target, { ...current, x: 0, y: 0 }, CODE_IDENTITY, 1, 'textured')
        this.submit(encoder); current = target
      }
      if (command.glow) {
        const blurred = await this.blur(current, command.glow.radius); temporaries.push(blurred.release)
        const target = this.layer(`${key}:glow`, image.width, image.height, image.x, image.y); const encoder = this.device.createCommandEncoder(); this.clear(encoder, target)
        this.paint(encoder, target, { ...blurred.image, x: 0, y: 0 }, CODE_IDENTITY, 1, 'effects', [...command.glow.color.slice(0, 3), command.glow.color[3] * command.glow.intensity] as CodeColor, [0, 0, 0, 1], [0, 0, 0, 0], current)
        this.submit(encoder); current = target
      }
      return current
    } finally { temporaries.forEach(release => release()) }
  }
  private async raster(command: CodeDrawCommand, matrix: CodeMatrix): Promise<Image> {
    const position = command.kind === 'text' ? { x: command.x, y: command.y } : { x: 0, y: 0 }
    if (command.kind === 'text') {
      const localPaint = (paint: CodePaint | undefined): CodePaint | undefined => !paint || Array.isArray(paint) ? paint : { ...paint, ...(paint.kind === 'linearGradient' ? { x1: paint.x1! - position.x, y1: paint.y1! - position.y, x2: paint.x2! - position.x, y2: paint.y2! - position.y } : { cx: paint.cx! - position.x, cy: paint.cy! - position.y }) }
      command = { ...command, x: 0, y: 0, paint: localPaint(command.paint), stroke: localPaint(command.stroke) }
    }
    // Largest singular value includes nested rotation, non-uniform scale and shear.
    const [a, b, c, d] = matrix; const trace = a * a + b * b + c * c + d * d; const determinant = a * d - b * c
    const resolution = command.kind === 'text' ? videoEditTextResolution(Math.sqrt((trace + Math.sqrt(Math.max(0, trace * trace - 4 * determinant * determinant))) / 2)) : 1
    const box = codeLocalBounds(command)
    const padding = Math.ceil(Math.max(command.strokeWidth ?? 0, command.kind === 'line' ? command.width : 0) / 2 + Math.max(command.blur ?? 0, command.glow?.radius ?? 0, command.shadow?.blur ?? 0) * 4 + Math.max(Math.abs(command.shadow?.x ?? 0), Math.abs(command.shadow?.y ?? 0)) + 2)
    const dimensions = { x: Math.floor(box.x - padding), y: Math.floor(box.y - padding), width: Math.max(1, Math.ceil(box.width + padding * 2)), height: Math.max(1, Math.ceil(box.height + padding * 2)) }
    const { elementId: _id, elementPath: _path, sourceSpan: _span, opacity: _opacity, rotation: _rotation, scaleX: _sx, scaleY: _sy, anchorX: _ax, anchorY: _ay, blend: _blend, elementTransform: _transform, ...content } = command
    void _id; void _path; void _span; void _opacity; void _rotation; void _sx; void _sy; void _ax; void _ay; void _blend; void _transform
    const positioned = 'x' in content && 'y' in content && (!command.paint || Array.isArray(command.paint)) && (!command.stroke || Array.isArray(command.stroke))
    const key = JSON.stringify([positioned ? { ...content, x: 0, y: 0 } : content, command.kind === 'text' ? documentFontRevision() : 0, resolution])
    const placed = (image: Image): Image => ({ ...image, width: image.width / resolution, height: image.height / resolution, x: dimensions.x + position.x, y: dimensions.y + position.y })
    const cached = this.cached.get(key)
    if (cached) { cached.used = true; this.cached.delete(key); this.cached.set(key, cached); return placed(cached) }
    const bytes = dimensions.width * dimensions.height * resolution * resolution * 4
    while (this.cachedBytes + bytes > 48 * 1024 ** 2 && this.cached.size) {
      const oldest = [...this.cached].find(([, value]) => !value.used); if (!oldest) break
      this.release(oldest[1]); this.cachedBytes -= oldest[1].bytes; this.cached.delete(oldest[0])
    }
    const canvas = await this.rasterize(command, { ...dimensions, resolution }); const raw = this.image(dimensions.width * resolution, dimensions.height * resolution, dimensions.x * resolution, dimensions.y * resolution); raw.glyph = command.kind === 'text'
    try {
      this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture: raw.texture, premultipliedAlpha: true }, [raw.width, raw.height]); this.counts.uploads++
      const appearance = resolution === 1 ? command : { ...command, blur: (command.blur ?? 0) * resolution, ...(command.glow ? { glow: { ...command.glow, radius: command.glow.radius * resolution } } : {}), ...(command.shadow ? { shadow: { ...command.shadow, x: command.shadow.x * resolution, y: command.shadow.y * resolution, blur: command.shadow.blur * resolution } } : {}) }
      const effected = await this.effects(raw, appearance, `raster:${key}`)
      // Cache only the final texture, never one scratch layer for every historical radius/paint value.
      if (effected !== raw) {
        const final = this.image(raw.width, raw.height, raw.x, raw.y); const encoder = this.device.createCommandEncoder(); this.clear(encoder, final); this.paint(encoder, final, { ...effected, x: 0, y: 0 }, CODE_IDENTITY, 1, 'textured'); this.submit(encoder); this.release(raw)
        final.glyph = raw.glyph; this.cached.set(key, final); this.cachedBytes += final.bytes; return placed(final)
      }
      this.cached.set(key, raw); this.cachedBytes += raw.bytes; return placed(raw)
    } catch (error) { this.release(raw); throw error }
  }
  /** 着色器图层：优先用宿主共享的会话缓存（与效果、转场同一份），独立使用时自建。 */
  private shaderGraphs(): ShaderGraphCache { return this.graphs?.() ?? (this.ownGraphs ??= new ShaderGraphCache(this.device)) }
  private simple(command: CodeDrawCommand): command is Extract<CodeDrawCommand, { kind: 'rect' | 'ellipse' }> {
    return ['rect', 'ellipse'].includes(command.kind) && !command.shadow && !command.glow && !command.blur && (!command.paint || Array.isArray(command.paint)) && !(command.stroke && command.strokeWidth) && !(command.kind === 'rect' && command.radii)
  }
  private groupBounds(children: readonly CodeDrawCommand[]): { x: number; y: number; width: number; height: number } {
    const bounds = codeElementBounds(children).map(element => {
      const command = element.command; const m = element.matrix; const scale = Math.max(Math.hypot(m[0], m[1]), Math.hypot(m[2], m[3]))
      const pad = (Math.max(command.blur ?? 0, command.glow?.radius ?? 0, command.shadow?.blur ?? 0) * 4 + Math.max(Math.abs(command.shadow?.x ?? 0), Math.abs(command.shadow?.y ?? 0))) * scale
      return { x: element.x - pad, y: element.y - pad, width: element.width + pad * 2, height: element.height + pad * 2 }
    })
    if (!bounds.length) return { x: 0, y: 0, width: 0, height: 0 }
    const x = Math.min(...bounds.map(box => box.x)); const y = Math.min(...bounds.map(box => box.y))
    return { x, y, width: Math.max(...bounds.map(box => box.x + box.width)) - x, height: Math.max(...bounds.map(box => box.y + box.height)) - y }
  }
  async render(texture: GpuTexture, width: number, height: number, commands: readonly CodeDrawCommand[], images?: ReadonlyMap<string, VideoEditCodeImageInput>): Promise<void> {
    await this.ready; if (this.disposed) throw new CodeMaterialError('CONTEXT', 'v3 渲染器已释放。')
    this.uniformIndex = 0; this.instanceIndex = 0; this.cached.forEach(value => { value.used = false }); this.layers.forEach(value => { value.used = false })
    const target: Image = { texture, width, height, x: 0, y: 0 }; let encoder = this.device.createCommandEncoder(); this.clear(encoder, target); let count = 0; let shaderCount = 0
    const shaderResults = new Map<string, Image>()
    let batchTarget: Image | undefined
    const batch: { command: Extract<CodeDrawCommand, { kind: 'rect' | 'ellipse' }>; matrix: CodeMatrix; opacity: number }[] = []
    const flushBatch = (): void => { if (batchTarget && batch.length) { this.instances(encoder, batchTarget, batch); batch.length = 0; batchTarget = undefined } }
    const flush = (): void => { flushBatch(); this.submit(encoder); encoder = this.device.createCommandEncoder() }
    const draw = async (command: CodeDrawCommand, target: Image, parent: CodeMatrix): Promise<void> => {
      if (!(command.kind === 'text' && command.perChar) && ++count > CODE_V3_LIMITS.draws) throw new CodeMaterialError('BUDGET', 'GPU 图形超出 4096。')
      const matrix = codeMultiply(parent, codeTransform(command)); const opacity = command.opacity ?? 1
      if (!opacity) return
      const key = command.elementPath?.join('/') ?? command.elementId ?? `draw:${count}`
      if (this.simple(command) && (!command.blend || command.blend === 'normal')) {
        if (batchTarget && batchTarget.texture !== target.texture) flushBatch()
        batchTarget = target; batch.push({ command, matrix, opacity }); return
      }
      flushBatch()
      if (command.kind === 'text' && command.perChar && command.layout) {
        const box = codeTextBaseBounds(command); const layout = command.layout
        for (let i = 0; i < layout.glyphs.length; i++) {
          const glyph = layout.glyphs[i]; const transform = command.perChar[i]
          if (!transform.opacity) continue
          const row = Math.round(glyph.y / (layout.fontSize * (command.lineHeight ?? 1.2))); const lineWidth = layout.lineWidths?.[row] ?? layout.width
          const char: CodeDrawCommand = { ...command, x: box.x + glyph.x + (command.align === 'center' ? (box.width - lineWidth) / 2 : command.align === 'right' ? box.width - lineWidth : 0), y: box.y + glyph.y, text: glyph.text, align: 'left', baseline: 'top', perChar: undefined, layout: { ...layout, width: glyph.width, height: layout.fontSize * (command.lineHeight ?? 1.2), lines: [glyph.text], lineWidths: [glyph.width], glyphs: [{ ...glyph, x: 0, y: 0 }] }, opacity: opacity * transform.opacity, rotation: transform.rotation, scaleX: transform.scale, scaleY: transform.scale, anchorX: 0, anchorY: 0, elementPath: [...(command.elementPath ?? []), `char:${i}`] }
          // Animate in a translated parent, keeping the glyph raster identity independent of displacement.
          await draw(char, target, codeMultiply(matrix, [1, 0, 0, 1, transform.x, transform.y]))
        }
        return
      }
      if (command.kind === 'group') {
        const bounds = this.groupBounds(command.children); const pad = Math.ceil(Math.max(command.blur ?? 0, command.glow?.radius ?? 0, command.shadow?.blur ?? 0) * 4 + Math.max(Math.abs(command.shadow?.x ?? 0), Math.abs(command.shadow?.y ?? 0)) + 2)
        const layer = this.layer(`${key}:group`, Math.max(1, Math.ceil(bounds.width + pad * 2)), Math.max(1, Math.ceil(bounds.height + pad * 2)), Math.floor(bounds.x - pad), Math.floor(bounds.y - pad))
        this.clear(encoder, layer)
        for (const child of command.children) await draw(child, layer, [1, 0, 0, 1, -layer.x, -layer.y])
        flush(); const image = await this.effects(layer, command, key)
        if (command.clip) {
          // Clip the effected layer in group-local coordinates before its transform is composited.
          const clip = command.clip; const clipped = this.layer(`${key}:clip`, Math.max(1, Math.ceil(clip.width)), Math.max(1, Math.ceil(clip.height)), clip.x, clip.y)
          this.clear(encoder, clipped); this.paint(encoder, clipped, { ...image, x: image.x - clip.x, y: image.y - clip.y }, CODE_IDENTITY, 1, 'textured'); flush()
          await composite(clipped, target, matrix, opacity, command.blend ?? 'normal', key)
        } else await composite(image, target, matrix, opacity, command.blend ?? 'normal', key)
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
    const composite = async (image: Image, target: Image, matrix: CodeMatrix, opacity: number, mode: CodeBlend, key: string): Promise<void> => {
      if (mode === 'normal') { this.paint(encoder, target, image, matrix, opacity, 'textured'); return }
      const copy = this.layer(`${key}:backdrop`, target.width, target.height); this.clear(encoder, copy)
      this.paint(encoder, copy, { ...target, x: 0, y: 0 }, CODE_IDENTITY, 1, 'textured')
      this.paint(encoder, target, image, matrix, opacity, 'composite', [1, 1, 1, 1], [blendNames.indexOf(mode), 0, 0, 1], [0, 0, 0, 0], copy)
    }
    try { for (const command of commands) await draw(command, target, CODE_IDENTITY); flush() }
    finally {
      for (const [key, layer] of this.layers) if (!layer.used || key.startsWith('raster:')) { this.release(layer); this.layers.delete(key) }
      this.ownGraphs?.releaseIdle()
      // Buffers are reusable until the next render. Texture ownership remains with the parent's resident-byte budget.
    }
  }
  diagnostics(): { cachedBytes: number; cachedImages: number; glyphs: number; layers: number; uniformBytes: number; pipelines: number } { return { cachedBytes: this.cachedBytes, cachedImages: this.cached.size, glyphs: [...this.cached.values()].filter(image => image.glyph).length, layers: this.layers.size, uniformBytes: this.uniforms.length * 112 + this.instanceBuffers.reduce((sum, entry) => sum + entry.data.byteLength, 0), pipelines: this.pipelines.size } }
  async dispose(): Promise<void> { this.disposed = true; await this.ready.catch(() => {}); await this.device.queue.onSubmittedWorkDone().catch(() => {}); this.cached.forEach(value => this.release(value)); this.layers.forEach(value => this.release(value)); this.scratch.forEach(value => this.release(value)); this.scratch.length = 0; this.uniforms.forEach(buffer => buffer.destroy()); this.instanceBuffers.forEach(entry => entry.buffer.destroy()); this.cached.clear(); this.layers.clear(); this.cachedBytes = 0; this.ownGraphs?.dispose() }
}
