import { VideoEditGpuBitmapBridge } from './videoEditGpuBitmapBridge'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'
import type { CodeFramePerformance } from '@/core/videoEdit/codeMaterial/performance'
import { codeLayerTotals, codeStructureCosts } from '@/core/videoEdit/codeMaterial/performance'
import { VideoEditCodePicture } from './videoEditCodePicture'
export { VideoEditCodePicture } from './videoEditCodePicture'
import type { EffectQuality } from '@/core/imaging/effects/descriptor'
import { paintNativeText } from '@/services/vectorContent/textRaster'
import type { GpuBuffer, GpuDevice, GpuRenderPipeline, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { CodeMaterialError } from '@/core/videoEdit/codeMaterial/contract'
import type { VideoEditGraphicDraw } from '@/core/videoEdit/graphics'
import type { CodeColor, CodeDrawCommand } from '@/core/videoEdit/codeMaterial/contract'
import type { VideoEditBuiltinEffectInstance } from '@/core/videoEdit/compositing'
import { VideoEditBuiltinEffectsGpu } from './videoEditBuiltinEffectsGpu'
import { ShaderGraphCache } from './shaderEngines/shaderGraphCache'
import { isShaderGraphEffect, shaderGraphEffectProps, shaderGraphEffectSpec, type VideoEditShaderClock } from '@/core/videoEdit/shaderGraph/effects'
import { isShaderGraphTransition, shaderGraphTransitionProps, shaderGraphTransitionSpec } from '@/core/videoEdit/shaderGraph/transitions'
import { isGlTransition, type GlTransitionKind } from '@/core/videoEdit/glTransitions/transitions'
import { VideoEditGlTransitionsGpu } from './glTransitions/videoEditGlTransitionsGpu'
import { resolveVideoEditBuiltinParams } from '@/core/videoEdit/builtinEffects'
import type { VideoEditBuiltinTransitionInput } from '@/core/videoEdit/transitions'
import { invalidateCodeTextMetrics, measureVideoEditGlyph } from '../videoEditGlyphMetrics'
import { fontLibrarySnapshot, subscribeFontLibrary } from '@/platform/fonts'
import { videoEditGpuBytesPerPixel, VIDEO_EDIT_PRECISE_FORMAT, type VideoEditGpuColorFormat } from './videoEditGpuFrame'
import { rasterizeVideoEditText, videoEditTextResolution } from './videoEditTextSurface'
import { documentFontRevision } from '@/platform/fontFaces'
import { VideoEditAuthorPrograms } from './videoEditAuthorPrograms'
import type { CodeAuthorBundle, CodeAuthorProgram } from '@/core/videoEdit/codeAuthorProgram'
import type { AuthorAssets, AuthorFrameInfo, AuthorGpuInputs } from './videoEditAuthorModule'
import type { AuthorElementOverrides } from './videoEditAuthorElements'
import { videoEditRenderSize, type VideoEditRenderDivisor } from '@/core/videoEdit/playbackResolution'

// 4K media + grading + author filters need more than eight RGBA8 surfaces.
// Allocate on demand, with a bounded 512MiB tier independent of precise targets.
const MAX_RESIDENT_BYTES = 512 * 1024 ** 2
interface Glyph { texture: GpuTexture; width: number; height: number; bytes: number; x?: number; y?: number }
/**
 * Separate budget of `rgba16float` surfaces (task 2.7): effects and transitions on 10-bit and deeper material. Two
 * effected 4K clips in a transition hold 7 full-frame surfaces (464 MB in rgba16float); 8 such 4K surfaces fit. The
 * 8-bit budget above is unchanged.
 */
const MAX_PRECISE_RESIDENT_BYTES = 512 * 1024 ** 2
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
export interface VideoEditCodeImageInput { texture: GpuTexture; width: number; height: number; owner: GpuDevice; premultiplied: boolean; source?: CanvasImageSource }

interface Surface { picture: VideoEditCodePicture; bytes: number; buffers: GpuBuffer[]; filterBuffer?: GpuBuffer; mixBuffer?: GpuBuffer; maskData?: Uint8Array; maskRgba?: Uint8Array }
export class VideoEditCodeGpu {
  private bitmapBridge?: VideoEditGpuBitmapBridge
  private authorPrograms?: VideoEditAuthorPrograms
  private readonly authorWork = new Set<Promise<unknown>>()
  private closing?: Promise<void>
  private trackAuthor<T>(action: () => Promise<T>): Promise<T> {
    this.assertLive()
    const pending = action()
    this.authorWork.add(pending)
    void pending.then(() => this.authorWork.delete(pending), () => this.authorWork.delete(pending))
    return pending
  }
  private authors(): VideoEditAuthorPrograms { return this.authorPrograms ??= new VideoEditAuthorPrograms(this.device) }
  async inspectAuthor(bundle: CodeAuthorBundle): Promise<CodeAuthorProgram> { return this.trackAuthor(async () => { await this.ready; this.assertLive(); return this.authors().inspect(bundle) }) }
  /**
   * `divisor`：节目回放分辨率的缩小倍数（任务 4.9，导出与完整分辨率为 1）。大于 1 时输出纹理按比例缩小，画面的放置尺寸仍是
   * `size`；Canvas 作者坐标不变，WebGPU / WebGL 入口拿到缩小后的 target 与 width/height，`info.renderScale` 给出比例。
   */
  async authorGenerator(key: string, instanceKey: string, program: CodeAuthorProgram, size: { width: number; height: number }, parameters: Readonly<Record<string, unknown>>, assets: AuthorAssets, info: AuthorFrameInfo, overrides?: AuthorElementOverrides, motionBlur = true, images: AuthorGpuInputs['images'] = {}, divisor: VideoEditRenderDivisor = 1): Promise<VideoEditCodePicture> {
    return this.trackAuthor(() => this.renderAuthorGenerator(key, instanceKey, program, size, parameters, assets, info, overrides, motionBlur, images, divisor))
  }
  private async renderAuthorGenerator(key: string, instanceKey: string, program: CodeAuthorProgram, size: { width: number; height: number }, parameters: Readonly<Record<string, unknown>>, assets: AuthorAssets, info: AuthorFrameInfo, overrides: AuthorElementOverrides | undefined, motionBlur: boolean, images: AuthorGpuInputs['images'], divisor: VideoEditRenderDivisor): Promise<VideoEditCodePicture> {
    await this.ready; this.assertLive()
    const runtime = await this.authors().instance(instanceKey, program)
    this.assertLive()
    const output = divisor === 1 ? undefined : videoEditRenderSize(size.width, size.height, divisor)
    const target = output ? this.surface(key, output.width, output.height, 'rgba8unorm', false, size) : this.surface(key, size.width, size.height)
    const started = performance.now()
    for (const image of Object.values(images)) this.assertInput(image.texture)
    // 完整分辨率按原样调用（不多传参数、不改 info），画面与之前逐像素相同。
    const layers = output
      ? await runtime.render(target.picture.texture, size.width, size.height, parameters, assets, { ...info, renderScale: output.height / size.height }, overrides, { frames: [], images }, motionBlur, output)
      : await runtime.render(target.picture.texture, size.width, size.height, parameters, assets, info, overrides, { frames: [], images }, motionBlur)
    const completed = this.trackPerformance(key, { frame: Math.floor(info.time / info.frameDuration), cpuMs: performance.now() - started, gpuMs: 0, budgetMs: info.frameDuration * 1000, ...(layers ? { layers } : {}) }, started, started, performance.now())
    this.pending = this.device.queue.onSubmittedWorkDone().then(completed); this.counts.generatorFrames++
    return target.picture
  }
  async authorFilter(key: string, instanceKey: string, program: CodeAuthorProgram, parameters: Readonly<Record<string, unknown>>, input: VideoEditCodePicture, info: AuthorFrameInfo, frames: AuthorGpuInputs['frames'] = []): Promise<VideoEditCodePicture> {
    return this.trackAuthor(() => this.renderAuthorFilter(key, instanceKey, program, parameters, input, info, frames))
  }
  private async renderAuthorFilter(key: string, instanceKey: string, program: CodeAuthorProgram, parameters: Readonly<Record<string, unknown>>, input: VideoEditCodePicture, info: AuthorFrameInfo, frames: AuthorGpuInputs['frames']): Promise<VideoEditCodePicture> {
    await this.ready; this.assertLive(); this.assertInput(input.texture)
    if (input.owner !== this.device) throw new Error('作者滤镜输入不属于当前渲染设备。')
    if (frames.length !== program.frames.length || frames.some((frame, index) => frame.offset !== program.frames[index])) throw new Error(`滤镜「${program.name}」声明了相邻帧 ${program.frames.join('、')}，渲染会话尚未提供匹配输入。`)
    const runtime = await this.authors().instance(instanceKey, program)
    this.assertLive(); this.assertInput(input.texture)
    for (const frame of frames) this.assertInput(frame.texture)
    const target = this.surface(key, input.width, input.height, input.textureFormat)
    if (target.picture.texture === input.texture) throw new Error('作者滤镜输入输出不能使用同一纹理。')
    const started = performance.now()
    const layers = await runtime.render(target.picture.texture, input.width, input.height, parameters, {}, info, undefined, { current: input.texture, frames, images: {} })
    const completed = this.trackPerformance(key, { frame: Math.floor(info.time / info.frameDuration), cpuMs: performance.now() - started, gpuMs: 0, budgetMs: info.frameDuration * 1000, ...(layers ? { layers } : {}) }, started, started, performance.now())
    this.pending = this.device.queue.onSubmittedWorkDone().then(completed); this.counts.filterFrames++
    return target.picture
  }
  /**
   * Speculative first frame of an instance the playhead is about to reach: loads its module and builds its GPU
   * resources and author state off the playback path. The picture is never shown; the instance stays protected
   * from release until `protectAuthorInstances` drops it.
   */
  async warmAuthor(instanceKey: string, program: CodeAuthorProgram, size: { width: number; height: number }, parameters: Readonly<Record<string, unknown>>, assets: AuthorAssets, info: AuthorFrameInfo, filter?: boolean): Promise<void> {
    return this.trackAuthor(async () => {
      await this.ready; this.assertLive()
      const runtime = await this.authors().instance(instanceKey, program); this.assertLive()
      const target = this.surface(`warm:${instanceKey}`, size.width, size.height)
      const input = filter ? this.surface(`warm:input:${instanceKey}`, size.width, size.height) : undefined
      // The picture is discarded: free it at once (destroy waits for the submitted work) instead of holding a full frame per warmed instance.
      try { await runtime.render(target.picture.texture, size.width, size.height, parameters, assets, info, undefined, input ? { current: input.picture.texture, frames: [], images: {} } : { frames: [], images: {} }) }
      finally { this.releaseSurface(`warm:${instanceKey}`); if (input) this.releaseSurface(`warm:input:${instanceKey}`) }
    })
  }
  protectAuthorInstances(keys: ReadonlySet<string>): void { this.authorPrograms?.protect(keys) }
  observeAuthor(instanceKey: string): ReturnType<VideoEditAuthorPrograms['observe']> { return this.authorPrograms?.observe(instanceKey) ?? [] }
  async retainAuthorInstances(keys: ReadonlySet<string>): Promise<void> { await this.authorPrograms?.retain(keys) }
  private readonly performanceFrames = new Map<string, CodeFramePerformance>()
  private readonly performanceSpans = new Map<CodeFramePerformance, { cpu: [number, number]; gpu: [number, number] }>()
  private trackPerformance(key: string, timing: CodeFramePerformance, cpuStart: number, gpuStart: number, cpuEnd = gpuStart): () => void {
    const previous = this.performanceFrames.get(key); if (previous) this.performanceSpans.delete(previous)
    this.performanceFrames.set(key, timing)
    const spans: { cpu: [number, number]; gpu: [number, number] } = { cpu: [cpuStart, cpuEnd], gpu: [gpuStart, gpuStart] }
    this.performanceSpans.set(timing, spans)
    return () => { spans.gpu[1] = performance.now(); timing.gpuMs = spans.gpu[1] - gpuStart }
  }
  private readonly surfaces = new Map<string, Surface>()
  private readonly glyphs = new Map<string, Glyph>()
  private readonly retiredTextures = new WeakSet<GpuTexture>()
  private readonly textureBytes = new WeakMap<GpuTexture, number>()
  private readonly preciseTextures = new WeakSet<GpuTexture>()
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
  private glTransitionRuntime?: VideoEditGlTransitionsGpu
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
    if (![width, height].every(value => Number.isInteger(value) && value >= 1 && value <= 8192)) throw new CodeMaterialError('BUDGET', '代码素材纹理超出尺寸或512MiB会话预算。')
    if (precise ? bytes + this.preciseBytes > MAX_PRECISE_RESIDENT_BYTES : bytes + this.bytes - this.preciseBytes > MAX_RESIDENT_BYTES) throw new CodeMaterialError('BUDGET', precise ? '高精度代码素材纹理超出512MiB会话预算。' : '代码素材纹理超出尺寸或512MiB会话预算。')
    const textureStarted = performance.now()
    const texture = this.device.createTexture({ size: [width, height], format, usage: 0x01 | 0x02 | 0x04 | 0x08 | 0x10 })
    recordVideoEditPreparation('textureAllocation', performance.now() - textureStarted)
    this.bytes += bytes; if (precise) this.preciseBytes += bytes
    this.textureBytes.set(texture, bytes); if (precise) this.preciseTextures.add(texture)
    this.counts.textureAllocations++
    return texture
  }
  /** `display`：画面的放置尺寸，缺省等于纹理尺寸（见 VideoEditCodePicture.displayWidth）。 */
  private surface(key: string, width: number, height: number, format: VideoEditGpuColorFormat = 'rgba8unorm', retainMask = false, display?: { width: number; height: number }): Surface {
    let surface = this.surfaces.get(key)
    const displayWidth = display?.width ?? width, displayHeight = display?.height ?? height
    if (surface && (surface.picture.width !== width || surface.picture.height !== height || surface.picture.textureFormat !== format || surface.picture.displayWidth !== displayWidth || surface.picture.displayHeight !== displayHeight)) { this.releaseSurface(key); surface = undefined }
    if (!surface) {
      const texture = this.texture(width, height, format)
      surface = { picture: new VideoEditCodePicture(texture, width, height, this.device, format, false, display), bytes: width * height * videoEditGpuBytesPerPixel(format), buffers: [] }
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
    paintNativeText(context, command.text, metrics.offsetX, height / 2)
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
  /** Structured graphics retain their native drawing/glyph/cache implementation. */
  async draw(key: string, width: number, height: number, draws: readonly VideoEditGraphicDraw[], images?: ReadonlyMap<string, VideoEditCodeImageInput>, rasterScale = 1): Promise<VideoEditCodePicture> {
    // Structured graphics have no product object-count cap.
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
      else throw new CodeMaterialError('TYPE', '结构化图形包含不支持的绘制类型。')
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
  async builtin(key: string, instance: VideoEditBuiltinEffectInstance, input: VideoEditCodePicture, frame: number, renderScale = 1, luts: readonly import('@/core/videoEdit/colorLutAsset').ColorLutAsset[] = [], quality: EffectQuality = 'interactive', referenceSize?: { width: number; height: number }): Promise<VideoEditCodePicture> {
    await this.ready; this.assertLive(); this.assertInput(input.texture)
    if (input.owner !== this.device) throw new CodeMaterialError('CONTEXT', '内置效果输入必须属于当前GPU设备。')
    const runtime = this.builtins()
    const target = this.surface(key, input.width, input.height, input.textureFormat)
    if (target.picture.texture === input.texture) throw new CodeMaterialError('CONTEXT', '内置效果输入输出不能引用同一纹理。')
    if (isShaderGraphEffect(instance.id)) {
      // `shaders` 组件效果：着色器图 [@input, 组件]，时间是片段内秒数（由合成场景给出）。
      const time = (instance as VideoEditShaderClock).shaderTimeSeconds ?? 0
      await this.shaderGraphs().render(shaderGraphEffectSpec(instance.id), { timeSeconds: time, width: input.width, height: input.height, input: input.texture, output: target.picture.texture, outputFormat: input.textureFormat, props: new Map([['fx', shaderGraphEffectProps(instance.id, resolveVideoEditBuiltinParams(instance))]]) })
    } else await runtime.render(instance, { texture: input.texture, width: input.width, height: input.height, format: input.textureFormat }, target.picture.texture, frame, renderScale, luts, quality, referenceSize)
    this.assertLive(); this.pending = this.device.queue.onSubmittedWorkDone(); this.counts.builtinFrames++
    return target.picture
  }
  private transparentPixel?: GpuTexture
  /** 1×1 透明画面（单侧过渡空着的一侧），按需创建一次。 */
  private transparent(): GpuTexture {
    if (!this.transparentPixel) {
      this.transparentPixel = this.device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: 0x02 | 0x04 | 0x10 })
      const encoder = this.device.createCommandEncoder()
      encoder.beginRenderPass({ colorAttachments: [{ view: this.transparentPixel.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] }).end()
      this.device.queue.submit([encoder.finish()])
    }
    return this.transparentPixel
  }
  /** 着色器图（`shaders` 框架）会话缓存：效果、转场与代码素材 shader 图层共用。 */
  shaderGraphs(): ShaderGraphCache { return this.graphCache ??= new ShaderGraphCache(this.device) }
  private glTransitions(): VideoEditGlTransitionsGpu { return this.glTransitionRuntime ??= new VideoEditGlTransitionsGpu(this.device, this.sampler) }
  /** 起播前在后台先编译用到的 gl-transitions 管线（8 位输出），第一次播到转场不再等编译。 */
  async warmGlTransitions(kinds: readonly GlTransitionKind[]): Promise<void> {
    await this.ready; this.assertLive()
    const runtime = this.glTransitions()
    await Promise.all(kinds.map(kind => runtime.prepare(kind, 'rgba8unorm')))
  }
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
    if (isShaderGraphTransition(transition.kind)) {
      // 框架转场：前一段在转场图层里被擦掉，露出下面的后一段；单侧过渡空着的一侧用透明画面。
      const empty = transition.emptyOutgoing || transition.emptyIncoming ? this.transparent() : undefined
      await this.shaderGraphs().render(shaderGraphTransitionSpec(transition.kind), { timeSeconds: 0, width: outgoing.width, height: outgoing.height, input: transition.emptyOutgoing ? empty : outgoing.texture, second: transition.emptyIncoming ? empty : incoming.texture, output: target.picture.texture, outputFormat: format, props: new Map([['fx', shaderGraphTransitionProps(transition.kind, transition.params, transition.progress)]]) })
    } else if (isGlTransition(transition.kind)) {
      // gl-transitions：前一段经转场着色器过渡到后一段；单侧过渡空着的一侧用透明画面。
      await this.glTransitions().render({ ...transition, kind: transition.kind }, outgoing.texture, incoming.texture, target.picture.texture, { width: outgoing.width, height: outgoing.height, format }, () => this.transparent())
    } else await this.builtins().renderTransition(transition, outgoing.texture, incoming.texture, target.picture.texture, { width: outgoing.width, height: outgoing.height, format })
    this.assertLive(); this.pending = this.device.queue.onSubmittedWorkDone(); this.counts.builtinFrames++
    return target.picture
  }
  resetFramePerformance(): void { this.performanceFrames.clear(); this.performanceSpans.clear() }
  private divisor: VideoEditRenderDivisor = 1
  /** 合成器所在节目的回放分辨率缩小倍数（任务 4.9），由合成器同步；导出会话始终为 1。 */
  get renderDivisor(): VideoEditRenderDivisor { return this.divisor }
  setRenderDivisor(divisor: VideoEditRenderDivisor): void { this.divisor = divisor }
  captureFramePerformance(): () => CodeFramePerformance[] {
    // Keep this request's records alive while the next pipelined frame resets the
    // current maps. Queue completion still updates these captured span objects.
    const frames = [...this.performanceFrames.values()]
    const spans = new Map(this.performanceSpans)
    return () => this.framePerformance(frames, spans)
  }
  framePerformance(frames = [...this.performanceFrames.values()], performanceSpans = this.performanceSpans): CodeFramePerformance[] {
    if (!frames.length) return []
    // Queue completions overlap across targets. Merge their wall intervals and
    // subtract CPU evaluation intervals before reporting one sequence-frame total.
    const spans = frames.flatMap(frame => performanceSpans.get(frame) ?? [])
    const events = spans.flatMap(span => [
      { at: span.cpu[0], cpu: 1, gpu: 0 }, { at: span.cpu[1], cpu: -1, gpu: 0 },
      { at: span.gpu[0], cpu: 0, gpu: 1 }, { at: span.gpu[1], cpu: 0, gpu: -1 },
    ]).sort((a, b) => a.at - b.at)
    let cpu = 0; let gpu = 0; let gpuMs = 0; let previous = events[0]?.at ?? 0
    for (const event of events) { if (gpu > 0 && cpu === 0) gpuMs += event.at - previous; cpu += event.cpu; gpu += event.gpu; previous = event.at }
    const heaviest = frames.flatMap(frame => frame.heaviest ?? []).sort((a, b) => b.cpuMs - a.cpuMs)[0]
    const details = frames.filter(frame => frame.structures)
    // Recover the pre-truncation denominators, so merging the top-five summaries
    // of multiple clips never turns a 20% structure into a fictitious 100% one.
    const totals = details.reduce((sum, frame) => {
      const cpu = frame.structures?.find(value => value.cpuShare > 0); const gpu = frame.structures?.find(value => value.gpuShare > 0)
      sum.cpuMs += cpu ? cpu.cpuMs / cpu.cpuShare : 0; sum.gpuMs += gpu ? gpu.gpuMs / gpu.gpuShare : 0
      return sum
    }, { cpuMs: 0, gpuMs: 0 })
    const structures = codeStructureCosts(details.flatMap(frame => (frame.structures ?? []).map(value => ({ ...value, gpuMs: 0 }))), details.flatMap(frame => (frame.structures ?? []).map(value => ({ ...value, cpuMs: 0 }))), totals)
    const reuse = details.reduce((sum, frame) => { for (const key of Object.keys(sum) as Array<keyof typeof sum>) sum[key] += frame.reuse?.[key] ?? 0; return sum }, { culledGroups: 0, culledDraws: 0, frameHits: 0, subtreeHits: 0, subtreeMisses: 0, operations: 0 })
    const layers = codeLayerTotals(frames)
    return [{ frame: frames.at(-1)!.frame, cpuMs: frames.reduce((sum, value) => sum + value.cpuMs, 0), gpuMs, budgetMs: frames.at(-1)!.budgetMs, ...(heaviest ? { heaviest } : {}), ...(details.length ? { structures, reuse, attribution: 'draw-preparation-wall' as const } : {}), ...(layers ? { layers } : {}) }]
  }
  releaseUnused(keys: ReadonlySet<string>): void { for (const key of this.surfaces.keys()) if (!keys.has(key)) this.releaseSurface(key); this.builtinRuntime?.releaseIdle(); this.graphCache?.releaseIdle() }
  /** WebGPU exposes no available-VRAM query. Use the owned texture-byte budget,
   * reserving half for layers/effects; resolution determines the target count. */
  generatorTargetCapacity(width: number, height: number): number {
    return Math.max(1, Math.floor(MAX_RESIDENT_BYTES / 2 / (width * height * 4)))
  }
  /** Spill a completed generator target before reusing its GPU budget. The caller
   * owns the bitmap until composition completes; only this keyed surface retires. */
  async spillGeneratorTarget(key: string): Promise<ImageBitmap> {
    const surface = this.surfaces.get(key)
    if (!surface || surface.picture.highPrecision) throw new CodeMaterialError('CONTEXT', '生成器缓存目标不存在。')
    const { width, height, texture } = surface.picture
    this.bitmapBridge ??= new VideoEditGpuBitmapBridge(this.device)
    const bitmap = this.bitmapBridge.copy(texture, width, height)
    await this.device.queue.onSubmittedWorkDone()
    this.releaseSurface(key)
    return bitmap
  }

  /** Only evict prior nested output frames; generated/effect surfaces have their own existing owner. */
  releaseNestedFrames(keys: ReadonlySet<string>): void { for (const key of this.surfaces.keys()) if (key.startsWith('nested:frame:') && !keys.has(key)) this.releaseSurface(key) }
  private releaseSurface(key: string): void {
    const surface = this.surfaces.get(key)
    if (!surface) return
    this.retiredTextures.add(surface.picture.texture)
    surface.picture.texture.destroy(); surface.buffers.forEach(buffer => buffer?.destroy()); surface.filterBuffer?.destroy(); surface.mixBuffer?.destroy(); this.bytes -= surface.bytes; this.surfaces.delete(key)
    if (surface.picture.highPrecision) this.preciseBytes -= surface.bytes
  }
  diagnostics(): { residentBytes: number; surfaces: number; glyphs: number; pipelines: number; pipelineCompiles: number; textureAllocations: number; externalCopies: number; generatorFrames: number; filterFrames: number; mixFrames: number; builtinFrames: number } {
    return { ...this.counts, pipelineCompiles: this.counts.pipelineCompiles, externalCopies: this.counts.externalCopies, residentBytes: this.bytes, surfaces: this.surfaces.size, glyphs: this.glyphs.size, pipelines: this.disposed ? 0 : 2 + Number(!!this.image) + this.mixPipelines.size }
  }
  dispose(): Promise<void> {
    if (this.closing) return this.closing
    this.disposed = true
    this.closing = this.close()
    return this.closing
  }
  private async close(): Promise<void> {
    const failures: unknown[] = []
    this.stopFonts()
    await Promise.allSettled([...this.authorWork])
    this.bitmapBridge?.dispose(); this.bitmapBridge = undefined
    try { await this.authorPrograms?.dispose() } catch (error) { failures.push(error) }
    this.authorPrograms = undefined
    await this.ready.catch(() => {}); await this.imageReady?.catch(() => {}); await Promise.allSettled([...this.mixReady.values(), ...this.maskedMixPipelines.values()])
    await this.pending.catch(() => {})
    this.releaseUnused(new Set()); this.builtinRuntime?.dispose(); this.builtinRuntime = undefined; this.graphCache?.dispose(); this.graphCache = undefined; this.glTransitionRuntime?.dispose(); this.glTransitionRuntime = undefined; this.transparentPixel?.destroy(); this.transparentPixel = undefined; for (const glyph of this.glyphs.values()) { glyph.texture.destroy(); this.bytes -= glyph.bytes }
    this.glyphs.clear(); this.image = undefined; this.mixPipelines.clear(); this.maskedMixPipelines.clear()
    if (failures.length) throw new AggregateError(failures, '代码渲染资源释放失败。')
  }
}
