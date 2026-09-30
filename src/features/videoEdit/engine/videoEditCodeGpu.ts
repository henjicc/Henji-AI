import type { GpuBuffer, GpuDevice, GpuRenderPipeline, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { evaluateCodeMaterial } from '@/core/videoEdit/codeMaterial/evaluate'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeColor, CodeDrawCommand, CodeMaterialContext, CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { emitCodeMaterialFilter } from './codeGpuFilter'

const MAX_RESIDENT_BYTES = 256 * 1024 ** 2
const MAX_SURFACES = 16
const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }
const shapeShader = `
struct Params { box:vec4f, color:vec4f, endpoints:vec4f, canvas:vec4f }
@group(0) @binding(0) var<uniform> p:Params;
struct Vertex { @builtin(position) position:vec4f, @location(0) uv:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->Vertex {
 let uv=array<vec2f,6>(vec2f(0,0),vec2f(0,1),vec2f(1,0),vec2f(1,0),vec2f(0,1),vec2f(1,1))[i];
 let point=(p.box.xy+uv*p.box.zw)/p.canvas.xy;
 return Vertex(vec4f(point.x*2-1,1-point.y*2,0,1),uv);
}
@fragment fn shape(v:Vertex)->@location(0) vec4f {
 let point=v.uv*p.box.zw; var distance=0.0;
 if (p.canvas.w==1.0) {
  let radii=max(p.box.zw*0.5,vec2f(0.000001));
  distance=(length((point-radii)/radii)-1)*min(radii.x,radii.y);
 } else if (p.canvas.w==2.0) {
  let a=p.endpoints.xy; let b=p.endpoints.zw; let ab=b-a;
  let t=clamp(dot(v.position.xy-a,ab)/max(dot(ab,ab),0.000001),0.0,1.0);
  distance=length(v.position.xy-a-ab*t)-p.canvas.z;
 } else {
  let half=p.box.zw*0.5; let radius=min(p.canvas.z,min(half.x,half.y));
  let q=abs(point-half)-half+vec2f(radius);
  distance=length(max(q,vec2f(0)))+min(max(q.x,q.y),0.0)-radius;
 }
 let alpha=p.color.a*clamp(0.5-distance,0.0,1.0);
 return vec4f(p.color.rgb*alpha,alpha);
}
@group(0) @binding(1) var glyph:texture_2d<f32>;
@group(0) @binding(2) var glyphSampler:sampler;
@fragment fn text(v:Vertex)->@location(0) vec4f {
 let alpha=textureSample(glyph,glyphSampler,v.uv).a*p.color.a;
 return vec4f(p.color.rgb*alpha,alpha);
}`

/** Texture belongs to the compositor's device, with premultiplied alpha. */
export class VideoEditCodePicture {
  constructor(readonly texture: GpuTexture, readonly width: number, readonly height: number, readonly owner: GpuDevice) {}
}
interface Surface { picture: VideoEditCodePicture; bytes: number; buffers: GpuBuffer[]; filterBuffer?: GpuBuffer }
interface Glyph { texture: GpuTexture; width: number; height: number; bytes: number }
export class VideoEditCodeGpu {
  private readonly surfaces = new Map<string, Surface>()
  private readonly glyphs = new Map<string, Glyph>()
  private readonly filters = new Map<string, { program: CodeMaterialProgram; pipeline: GpuRenderPipeline }>()
  private shape!: GpuRenderPipeline
  private text!: GpuRenderPipeline
  private sampler: unknown
  private bytes = 0
  private disposed = false
  private readonly ready: Promise<void>
  private pending: Promise<void> = Promise.resolve()
  private readonly counts = { pipelineCompiles: 0, textureAllocations: 0, externalCopies: 0, generatorFrames: 0, filterFrames: 0 }
  constructor(private readonly device: GpuDevice) { this.ready = this.initialize() }
  private async initialize(): Promise<void> {
    this.device.pushErrorScope('validation')
    const module = this.device.createShaderModule({ code: shapeShader })
    const pipeline = (entryPoint: string): GpuRenderPipeline => this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint, targets: [{ format: 'rgba8unorm', blend }] }, primitive: { topology: 'triangle-list' } })
    this.shape = pipeline('shape'); this.text = pipeline('text')
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.counts.pipelineCompiles += 2
    const error = await this.device.popErrorScope()
    if (error) throw new Error(`代码素材GPU初始化失败：${error.message}`)
  }
  private assertLive(): void { if (this.disposed) throw new Error('代码素材渲染会话已关闭。') }
  private texture(width: number, height: number): GpuTexture {
    const bytes = width * height * 4
    if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 8192) || bytes + this.bytes > MAX_RESIDENT_BYTES) throw new CodeMaterialError('BUDGET', '代码素材纹理超出尺寸或256MiB会话预算。')
    const texture = this.device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: 0x02 | 0x04 | 0x10 })
    this.bytes += bytes; this.counts.textureAllocations++
    return texture
  }
  private surface(key: string, width: number, height: number): Surface {
    let surface = this.surfaces.get(key)
    if (surface && (surface.picture.width !== width || surface.picture.height !== height)) { this.releaseSurface(key); surface = undefined }
    if (!surface) {
      if (this.surfaces.size >= MAX_SURFACES) throw new CodeMaterialError('BUDGET', '代码素材同时最多16个渲染目标。')
      const texture = this.texture(width, height)
      surface = { picture: new VideoEditCodePicture(texture, width, height, this.device), bytes: width * height * 4, buffers: [] }
      this.surfaces.set(key, surface)
    }
    return surface
  }
  private glyph(command: Extract<CodeDrawCommand, { kind: 'text' }>, protectedKeys: ReadonlySet<string>): Glyph {
    const key = JSON.stringify([command.text, command.fontSize, command.fontFamily])
    const cached = this.glyphs.get(key)
    if (cached) { this.glyphs.delete(key); this.glyphs.set(key, cached); return cached }
    const measure = new OffscreenCanvas(1, 1).getContext('2d')!
    measure.font = `${command.fontSize}px ${command.fontFamily}`
    const metrics = measure.measureText(command.text)
    const width = Math.max(1, Math.ceil(Math.max(metrics.width, metrics.actualBoundingBoxRight + metrics.actualBoundingBoxLeft)) + 4)
    const height = Math.max(1, Math.ceil(command.fontSize * 1.5) + 4)
    if (width > 8192 || width * height > 4 * 1024 ** 2) throw new CodeMaterialError('BUDGET', '标题字形超出8192宽或四百万像素，请缩短文字或减小字号。')
    while (this.glyphs.size >= 64 || this.bytes + width * height * 4 > MAX_RESIDENT_BYTES) {
      const oldest = [...this.glyphs].find(([key]) => !protectedKeys.has(key))
      if (!oldest) break
      oldest[1].texture.destroy(); this.bytes -= oldest[1].bytes; this.glyphs.delete(oldest[0])
    }
    if (this.glyphs.size >= 64) throw new CodeMaterialError('BUDGET', '同帧最多64份不同标题字形。')
    const canvas = new OffscreenCanvas(width, height); const context = canvas.getContext('2d')!
    context.font = measure.font; context.fillStyle = 'white'; context.textBaseline = 'middle'
    context.fillText(command.text, 2 + Math.max(0, metrics.actualBoundingBoxLeft), height / 2)
    const texture = this.texture(width, height)
    try { this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture, premultipliedAlpha: false }, [width, height]) }
    catch (error) { texture.destroy(); this.bytes -= width * height * 4; throw error }
    this.counts.externalCopies++
    const value = { texture, width, height, bytes: width * height * 4 }; this.glyphs.set(key, value)
    return value
  }
  private submit(encoder: ReturnType<GpuDevice['createCommandEncoder']>): void {
    this.device.queue.submit([encoder.finish()]); this.pending = this.device.queue.onSubmittedWorkDone()
  }
  async generator(key: string, program: CodeMaterialProgram, context: CodeMaterialContext, parameters: Readonly<Record<string, unknown>>): Promise<VideoEditCodePicture> {
    const commands = evaluateCodeMaterial(program, context, parameters)
    const usedGlyphs = new Set(commands.flatMap(command => command.kind === 'text' && command.text ? [JSON.stringify([command.text, command.fontSize, command.fontFamily])] : []))
    if (usedGlyphs.size > 64) throw new CodeMaterialError('BUDGET', '同帧最多64份不同标题字形。')
    await this.ready; this.assertLive()
    const target = this.surface(key, context.width, context.height)
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.picture.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
    commands.forEach((command, index) => {
      let box: number[]; let color: CodeColor; let endpoints = [0, 0, 0, 0]; let radius = 0; let kind = 0; let glyph: Glyph | undefined
      if (command.kind === 'text') {
        if (!command.text) return
        glyph = this.glyph(command, usedGlyphs)
        box = [command.x - (command.align === 'center' ? glyph.width / 2 : command.align === 'right' ? glyph.width : 0), command.y - glyph.height / 2, glyph.width, glyph.height]; color = command.color
      } else if (command.kind === 'line') {
        radius = command.width / 2; kind = 2; color = command.color
        box = [Math.min(command.x1, command.x2) - radius, Math.min(command.y1, command.y2) - radius, Math.abs(command.x2 - command.x1) + command.width, Math.abs(command.y2 - command.y1) + command.width]; endpoints = [command.x1, command.y1, command.x2, command.y2]
      } else { box = [command.x, command.y, command.width, command.height]; color = command.fill; kind = command.kind === 'ellipse' ? 1 : 0; radius = command.kind === 'rect' ? command.radius : 0 }
      if (box[2] <= 0 || box[3] <= 0) return
      let buffer = target.buffers[index]
      if (!buffer) { buffer = this.device.createBuffer({ size: 64, usage: 0x08 | 0x40 }); target.buffers[index] = buffer }
      this.device.queue.writeBuffer(buffer, 0, new Float32Array([...box, ...color, ...endpoints, context.width, context.height, radius, kind]))
      const pipeline = glyph ? this.text : this.shape
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }, ...(glyph ? [{ binding: 1, resource: glyph.texture.createView() }, { binding: 2, resource: this.sampler }] : [])] }))
      pass.draw(6)
    })
    pass.end(); this.submit(encoder); this.counts.generatorFrames++
    for (let index = commands.length; index < target.buffers.length; index++) target.buffers[index]?.destroy()
    target.buffers.length = commands.length
    // Glyph LRU is bounded across frames; positions/colors never invalidate it.
    return target.picture
  }
  async filter(key: string, version: string, program: CodeMaterialProgram, context: CodeMaterialContext, parameters: Readonly<Record<string, unknown>>, input: VideoEditCodePicture): Promise<VideoEditCodePicture> {
    const values = validateCodeMaterialParameters(program, parameters)
    if (input.owner !== this.device || input.width !== context.width || input.height !== context.height) throw new CodeMaterialError('CONTEXT', '代码滤镜输入必须属于当前设备并匹配尺寸。')
    for (const name of ['time', 'localTime', 'sequenceTime', 'width', 'height', 'frame', 'fps'] as const) { const value = context[name]; if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 432000) throw new CodeMaterialError('CONTEXT', `滤镜时间上下文无效：${name}`) }
    if ([context.time, context.localTime, context.sequenceTime].some(value => value < 0 || value > 1800) || !Number.isInteger(context.frame) || context.frame < 0 || context.frame > 432000 || context.fps < 1 || context.fps > 240) throw new CodeMaterialError('CONTEXT', '滤镜时间或帧率超出范围。')
    await this.ready; this.assertLive()
    let cached = this.filters.get(version)
    if (cached && cached.program !== program) throw new CodeMaterialError('COMPATIBILITY', '不可变代码版本被替换，请使用新版本。')
    if (!cached) {
      const code = emitCodeMaterialFilter(program)
      this.device.pushErrorScope('validation')
      const module = this.device.createShaderModule({ code })
      const pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] }, primitive: { topology: 'triangle-list' } })
      const error = await this.device.popErrorScope()
      if (error) throw new Error(`代码滤镜编译失败：${error.message}`)
      this.assertLive()
      if (this.filters.size >= 32) this.filters.delete(this.filters.keys().next().value!)
      cached = { program, pipeline }; this.filters.set(version, cached); this.counts.pipelineCompiles++
    }
    const target = this.surface(key, context.width, context.height)
    if (target.picture.texture === input.texture) throw new CodeMaterialError('CONTEXT', '滤镜输入输出不能引用同一纹理。')
    target.filterBuffer ??= this.device.createBuffer({ size: 35 * 16, usage: 0x08 | 0x40 })
    const packed = new Float32Array(35 * 4)
    packed.set([context.time, context.localTime, context.sequenceTime, context.width, context.height, context.frame, context.fps])
    const seed = context.seed ?? program.seed
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new CodeMaterialError('CONTEXT', '滤镜种子必须是32位无符号整数。')
    new Uint32Array(packed.buffer)[7] = seed
    program.parameters.forEach((parameter, index) => { const value = values[parameter.key]; if (Array.isArray(value)) packed.set(value, (index + 2) * 4); else if (typeof value === 'number' || typeof value === 'boolean') packed[(index + 2) * 4] = Number(value) })
    packed[34 * 4] = 1
    this.device.queue.writeBuffer(target.filterBuffer, 0, packed)
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.picture.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
    pass.setPipeline(cached.pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: cached.pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: input.texture.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: target.filterBuffer } }] }))
    pass.draw(3); pass.end(); this.submit(encoder); this.counts.filterFrames++
    return target.picture
  }
  releaseUnused(keys: ReadonlySet<string>): void { for (const key of this.surfaces.keys()) if (!keys.has(key)) this.releaseSurface(key) }
  private releaseSurface(key: string): void {
    const surface = this.surfaces.get(key)
    if (!surface) return
    surface.picture.texture.destroy(); surface.buffers.forEach(buffer => buffer?.destroy()); surface.filterBuffer?.destroy(); this.bytes -= surface.bytes; this.surfaces.delete(key)
  }
  diagnostics(): { residentBytes: number; surfaces: number; glyphs: number; pipelines: number; pipelineCompiles: number; textureAllocations: number; externalCopies: number; generatorFrames: number; filterFrames: number } { return { ...this.counts, residentBytes: this.bytes, surfaces: this.surfaces.size, glyphs: this.glyphs.size, pipelines: this.filters.size + (this.disposed ? 0 : 2) } }
  async dispose(): Promise<void> {
    this.disposed = true; await this.ready.catch(() => {}); await this.pending.catch(() => {})
    this.releaseUnused(new Set()); for (const glyph of this.glyphs.values()) { glyph.texture.destroy(); this.bytes -= glyph.bytes }
    this.glyphs.clear(); this.filters.clear()
  }
}
