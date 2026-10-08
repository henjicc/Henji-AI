import { VIDEO_EDIT_MAX_SEQUENCE_SECONDS, VIDEO_EDIT_MAX_SEQUENCE_FRAMES } from '@/core/videoEdit/time'
import type { GpuBuffer, GpuDevice, GpuRenderPipeline, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { evaluateCodeMaterial } from '@/core/videoEdit/codeMaterial/evaluate'
import { validateCodeMaterialParameters } from '@/core/videoEdit/codeMaterial/parameters'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { VideoEditGraphicDraw } from '@/core/videoEdit/graphics'
import type { CodeColor, CodeDrawCommand, CodeMaterialContext, CodeMaterialProgram } from '@/core/videoEdit/codeMaterial/contract'
import { emitCodeMaterialFilter } from './codeGpuFilter'
import { codeShaderFilterPasses, codeShaderParams } from '@/core/videoEdit/codeMaterial/shaders'
import { evaluateCodeFrameExpression } from '@/core/videoEdit/codeMaterial/evaluateV3'
import { TrustedShaderLibraryRenderer } from './shaderLibrary/render'
import { codeFilterRadius, codeMaterialFilterPasses } from './videoEditCodeCompilerFilterV3'
import type { VideoEditBuiltinEffectInstance } from '@/core/videoEdit/compositing'
import { VideoEditBuiltinEffectsGpu } from './videoEditBuiltinEffectsGpu'
import { ShaderGraphCache } from './shaderEngines/shaderGraphCache'
import { isShaderGraphEffect, shaderGraphEffectProps, shaderGraphEffectSpec } from '@/core/videoEdit/shaderGraph/effects'
import { resolveVideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { ShaderLibraryClock } from './shaderLibrary/planner'
import type { VideoEditBuiltinTransitionInput } from '@/core/videoEdit/transitions'
import { invalidateCodeTextMetrics, measureCodeText, measureVideoEditGlyph } from '../videoEditGlyphMetrics'
import { fontLibrarySnapshot, subscribeFontLibrary } from '@/platform/fonts'
import { VideoEditCodeGpuV3 } from './videoEditCodeGpuV3'
import { createLogger } from '@/core/logging'
import { videoEditGpuBytesPerPixel, VIDEO_EDIT_PRECISE_FORMAT, type VideoEditGpuColorFormat } from './videoEditGpuFrame'
import { rasterizeVideoEditText, videoEditTextResolution } from './videoEditTextSurface'
import { documentFontRevision } from '@/platform/fontFaces'

const MAX_RESIDENT_BYTES = 256 * 1024 ** 2
/**
 * Separate budget of `rgba16float` surfaces (task 2.7): effects and transitions on 10-bit and deeper material. Two
 * effected 4K clips in a transition hold 7 full-frame surfaces (464 MB in rgba16float); 8 such 4K surfaces fit. The
 * 8-bit budget above is unchanged.
 */
const MAX_PRECISE_RESIDENT_BYTES = 512 * 1024 ** 2
const codeLogger = createLogger('features.videoEdit.codeGpu')
const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }
const shapeShader = `
struct Params { box:vec4f, color:vec4f, endpoints:vec4f, canvas:vec4f, transform:vec4f }
@group(0) @binding(0) var<uniform> p:Params;
struct Vertex { @builtin(position) position:vec4f, @location(0) uv:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->Vertex {
 let uv=array<vec2f,6>(vec2f(0,0),vec2f(0,1),vec2f(1,0),vec2f(1,0),vec2f(0,1),vec2f(1,1))[i];
 let local=p.box.xy+uv*p.box.zw-p.transform.zw;
 let rotated=vec2f(local.x*p.transform.x-local.y*p.transform.y,local.x*p.transform.y+local.y*p.transform.x);
 let point=(rotated+p.transform.zw)/p.canvas.xy;
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
const imageShader = `${shapeShader}
@fragment fn image(v:Vertex)->@location(0) vec4f {
 let color=textureSample(glyph,glyphSampler,v.uv);
 let rgb=select(color.rgb*color.a,color.rgb,p.canvas.z==1.0);
 return vec4f(rgb*p.color.a,color.a*p.color.a);
}`

/** Borrowed from the compositor; this runtime never decodes, uploads, caches or destroys these textures. */
export interface VideoEditCodeImageInput { texture: GpuTexture; width: number; height: number; owner: GpuDevice; premultiplied: boolean }

/** Texture belongs to the compositor's device, with premultiplied alpha. */
export class VideoEditCodePicture {
  /** True for `rgba16float` surfaces: effects and transitions on high-precision material keep its precision. */
  readonly highPrecision: boolean
  constructor(readonly texture: GpuTexture, readonly width: number, readonly height: number, readonly owner: GpuDevice, readonly textureFormat: VideoEditGpuColorFormat = 'rgba8unorm') {
    this.highPrecision = textureFormat === VIDEO_EDIT_PRECISE_FORMAT
  }
}
interface Surface { picture: VideoEditCodePicture; bytes: number; buffers: GpuBuffer[]; filterBuffer?: GpuBuffer; mixBuffer?: GpuBuffer; maskData?: Uint8Array; maskRgba?: Uint8Array }
/** A filter version's compiled pipelines, one per output format. */
interface CompiledFilter { program: CodeMaterialProgram; pipelines: Map<VideoEditGpuColorFormat, GpuRenderPipeline>; transitionHandles: boolean }
interface Glyph { texture: GpuTexture; width: number; height: number; bytes: number; x?: number; y?: number }
interface FilterLayoutDevice {
  createBindGroupLayout(descriptor: unknown): unknown
  createPipelineLayout(descriptor: unknown): unknown
}
export class VideoEditCodeGpu {
  private readonly surfaces = new Map<string, Surface>()
  private readonly glyphs = new Map<string, Glyph>()
  private readonly filters = new Map<string, CompiledFilter>()
  /** Keyed by version and output format. */
  private readonly filterCompiles = new Map<string, { version: string; program: CodeMaterialProgram; pending: Promise<GpuRenderPipeline> }>()
  private readonly retiredTextures = new WeakSet<GpuTexture>()
  private readonly textureBytes = new WeakMap<GpuTexture, number>()
  private readonly preciseTextures = new WeakSet<GpuTexture>()
  private filterLayout?: unknown
  private readonly v3FilterLayouts = new Map<number, unknown>()
  private shape!: GpuRenderPipeline
  private text!: GpuRenderPipeline
  private image?: GpuRenderPipeline
  private imageReady?: Promise<void>
  private readonly mixPipelines = new Map<VideoEditGpuColorFormat, GpuRenderPipeline>()
  private readonly mixReady = new Map<VideoEditGpuColorFormat, Promise<void>>()
  private readonly maskedMixPipelines = new Map<VideoEditGpuColorFormat, Promise<GpuRenderPipeline>>()
  private sampler: unknown
  private builtinRuntime?: VideoEditBuiltinEffectsGpu
  private graphCache?: ShaderGraphCache
  private v3Runtime?: VideoEditCodeGpuV3
  private readonly missingFonts = new Set<string>()
  private bytes = 0
  /** Part of `bytes` held by `rgba16float` surfaces. */
  private preciseBytes = 0
  private disposed = false
  private readonly ready: Promise<void>
  private pending: Promise<void> = Promise.resolve()
  private readonly counts = { pipelineCompiles: 0, textureAllocations: 0, externalCopies: 0, generatorFrames: 0, filterFrames: 0, mixFrames: 0, builtinFrames: 0 }
  private readonly stopFonts: () => void
  constructor(private readonly device: GpuDevice) {
    // Worker font resets recreate this host after t63 loads/imports the new FontFace payloads.
    invalidateCodeTextMetrics()
    let revision = fontLibrarySnapshot().revision
    this.stopFonts = subscribeFontLibrary(() => {
      const next = fontLibrarySnapshot().revision
      if (next !== revision) { revision = next; invalidateCodeTextMetrics() }
    })
    this.ready = this.initialize()
  }
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
  private assertInput(texture: GpuTexture): void { if (this.retiredTextures.has(texture)) throw new CodeMaterialError('CONTEXT', '输入画面已退役，请重新获取当前画面。') }
  assertPictureLive(picture: VideoEditCodePicture): void {
    this.assertLive()
    if (picture.owner !== this.device) throw new CodeMaterialError('CONTEXT', '画面不属于当前GPU设备。')
    this.assertInput(picture.texture)
  }
  private fixedFilterLayout(additional = 0): unknown {
    if (additional === 0 && this.filterLayout) return this.filterLayout
    if (additional && this.v3FilterLayouts.has(additional)) return this.v3FilterLayouts.get(additional)
    const device = this.device as GpuDevice & Partial<FilterLayoutDevice>
    if (!device.createBindGroupLayout || !device.createPipelineLayout) throw new Error('GPU设备不支持固定滤镜绑定。')
    // Author shaders may read none, some or all of these resources. The host
    // contract always binds all three; an automatic layout would omit unused ones.
    const group = device.createBindGroupLayout({ entries: [
      { binding: 0, visibility: 2, texture: { sampleType: 'float' } },
      { binding: 1, visibility: 2, sampler: { type: 'filtering' } },
      { binding: 2, visibility: 2, buffer: { type: 'uniform', minBindingSize: 35 * 16 } },
      ...Array.from({ length: additional }, (_, index) => ({ binding: index + 3, visibility: 2, texture: { sampleType: 'float' } })),
    ] })
    const layout = device.createPipelineLayout({ bindGroupLayouts: [group] })
    if (additional) this.v3FilterLayouts.set(additional, layout); else this.filterLayout = layout
    return layout
  }
  private async prepareFilter(version: string, program: CodeMaterialProgram, transitionHandles: boolean, format: VideoEditGpuColorFormat = 'rgba8unorm'): Promise<GpuRenderPipeline> {
    const cached = this.filters.get(version)
    const key = `${version}\u0000${format}`
    const compiling = this.filterCompiles.get(key)
    if ((cached && cached.program !== program) || [...this.filterCompiles.values()].some(entry => entry.version === version && entry.program !== program)) throw new CodeMaterialError('COMPATIBILITY', '不可变代码版本被替换，请使用新版本。')
    if (cached) {
      if (transitionHandles && !cached.transitionHandles) { emitCodeMaterialFilter(program, true); cached.transitionHandles = true }
      const pipeline = cached.pipelines.get(format)
      if (pipeline) return pipeline
    }
    if (compiling) { await compiling.pending; return this.prepareFilter(version, program, transitionHandles, format) }
    const code = emitCodeMaterialFilter(program, transitionHandles)
    const pending = (async (): Promise<GpuRenderPipeline> => {
      this.device.pushErrorScope('validation')
      let pipeline: GpuRenderPipeline
      try {
        const module = this.device.createShaderModule({ code })
        pipeline = this.device.createRenderPipeline({ layout: this.fixedFilterLayout(codeMaterialFilterPasses(program).length + codeShaderFilterPasses(program).length), vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      } catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
      const error = await this.device.popErrorScope()
      if (error) throw new Error(`代码滤镜编译失败：${error.message}`)
      this.assertLive()
      const entry = this.filters.get(version)
      if (entry && entry.program === program) { entry.pipelines.set(format, pipeline); entry.transitionHandles ||= transitionHandles }
      else {
        // CodeSources retires unused program versions at the frame boundary. Keep all live
        // versions so a long effect chain never recompiles its pipelines on every frame.
        this.filters.set(version, { program, pipelines: new Map([[format, pipeline]]), transitionHandles })
      }
      this.counts.pipelineCompiles++
      return pipeline
    })()
    this.filterCompiles.set(key, { version, program, pending })
    try { return await pending }
    finally { if (this.filterCompiles.get(key)?.pending === pending) this.filterCompiles.delete(key) }
  }
  private async prepareImagePipeline(): Promise<void> {
    if (this.image) return
    const pending = this.imageReady ??= (async () => {
      this.device.pushErrorScope('validation')
      let pipeline: GpuRenderPipeline
      try {
        const module = this.device.createShaderModule({ code: imageShader })
        pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'image', targets: [{ format: 'rgba8unorm', blend }] }, primitive: { topology: 'triangle-list' } })
      } catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
      const error = await this.device.popErrorScope()
      if (error) throw new Error(`代码图片管线编译失败：${error.message}`)
      this.assertLive(); this.image = pipeline; this.counts.pipelineCompiles++
    })()
    try { await pending }
    catch (error) { if (this.imageReady === pending) this.imageReady = undefined; throw error }
  }
  private texture(width: number, height: number, format: VideoEditGpuColorFormat = 'rgba8unorm'): GpuTexture {
    const bytes = width * height * videoEditGpuBytesPerPixel(format)
    const precise = format === VIDEO_EDIT_PRECISE_FORMAT
    if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 8192)) throw new CodeMaterialError('BUDGET', '代码素材纹理超出尺寸或256MiB会话预算。')
    if (precise ? bytes + this.preciseBytes > MAX_PRECISE_RESIDENT_BYTES : bytes + this.bytes - this.preciseBytes > MAX_RESIDENT_BYTES) throw new CodeMaterialError('BUDGET', precise ? '高精度代码素材纹理超出512MiB会话预算。' : '代码素材纹理超出尺寸或256MiB会话预算。')
    const texture = this.device.createTexture({ size: [width, height], format, usage: 0x02 | 0x04 | 0x10 })
    this.bytes += bytes; if (precise) this.preciseBytes += bytes
    this.textureBytes.set(texture, bytes); if (precise) this.preciseTextures.add(texture)
    this.counts.textureAllocations++
    return texture
  }
  private surface(key: string, width: number, height: number, format: VideoEditGpuColorFormat = 'rgba8unorm', retainMask = false): Surface {
    let surface = this.surfaces.get(key)
    if (surface && (surface.picture.width !== width || surface.picture.height !== height || surface.picture.textureFormat !== format)) { this.releaseSurface(key); surface = undefined }
    if (!surface) {
      const texture = this.texture(width, height, format)
      surface = { picture: new VideoEditCodePicture(texture, width, height, this.device, format), bytes: width * height * videoEditGpuBytesPerPixel(format), buffers: [] }
      this.surfaces.set(key, surface)
    }
    if (!retainMask) surface.maskData = undefined
    return surface
  }
  private glyph(command: Extract<CodeDrawCommand, { kind: 'text' }>, protectedKeys: ReadonlySet<string>): Glyph {
    const key = JSON.stringify([command.text, command.fontSize, command.fontFamily])
    const cached = this.glyphs.get(key)
    if (cached) { this.glyphs.delete(key); this.glyphs.set(key, cached); return cached }
    const metrics = measureVideoEditGlyph(command.text, command.fontSize, command.fontFamily)
    const { width, height } = metrics
    while (this.glyphs.size >= 64 || this.bytes - this.preciseBytes + width * height * 4 > MAX_RESIDENT_BYTES) {
      const oldest = [...this.glyphs].find(([key]) => !protectedKeys.has(key))
      if (!oldest) break
      oldest[1].texture.destroy(); this.bytes -= oldest[1].bytes; this.glyphs.delete(oldest[0])
    }
    const canvas = new OffscreenCanvas(width, height); const context = canvas.getContext('2d')!
    context.font = metrics.font; context.fillStyle = 'white'; context.textBaseline = 'middle'
    context.fillText(command.text, metrics.offsetX, height / 2)
    const texture = this.texture(width, height)
    try { this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture, premultipliedAlpha: false }, [width, height]) }
    catch (error) { texture.destroy(); this.bytes -= width * height * 4; throw error }
    this.counts.externalCopies++
    const value = { texture, width, height, bytes: width * height * 4 }; this.glyphs.set(key, value)
    return value
  }
  private styledGlyphKey(draw: VideoEditGraphicDraw, width: number, height: number, scale: number): string {
    return JSON.stringify(['styled', width, height, draw.command.kind === 'text' ? draw.command.text : '', draw.textStyle, documentFontRevision(), videoEditTextResolution((draw.scale ?? 1) * scale)])
  }
  private styledGlyph(draw: VideoEditGraphicDraw, width: number, height: number, scale: number, protectedKeys: ReadonlySet<string>): Glyph {
    if (draw.command.kind !== 'text' || !draw.textStyle) throw new Error('图形文字缺少共享样式。')
    const key = this.styledGlyphKey(draw, width, height, scale); const cached = this.glyphs.get(key)
    if (cached) { this.glyphs.delete(key); this.glyphs.set(key, cached); return cached }
    const raster = rasterizeVideoEditText({ text: draw.command.text, textStyle: draw.textStyle }, { width, height }, videoEditTextResolution((draw.scale ?? 1) * scale))
    const bytes = raster.canvas.width * raster.canvas.height * 4
    for (const [oldKey, old] of this.glyphs) {
      if (this.bytes - this.preciseBytes + bytes <= MAX_RESIDENT_BYTES && this.glyphs.size < 64) break
      if (protectedKeys.has(oldKey)) continue
      old.texture.destroy(); this.bytes -= old.bytes; this.glyphs.delete(oldKey)
    }
    const texture = this.texture(raster.canvas.width, raster.canvas.height)
    try { this.device.queue.copyExternalImageToTexture({ source: raster.canvas }, { texture, premultipliedAlpha: false }, [raster.canvas.width, raster.canvas.height]) }
    catch (error) { texture.destroy(); this.bytes -= bytes; throw error }
    this.counts.externalCopies++
    const value = { texture, width: raster.width, height: raster.height, x: raster.x, y: raster.y, bytes }; this.glyphs.set(key, value); return value
  }
  private submit(encoder: ReturnType<GpuDevice['createCommandEncoder']>): void {
    this.device.queue.submit([encoder.finish()]); this.pending = this.device.queue.onSubmittedWorkDone()
  }
  private v3(): VideoEditCodeGpuV3 {
    return this.v3Runtime ??= new VideoEditCodeGpuV3(this.device, { allocate: (width, height) => this.texture(width, height), release: texture => { const bytes = this.textureBytes.get(texture) ?? 0; texture.destroy(); this.bytes -= bytes } }, undefined, new TrustedShaderLibraryRenderer(this.builtins()))
  }
  async generator(key: string, program: CodeMaterialProgram, context: CodeMaterialContext, parameters: Readonly<Record<string, unknown>>, images?: ReadonlyMap<string, VideoEditCodeImageInput>, transitionHandles = false, overrides?: Pick<import('@/core/videoEdit/codeMaterial/evaluate').CodeMaterialEvaluationOptions, 'elementOverrides' | 'sourceTime'>): Promise<VideoEditCodePicture> {
    const commands = evaluateCodeMaterial(program, context, parameters, { transitionHandles, ...overrides, measureText: measureCodeText, onDiagnostic: diagnostic => {
      if (!this.missingFonts.has(diagnostic.fontFamily)) { this.missingFonts.add(diagnostic.fontFamily); codeLogger.warn('代码文字缺少字体，使用无衬线字体', { event: 'video_edit.code.font.missing', context: { fontFamily: diagnostic.fontFamily } }) }
    } })
    if (program.languageVersion === 3) {
      await this.ready; this.assertLive()
      const target = this.surface(key, context.width, context.height)
      await this.v3().render(target.picture.texture, context.width, context.height, commands, images)
      this.pending = this.device.queue.onSubmittedWorkDone(); this.counts.generatorFrames++
      return target.picture
    }
    return this.draw(key, context.width, context.height, commands.map(command => ({ command, rotation: 0, pivotX: 0, pivotY: 0 })), images)
  }
  /** Structured graphics and trusted generator IR use one drawing/glyph/cache implementation. */
  async draw(key: string, width: number, height: number, draws: readonly VideoEditGraphicDraw[], images?: ReadonlyMap<string, VideoEditCodeImageInput>, rasterScale = 1): Promise<VideoEditCodePicture> {
    // The author-language evaluator owns its execution limits. Structured graphics have no product object-count cap.
    if (draws.some(draw => !Number.isFinite(draw.rotation) || Math.abs(draw.rotation) > 360 || ![draw.pivotX, draw.pivotY].every(value => Number.isFinite(value) && Math.abs(value) <= 32768))) throw new CodeMaterialError('BUDGET', '图形独立变换超出技术范围。')
    const commands = draws.map(draw => draw.command)
    const context = { width, height }
    const usedGlyphs = new Set(draws.flatMap(draw => draw.command.kind === 'text' && draw.command.text ? [draw.textStyle ? this.styledGlyphKey(draw, width, height, rasterScale) : JSON.stringify([draw.command.text, draw.command.fontSize, draw.command.fontFamily])] : []))
    await this.ready; this.assertLive()
    const inputs = new Map<string, { input: VideoEditCodeImageInput; view: unknown }>()
    for (const command of commands) if (command.kind === 'image' && !inputs.has(command.source.mediaId)) {
      const raw = images?.get(command.source.mediaId)
      if (!raw) throw new CodeMaterialError('CONTEXT', `代码图片输入不存在：${command.source.mediaId}`)
      const input = { ...raw }
      this.assertInput(input.texture)
      if (input.owner !== this.device || ![input.width, input.height].every(value => Number.isInteger(value) && value > 0 && value <= 8192) || typeof input.premultiplied !== 'boolean') throw new CodeMaterialError('CONTEXT', '代码图片输入必须属于当前设备并具有有效尺寸和alpha模式。')
      if (input.texture === this.surfaces.get(key)?.picture.texture) throw new CodeMaterialError('CONTEXT', '代码图片输入输出不能引用同一纹理。')
      inputs.set(command.source.mediaId, { input, view: input.texture.createView() })
    }
    if (draws.some(draw => draw.textStyle) || commands.some(command => command.kind === 'image' && command.width > 0 && command.height > 0 && command.opacity > 0)) await this.prepareImagePipeline()
    this.assertLive()
    for (const { input } of inputs.values()) this.assertInput(input.texture)
    // Preserve the higher-resolution glyph through the graphic's intermediate target when the whole clip is enlarged.
    // The existing single-texture 8192px limit bounds this target tier; all allocations retain the resident-byte owner.
    const outputResolution = draws.some(draw => draw.textStyle) ? Math.min(videoEditTextResolution(rasterScale), 2 ** Math.max(0, Math.floor(Math.log2(8192 / Math.max(width, height))))) : 1
    const target = this.surface(key, context.width * outputResolution, context.height * outputResolution)
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.picture.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
    commands.forEach((command, index) => {
      let box: number[]; let color: CodeColor; let endpoints = [0, 0, 0, 0]; let radius = 0; let kind = 0; let glyph: Glyph | undefined; let image: { input: VideoEditCodeImageInput; view: unknown } | undefined
      if (command.kind === 'image') {
        if (command.opacity <= 0) return
        image = inputs.get(command.source.mediaId)!
        box = [command.x, command.y, command.width, command.height]; color = [1, 1, 1, command.opacity]; radius = image.input.premultiplied ? 1 : 0
      } else if (command.kind === 'text') {
        if (!command.text) return
        if (draws[index].textStyle) {
          glyph = this.styledGlyph(draws[index], width, height, rasterScale, usedGlyphs)
          box = [command.x + glyph.x!, command.y + glyph.y!, glyph.width, glyph.height]; color = [1, 1, 1, draws[index].opacity ?? 1]
        } else {
          glyph = this.glyph(command, usedGlyphs)
          box = [command.x - (command.align === 'center' ? glyph.width / 2 : command.align === 'right' ? glyph.width : 0), command.y - glyph.height / 2, glyph.width, glyph.height]; color = command.color
        }
      } else if (command.kind === 'line') {
        radius = command.width / 2; kind = 2; color = command.color
        box = [Math.min(command.x1, command.x2) - radius, Math.min(command.y1, command.y2) - radius, Math.abs(command.x2 - command.x1) + command.width, Math.abs(command.y2 - command.y1) + command.width]; endpoints = [command.x1, command.y1, command.x2, command.y2]
      } else if (command.kind === 'rect' || command.kind === 'ellipse') { box = [command.x, command.y, command.width, command.height]; color = command.fill; kind = command.kind === 'ellipse' ? 1 : 0; radius = command.kind === 'rect' ? command.radius : 0 }
      else throw new CodeMaterialError('TYPE', '分组和路径需要 v3 渲染入口。')
      if (box[2] <= 0 || box[3] <= 0) return
      let buffer = target.buffers[index]
      if (!buffer) { buffer = this.device.createBuffer({ size: 80, usage: 0x08 | 0x40 }); target.buffers[index] = buffer }
      const transform = draws[index]; const rotation = transform.rotation * Math.PI / 180
      const scale = transform.scale ?? 1
      box = [transform.pivotX + (box[0] - transform.pivotX) * scale, transform.pivotY + (box[1] - transform.pivotY) * scale, box[2] * scale, box[3] * scale]
      this.device.queue.writeBuffer(buffer, 0, new Float32Array([...box, ...color, ...endpoints, context.width, context.height, radius, kind, Math.cos(rotation), Math.sin(rotation), transform.pivotX, transform.pivotY]))
      const pipeline = image || transform.textStyle ? this.image! : glyph ? this.text : this.shape
      pass.setPipeline(pipeline)
      pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer } }, ...(image || glyph ? [{ binding: 1, resource: image ? image.view : glyph!.texture.createView() }, { binding: 2, resource: this.sampler }] : [])] }))
      pass.draw(6)
    })
    pass.end(); this.submit(encoder); this.counts.generatorFrames++
    for (let index = commands.length; index < target.buffers.length; index++) target.buffers[index]?.destroy()
    target.buffers.length = commands.length
    // Glyph LRU is bounded across frames; positions/colors never invalidate it.
    return target.picture
  }
  async filter(key: string, version: string, program: CodeMaterialProgram, context: CodeMaterialContext, parameters: Readonly<Record<string, unknown>>, input: VideoEditCodePicture, transitionHandles = false): Promise<VideoEditCodePicture> {
    const values = validateCodeMaterialParameters(program, parameters)
    if (!Number.isFinite(context.time) || context.time < 0) throw new CodeMaterialError('CONTEXT', '滤镜源时间必须有限且非负。')
    // Static authors cannot read time. Curves were evaluated against the real source
    // clock by CodeSources; keep the shader within its existing proved input domain.
    const shaderTime = program.mode === 'static' ? 0 : context.time
    // The output has the input's size. `context.width/height` is the sequence size the author's code reads; at a reduced
    // playback resolution (task 4.9) it is larger than the input, so offsets written as `n / width` keep their look.
    if (input.owner !== this.device) throw new CodeMaterialError('CONTEXT', '代码滤镜输入必须属于当前设备。')
    for (const name of ['localTime', 'sequenceTime', 'width', 'height', 'frame', 'fps'] as const) { const value = context[name]; if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > VIDEO_EDIT_MAX_SEQUENCE_FRAMES) throw new CodeMaterialError('CONTEXT', `滤镜时间上下文无效：${name}`) }
    if (shaderTime > VIDEO_EDIT_MAX_SEQUENCE_SECONDS || context.sequenceTime < 0 || context.sequenceTime > VIDEO_EDIT_MAX_SEQUENCE_SECONDS || context.localTime < (transitionHandles ? -VIDEO_EDIT_MAX_SEQUENCE_SECONDS : 0) || context.localTime > VIDEO_EDIT_MAX_SEQUENCE_SECONDS || !Number.isInteger(context.frame) || context.frame < 0 || context.frame > VIDEO_EDIT_MAX_SEQUENCE_FRAMES || context.fps < 1 || context.fps > 240) throw new CodeMaterialError('CONTEXT', '滤镜时间或帧率超出范围。')
    await this.ready; this.assertLive(); this.assertInput(input.texture)
    // The output keeps the input's precision: an effect on 10-bit material stays rgba16float.
    const format = input.textureFormat
    const pipeline = await this.prepareFilter(version, program, transitionHandles, format)
    this.assertLive(); this.assertInput(input.texture)
    const target = this.surface(key, input.width, input.height, format)
    if (target.picture.texture === input.texture) throw new CodeMaterialError('CONTEXT', '滤镜输入输出不能引用同一纹理。')
    target.filterBuffer ??= this.device.createBuffer({ size: 35 * 16, usage: 0x08 | 0x40 })
    const packed = new Float32Array(35 * 4)
    packed.set([shaderTime, context.localTime, context.sequenceTime, context.width, context.height, context.frame, context.fps])
    const seed = context.seed ?? program.seed
    if (!Number.isInteger(seed) || seed < 0 || seed > 4294967295) throw new CodeMaterialError('CONTEXT', '滤镜种子必须是32位无符号整数。')
    new Uint32Array(packed.buffer)[7] = seed
    program.parameters.forEach((parameter, index) => { const value = values[parameter.key]; if (Array.isArray(value)) packed.set(value, (index + 2) * 4); else if (typeof value === 'number' || typeof value === 'boolean') packed[(index + 2) * 4] = Number(value) })
    packed[34 * 4] = 1
    this.device.queue.writeBuffer(target.filterBuffer, 0, packed)
    const shaderPasses = codeShaderFilterPasses(program)
    const shaderTextures: GpuTexture[] = []
    const shaderResults = new Map<GpuTexture, Map<string, GpuTexture>>()
    const releaseShader = (texture: GpuTexture): void => { const bytes = this.textureBytes.get(texture) ?? 0; texture.destroy(); this.bytes -= bytes; if (this.preciseTextures.has(texture)) this.preciseBytes -= bytes }
    const blurred: { texture: GpuTexture; release: () => void }[] = []
    try {
      for (const primitive of codeMaterialFilterPasses(program)) blurred.push(await this.v3().filterBlur(input.texture, input.width, input.height, codeFilterRadius(program, primitive.radius, values), primitive.threshold ? codeFilterRadius(program, primitive.threshold, values) : undefined))
      for (const primitive of shaderPasses) {
        let params: Record<string, number | string>
        try { params = codeShaderParams(primitive.name, 'filter', evaluateCodeFrameExpression(program, primitive.params, context, values)) }
        catch (error) { if (error instanceof CodeMaterialError && !error.sourceSpan) throw new CodeMaterialError(error.code, error.message, primitive.expression.sourceSpan); throw error }
        const source = primitive.input === undefined ? input.texture : shaderTextures[primitive.input]
        const signature = JSON.stringify([primitive.name, Object.entries(params).sort(([a], [b]) => a.localeCompare(b))])
        let results = shaderResults.get(source); if (!results) { results = new Map(); shaderResults.set(source, results) }
        const cached = results.get(signature)
        if (cached) { shaderTextures.push(cached); continue }
        const output = this.texture(input.width, input.height, format); shaderTextures.push(output); results.set(signature, output)
        await new TrustedShaderLibraryRenderer(this.builtins()).render({ name: `shader_${primitive.name}`, params, timeSeconds: shaderTime, width: input.width, height: input.height, format, input: source, output })
      }
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.picture.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: input.texture.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: target.filterBuffer } }, ...blurred.map((value, index) => ({ binding: index + 3, resource: value.texture.createView() })), ...shaderTextures.map((value, index) => ({ binding: index + 3 + blurred.length, resource: value.createView() }))] }))
    pass.draw(3); pass.end(); this.submit(encoder); this.counts.filterFrames++
    return target.picture
    } finally { blurred.forEach(value => value.release()); new Set(shaderTextures).forEach(releaseShader) }
  }
  /**
   * All generated, filtered and composition targets share the resident budget of their format: `rgba16float` targets
   * hold compositions of high-precision material (task 2.7).
   */
  async target(key: string, width: number, height: number, format: VideoEditGpuColorFormat = 'rgba8unorm'): Promise<VideoEditCodePicture> {
    await this.ready; this.assertLive(); return this.surface(key, width, height, format).picture
  }
  private async prepareMix(format: VideoEditGpuColorFormat): Promise<void> {
    if (this.mixPipelines.has(format)) return
    let pending = this.mixReady.get(format)
    if (!pending) pending = (async () => {
      this.device.pushErrorScope('validation')
      let pipeline: GpuRenderPipeline
      try {
        const module = this.device.createShaderModule({ code: `
struct Vertex { @builtin(position) position:vec4f, @location(0) uv:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->Vertex {
 let uv=array<vec2f,3>(vec2f(0,0),vec2f(0,2),vec2f(2,0))[i];
 return Vertex(vec4f(uv.x*2-1,1-uv.y*2,0,1),uv);
}
@group(0) @binding(0) var left:texture_2d<f32>;
@group(0) @binding(1) var right:texture_2d<f32>;
@group(0) @binding(2) var s:sampler;
struct Mix { amount:vec4f, color:vec4f }
@group(0) @binding(3) var<uniform> m:Mix;
@fragment fn fs(v:Vertex)->@location(0) vec4f {
 let a=textureSample(left,s,v.uv); let b=textureSample(right,s,v.uv); let t=m.amount.x;
 // y=1：经过纯色的黑场／白场过渡，前半段淡到纯色，后半段从纯色淡入。
 let dip=select(mix(m.color,b,t*2.0-1.0),mix(a,m.color,t*2.0),t<0.5);
 return select(mix(a,b,t),dip,m.amount.y>0.5);
}` })
        pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      } catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
      const error = await this.device.popErrorScope()
      if (error) throw new Error(`透明混合管线编译失败：${error.message}`)
      this.assertLive(); this.mixPipelines.set(format, pipeline); this.counts.pipelineCompiles++
    })()
    this.mixReady.set(format, pending)
    try { await pending } catch (error) { if (this.mixReady.get(format) === pending) this.mixReady.delete(format); throw error }
  }
  /** `through`：黑场／白场过渡经过的预乘纯色；不传为直接混合（交叉溶解、效果强度）。 */
  async mix(key: string, left: VideoEditCodePicture, right: VideoEditCodePicture, amount: number, through?: readonly [number, number, number, number]): Promise<VideoEditCodePicture> {
    if (left.owner !== this.device || right.owner !== this.device || left.width !== right.width || left.height !== right.height || !Number.isFinite(amount) || amount < 0 || amount > 1) throw new CodeMaterialError('CONTEXT', '透明混合需要同设备同尺寸画面和0到1的强度。')
    const old = this.surfaces.get(key)?.picture.texture
    if (old && (old === left.texture || old === right.texture)) throw new CodeMaterialError('CONTEXT', '透明混合输入输出不能引用同一纹理。')
    // Mixing an 8-bit picture into a high-precision one keeps the higher precision.
    const format = left.highPrecision || right.highPrecision ? VIDEO_EDIT_PRECISE_FORMAT : 'rgba8unorm'
    await this.ready; this.assertLive(); await this.prepareMix(format); this.assertLive()
    this.assertInput(left.texture); this.assertInput(right.texture)
    const pipeline = this.mixPipelines.get(format)!
    const target = this.surface(key, left.width, left.height, format)
    if (target.picture.texture === left.texture || target.picture.texture === right.texture) throw new CodeMaterialError('CONTEXT', '透明混合输入输出不能引用同一纹理。')
    target.mixBuffer ??= this.device.createBuffer({ size: 32, usage: 0x08 | 0x40 })
    this.device.queue.writeBuffer(target.mixBuffer, 0, new Float32Array([amount, through ? 1 : 0, 0, 0, ...(through ?? [0, 0, 0, 0])]))
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.picture.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: left.texture.createView() }, { binding: 1, resource: right.texture.createView() }, { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: target.mixBuffer } }] }))
    pass.draw(3); pass.end(); this.submit(encoder); this.counts.mixFrames++
    return target.picture
  }
  /**
   * 智能区域蒙版（4.7d）：把 0–255 的单通道蒙版写进一张 rgba8 画面（四个通道都是蒙版值，即预乘的白色），
   * 之后由合成器按片段的位置、缩放、旋转画到序列尺寸上，与片段画面逐像素对齐。
   */
  async uploadMask(key: string, width: number, height: number, data: Uint8Array): Promise<VideoEditCodePicture> {
    if (data.length !== width * height) throw new CodeMaterialError('CONTEXT', '智能区域蒙版尺寸不符。')
    await this.ready; this.assertLive()
    const target = this.surface(key, width, height, 'rgba8unorm', true)
    if (target.maskData === data) return target.picture
    const rgba = target.maskRgba ??= new Uint8Array(width * height * 4)
    for (let index = 0; index < data.length; index++) { const value = data[index]; rgba[index * 4] = value; rgba[index * 4 + 1] = value; rgba[index * 4 + 2] = value; rgba[index * 4 + 3] = value }
    const queue = this.device.queue as GpuDevice['queue'] & { writeTexture(destination: unknown, data: ArrayBufferView, layout: unknown, size: unknown): void }
    queue.writeTexture({ texture: target.picture.texture }, rgba, { bytesPerRow: width * 4, rowsPerImage: height }, [width, height])
    target.maskData = data
    return target.picture
  }
  private async prepareMaskedMix(format: VideoEditGpuColorFormat): Promise<GpuRenderPipeline> {
    let pending = this.maskedMixPipelines.get(format)
    if (!pending) {
      pending = (async () => {
        this.device.pushErrorScope('validation')
        let pipeline: GpuRenderPipeline
        try {
          const module = this.device.createShaderModule({ code: `
struct Vertex { @builtin(position) position:vec4f, @location(0) uv:vec2f }
@vertex fn vs(@builtin(vertex_index) i:u32)->Vertex {
 let uv=array<vec2f,3>(vec2f(0,0),vec2f(0,2),vec2f(2,0))[i];
 return Vertex(vec4f(uv.x*2-1,1-uv.y*2,0,1),uv);
}
@group(0) @binding(0) var base:texture_2d<f32>;
@group(0) @binding(1) var effected:texture_2d<f32>;
@group(0) @binding(2) var s:sampler;
@group(0) @binding(3) var<uniform> m:vec4f;
@group(0) @binding(4) var region:texture_2d<f32>;
@fragment fn fs(v:Vertex)->@location(0) vec4f {
 // 区域内按效果强度混入处理后的画面，区域外保持原样；蒙版经线性采样放大，边缘自然过渡。
 return mix(textureSample(base,s,v.uv),textureSample(effected,s,v.uv),textureSample(region,s,v.uv).a*m.x);
}` })
          pipeline = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
        } catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
        const error = await this.device.popErrorScope()
        if (error) throw new Error(`智能区域混合管线编译失败：${error.message}`)
        this.assertLive(); this.counts.pipelineCompiles++
        return pipeline
      })()
      this.maskedMixPipelines.set(format, pending)
      pending.catch(() => { if (this.maskedMixPipelines.get(format) === pending) this.maskedMixPipelines.delete(format) })
    }
    return pending
  }
  /** 只在区域内混入效果（4.7d）：`region` 是序列尺寸的蒙版画面（取 alpha），`amount` 是效果强度。 */
  async maskedMix(key: string, base: VideoEditCodePicture, effected: VideoEditCodePicture, region: VideoEditCodePicture, amount: number): Promise<VideoEditCodePicture> {
    if ([effected, region].some(picture => picture.owner !== this.device || picture.width !== base.width || picture.height !== base.height) || base.owner !== this.device || !Number.isFinite(amount) || amount < 0 || amount > 1) throw new CodeMaterialError('CONTEXT', '区域混合需要同设备同尺寸画面和0到1的强度。')
    const format = base.highPrecision || effected.highPrecision ? VIDEO_EDIT_PRECISE_FORMAT : 'rgba8unorm'
    await this.ready; this.assertLive()
    const pipeline = await this.prepareMaskedMix(format); this.assertLive()
    for (const picture of [base, effected, region]) this.assertInput(picture.texture)
    const target = this.surface(key, base.width, base.height, format)
    if ([base, effected, region].some(picture => picture.texture === target.picture.texture)) throw new CodeMaterialError('CONTEXT', '区域混合输入输出不能引用同一纹理。')
    target.mixBuffer ??= this.device.createBuffer({ size: 32, usage: 0x08 | 0x40 })
    this.device.queue.writeBuffer(target.mixBuffer, 0, new Float32Array([amount, 0, 0, 0]))
    const encoder = this.device.createCommandEncoder()
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.picture.texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
    pass.setPipeline(pipeline)
    pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: base.texture.createView() }, { binding: 1, resource: effected.texture.createView() }, { binding: 2, resource: this.sampler }, { binding: 3, resource: { buffer: target.mixBuffer } }, { binding: 4, resource: region.texture.createView() }] }))
    pass.draw(3); pass.end(); this.submit(encoder); this.counts.mixFrames++
    return target.picture
  }
  /** 内置效果（4.7b）：输出保持输入的精度；中间纹理计入同一份显存预算。`frame` 只用作胶片颗粒的确定种子。 */
  async builtin(key: string, instance: VideoEditBuiltinEffectInstance, input: VideoEditCodePicture, frame: number, renderScale = 1, luts: readonly import('@/core/videoEdit/lumetriLutAsset').LumetriLutAsset[] = []): Promise<VideoEditCodePicture> {
    await this.ready; this.assertLive(); this.assertInput(input.texture)
    if (input.owner !== this.device) throw new CodeMaterialError('CONTEXT', '内置效果输入必须属于当前GPU设备。')
    const runtime = this.builtins()
    const target = this.surface(key, input.width, input.height, input.textureFormat)
    if (target.picture.texture === input.texture) throw new CodeMaterialError('CONTEXT', '内置效果输入输出不能引用同一纹理。')
    if (isShaderGraphEffect(instance.id)) {
      // `shaders` 组件效果：着色器图 [@input, 组件]，时间是片段内秒数（由合成场景给出）。
      const time = (instance as ShaderLibraryClock).shaderTimeSeconds ?? 0
      await this.shaderGraphs().render(shaderGraphEffectSpec(instance.id), { timeSeconds: time, width: input.width, height: input.height, input: input.texture, output: target.picture.texture, outputFormat: input.textureFormat, props: new Map([['fx', shaderGraphEffectProps(instance.id, resolveVideoEditBuiltinParams(instance))]]) })
    } else await runtime.render(instance, { texture: input.texture, width: input.width, height: input.height, format: input.textureFormat }, target.picture.texture, frame, renderScale, luts)
    this.assertLive(); this.pending = this.device.queue.onSubmittedWorkDone(); this.counts.builtinFrames++
    return target.picture
  }
  /** 着色器图（`shaders` 框架）会话缓存：效果、转场与代码素材 shader 图层共用。 */
  shaderGraphs(): ShaderGraphCache { return this.graphCache ??= new ShaderGraphCache(this.device) }
  private builtins(): VideoEditBuiltinEffectsGpu {
    return this.builtinRuntime ??= new VideoEditBuiltinEffectsGpu(this.device, this.sampler, {
      allocate: (width, height, format) => this.texture(width, height, format as VideoEditGpuColorFormat),
      release: texture => { const bytes = this.textureBytes.get(texture) ?? 0; texture.destroy(); this.bytes -= bytes; if (this.preciseTextures.has(texture)) this.preciseBytes -= bytes },
    })
  }
  /**
   * 带参数的视频过渡（4.7：擦除、推动、滑动、缩放、模糊、闪光、圆形划像）：与内置效果同一套着色器与显存预算。
   * 单侧过渡两侧传同一张画面，空着的一侧由 `transition` 标记为透明；任一侧是高精度时输出高精度。
   */
  async transition(key: string, transition: VideoEditBuiltinTransitionInput, outgoing: VideoEditCodePicture, incoming: VideoEditCodePicture): Promise<VideoEditCodePicture> {
    if (outgoing.owner !== this.device || incoming.owner !== this.device || outgoing.width !== incoming.width || outgoing.height !== incoming.height) throw new CodeMaterialError('CONTEXT', '过渡需要同设备同尺寸的两段画面。')
    await this.ready; this.assertLive(); this.assertInput(outgoing.texture); this.assertInput(incoming.texture)
    const format = outgoing.highPrecision || incoming.highPrecision ? VIDEO_EDIT_PRECISE_FORMAT : 'rgba8unorm'
    const target = this.surface(key, outgoing.width, outgoing.height, format)
    if (target.picture.texture === outgoing.texture || target.picture.texture === incoming.texture) throw new CodeMaterialError('CONTEXT', '过渡输入输出不能引用同一纹理。')
    await this.builtins().renderTransition(transition, outgoing.texture, incoming.texture, target.picture.texture, { width: outgoing.width, height: outgoing.height, format })
    this.assertLive(); this.pending = this.device.queue.onSubmittedWorkDone(); this.counts.builtinFrames++
    return target.picture
  }
  releaseUnused(keys: ReadonlySet<string>): void { for (const key of this.surfaces.keys()) if (!keys.has(key)) this.releaseSurface(key); this.builtinRuntime?.releaseIdle(); this.graphCache?.releaseIdle() }
  /** Only evict prior nested output frames; generated/effect surfaces have their own existing owner. */
  releaseNestedFrames(keys: ReadonlySet<string>): void { for (const key of this.surfaces.keys()) if (key.startsWith('nested:frame:') && !keys.has(key)) this.releaseSurface(key) }
  /** CodeSources owns IR identity. Retired IR cannot leave an older pipeline identity behind. */
  retainProgramVersions(versions: ReadonlySet<string>): void {
    for (const version of this.filters.keys()) if (!versions.has(version)) this.filters.delete(version)
  }
  private releaseSurface(key: string): void {
    const surface = this.surfaces.get(key)
    if (!surface) return
    this.retiredTextures.add(surface.picture.texture)
    surface.picture.texture.destroy(); surface.buffers.forEach(buffer => buffer?.destroy()); surface.filterBuffer?.destroy(); surface.mixBuffer?.destroy(); this.bytes -= surface.bytes; this.surfaces.delete(key)
    if (surface.picture.highPrecision) this.preciseBytes -= surface.bytes
  }
  diagnostics(): { residentBytes: number; surfaces: number; glyphs: number; pipelines: number; pipelineCompiles: number; textureAllocations: number; externalCopies: number; generatorFrames: number; filterFrames: number; mixFrames: number; builtinFrames: number } {
    const v3 = this.v3Runtime?.diagnostics()
    return { ...this.counts, pipelineCompiles: this.counts.pipelineCompiles + (v3?.pipelines ?? 0), externalCopies: this.counts.externalCopies + (this.v3Runtime?.counts.uploads ?? 0), residentBytes: this.bytes, surfaces: this.surfaces.size, glyphs: this.glyphs.size + (v3?.glyphs ?? 0), pipelines: this.disposed ? 0 : [...this.filters.values()].reduce((sum, filter) => sum + filter.pipelines.size, 0) + 2 + Number(!!this.image) + this.mixPipelines.size + (v3?.pipelines ?? 0) }
  }
  async dispose(): Promise<void> {
    this.stopFonts()
    this.disposed = true; await this.ready.catch(() => {}); await this.imageReady?.catch(() => {}); await Promise.allSettled([...this.mixReady.values(), ...this.maskedMixPipelines.values()])
    await Promise.allSettled([...this.filterCompiles.values()].map(value => value.pending)); await this.pending.catch(() => {})
    this.releaseUnused(new Set()); await this.v3Runtime?.dispose(); this.v3Runtime = undefined; this.builtinRuntime?.dispose(); this.builtinRuntime = undefined; this.graphCache?.dispose(); this.graphCache = undefined; for (const glyph of this.glyphs.values()) { glyph.texture.destroy(); this.bytes -= glyph.bytes }
    this.glyphs.clear(); this.filters.clear(); this.filterLayout = undefined; this.image = undefined; this.mixPipelines.clear(); this.maskedMixPipelines.clear()
  }
}
