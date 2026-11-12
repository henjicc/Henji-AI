import { codeSimulationIdentity } from '@/core/videoEdit/codeSimulation'
import { loadAuthorCandidate, readAuthorCandidateMetadata, releaseAuthorCandidate } from './videoEditAuthorCandidates'
import type { CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import { VideoEditGpuBitmapBridge } from './videoEditGpuBitmapBridge'
import { VideoEditGpuDeviceLostError, VideoEditGpuFrameError } from './videoEditGpuFailure'
import { VideoEditFrameGpu, videoEditGpuLedger, type VideoEditGpuWindow } from './videoEditGpuErrorScope'
import { VideoEditGpuFrameFences, type VideoEditGpuFrameFence } from './videoEditGpuFrameFence'
import { recordVideoEditPreparation, videoEditGpuTimer, videoEditRenderDiagnosticsEnabled } from './videoEditPreparationTiming'
import { traceVideoEditFrame } from './videoEditFrameTrace'
import { documentFontRevision } from '@/platform/fontFaces'
import { VideoSample } from 'mediabunny'
import { rasterizeVideoEditText, videoEditTextRasterSize, videoEditTextResolution, type VideoEditTextRaster } from './videoEditTextSurface'
import { defaultVideoEditTextStyle, scaleVideoEditTextStyle } from '@/core/videoEdit/text'
import { VIDEO_EDIT_PRECISE_FORMAT, VideoEditGpuFrame, videoEditGpuFrameFormat, videoEditPictureHighPrecision, type VideoEditGpuColorFormat, type VideoEditOwnedFormat } from './videoEditGpuFrame'
import { VIDEO_EDIT_CACHED_YUV_SHADER, VIDEO_EDIT_COPY_SHADER, VIDEO_EDIT_FRAME_BLEND_SHADER, VIDEO_EDIT_PRESENT_SHADER, VIDEO_EDIT_READBACK_USAGE, readVideoEditPreciseRow, videoEditDownscaleCopyShader, videoEditLayerShader, videoEditFloatCodeLayerShader } from './videoEditGpuShaders'
import { isVideoEditRenderDivisor } from '@/core/videoEdit/playbackResolution'
import { VideoEditNativePicture } from './videoEditNativePicture'
import type { NativeVideoFrame } from './videoEditNativeFrames'
import { VideoEditWebPicture } from './videoEditWebInputs'
import { codeWebPixelSize } from '@/core/videoEdit/codeMaterial/webSource'
import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import { ImageEditWebGpuDeviceManager } from '@/core/imageEdit/webgpu/deviceManager'
import { getWebGpuContext, type GpuDevice, type GpuTexture, type GpuBuffer, type GpuRenderPipeline } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { VideoEditCodeGpu } from './videoEditCodeGpu'
import { VideoEditCodePicture } from './videoEditCodePicture'
import { setVideoEditMaxTextureDimension, videoEditGpuBudget, videoEditMaxTextureDimension } from './videoEditGpuBudget'
import { type AuthorFrameInfo, type AuthorParameters, type AuthorWebFrame } from './videoEditAuthorModule'
import { VideoEditAuthorRuntime } from './videoEditAuthorRuntime'
import type { AuthorSourceLocations } from './videoEditAuthorBundle'
import type { AuthorElementObservation, AuthorElementOverrides } from './videoEditAuthorElements'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'
import { videoEditClipTrackingQuad } from './videoEditTrackResults'
import { videoEditCornerPinMatrix } from '@/core/videoEdit/tracking'

interface VideoGpuDevice extends GpuDevice {
  importExternalTexture(descriptor: { source: VideoFrame }): unknown
  queue: GpuDevice['queue'] & { writeTexture(destination: unknown, data: Uint8Array, layout: unknown, size: unknown): void }
}
const blankTexturesByDevice = new WeakMap<GpuDevice, Map<string, { texture: GpuTexture; users: number }>>()
export type VideoEditPicture = VideoSample | VideoEditGpuFrame | VideoEditCodePicture | ImageBitmap | null
interface LayerPipelines { video: GpuRenderPipeline; image: GpuRenderPipeline; codeImage: GpuRenderPipeline; cachedVideo: GpuRenderPipeline }
export type VideoEditPresentationCapture = ((pixels: Promise<ImageBitmap>) => void) & { maxPixels?: number; gpu?: boolean }
interface PresentationBuffer extends GpuBuffer { mapAsync(mode: number): Promise<void>; getMappedRange(): ArrayBuffer; unmap(): void }
interface PresentationEncoder { copyTextureToBuffer(source: unknown, destination: unknown, size: unknown): void }
/** Full resolution composition, shared by preview and export. VideoFrames stay on
 * the GPU import path; no CPU pixels or thumbnail-sized intermediate surfaces.
 *
 * Precision (task 2.7): a frame whose inputs are all 8-bit composes straight into the 8-bit canvas exactly as before.
 * A frame with any high-precision input (10-bit and deeper material, native `rgbaf16`, or effects/transitions built
 * on them) composes into one `rgba16float` target of the canvas size and is quantized to the canvas, with a fixed
 * dither, in a final pass of the same submission. */
export class VideoEditGpuCompositor {
  // 诊断会话申请 GPU 时间戳（适配器支持才申请），用来量合成与作者入口的 GPU 分段；正常会话设备描述不变。
  private readonly manager = new ImageEditWebGpuDeviceManager(videoEditRenderDiagnosticsEnabled() ? { optionalFeatures: ['timestamp-query'] } : {})
  private readonly context
  private device!: VideoGpuDevice
  private video!: GpuRenderPipeline
  private image!: GpuRenderPipeline
  private codeImage!: GpuRenderPipeline
  private codeRuntime?: VideoEditCodeGpu
  private spatialRuntime?: import('./videoEditSpatialComposite').VideoEditSpatialGpu
  private threeSpaceRuntime?: Promise<import('./videoEditThreeSpace').VideoEditThreeSpace>
  private readonly authorRuntimes = new Map<string, VideoEditAuthorRuntime>()
  private bitmapBridge?: VideoEditGpuBitmapBridge
  private readonly inputBitmaps = new Set<ImageBitmap>()
  private inputGeneration = 0
  private readonly authorAssets = new Map<string, Record<string, ImageBitmap>>()
  private authorFloatPresentation?: GpuRenderPipeline
  private authorPresentation?: GpuRenderPipeline
  private authorTarget?: { texture: GpuTexture; width: number; height: number }

  private async authorRuntime(url: string, locations?: AuthorSourceLocations, apiVersion?: number, bundle?: CodeAuthorBundle): Promise<VideoEditAuthorRuntime> {
    await this.ready
    let runtime = this.authorRuntimes.get(url)
    if (!runtime) {
      runtime = new VideoEditAuthorRuntime(this.device, await loadAuthorCandidate(url, bundle, apiVersion), locations, false, apiVersion, undefined, (await this.code()).effectAllocator)
      this.authorRuntimes.set(url, runtime)
    }
    return runtime
  }
  /** Metadata and candidate drawing share the executed module and its lifetime. */
  async readAuthorMetadata(url: string, locations?: AuthorSourceLocations, apiVersion?: number, bundle?: CodeAuthorBundle): Promise<import('./videoEditAuthorParameters').AuthorEffectMetadata> {
    void locations
    return readAuthorCandidateMetadata(url, apiVersion, bundle)
  }
  async releaseAuthor(url: string): Promise<void> {
    const runtime = this.authorRuntimes.get(url)
    this.authorRuntimes.delete(url)
    const assets = this.authorAssets.get(url)
    this.authorAssets.delete(url)
    try { await runtime?.dispose() }
    finally { await releaseAuthorCandidate(url); if (assets) for (const image of Object.values(assets)) image.close() }
  }
  private async disposeAuthorRuntimes(): Promise<void> {
    const runtimes = [...this.authorRuntimes.entries()]
    this.authorRuntimes.clear()
    const released = await Promise.allSettled(runtimes.map(async ([url, runtime]) => { try { await runtime.dispose() } finally { await releaseAuthorCandidate(url) } }))
    const failures = released.flatMap(result => result.status === 'rejected' ? [result.reason] : [])
    if (failures.length) throw new AggregateError(failures, '作者预览资源释放失败。')
  }

  /** Candidate frames use the same worker/device as the timeline, before publication. */
  async renderAuthorFrame(url: string, params: AuthorParameters, info: AuthorFrameInfo, assets?: Record<string, ImageBitmap>, options?: { overrides?: AuthorElementOverrides; locations?: AuthorSourceLocations; observe?: boolean; apiVersion?: number; bundle?: CodeAuthorBundle }, signal?: AbortSignal): Promise<{ bitmap: ImageBitmap; elapsedMs: number; elements?: AuthorElementObservation[] }> {
    await this.ready
    if (assets) {
      for (const image of Object.values(this.authorAssets.get(url) ?? {})) image.close()
      this.authorAssets.set(url, assets)
    }
    const runtime = await this.authorRuntime(url, options?.locations, options?.apiVersion, options?.bundle)
    const width = this.canvas.width, height = this.canvas.height
    if (!this.authorTarget || this.authorTarget.width !== width || this.authorTarget.height !== height) {
      this.authorTarget?.texture.destroy()
      this.authorTarget = { texture: this.device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: 0x01 | 0x02 | 0x04 | 0x08 | 0x10 }), width, height }
    }
    if (!this.authorPresentation) {
      const module = this.device.createShaderModule({ code: `
@group(0) @binding(0) var picture:texture_2d<f32>;
@vertex fn vs(@builtin(vertex_index) i:u32)->@builtin(position) vec4f {
 let p=array<vec2f,3>(vec2f(-1,-1),vec2f(3,-1),vec2f(-1,3)); return vec4f(p[i],0,1);
}
@fragment fn fs(@builtin(position) p:vec4f)->@location(0) vec4f { return textureLoad(picture,vec2i(p.xy),0); }` })
      this.authorPresentation = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.canvasFormat }] }, primitive: { topology: 'triangle-list' } })
    }
    const assertCurrent = () => { if (signal?.aborted) throw new DOMException('试画已取消。', 'AbortError') }
    const started = performance.now()
    // 作者代码在 await 里提交，中间让出，窗口会与同时在途的节目帧重叠。
    const gpu = videoEditGpuLedger(this.device).open()
    let fence: VideoEditGpuFrameFence | undefined
    try {
      const simulationInput = { identity: codeSimulationIdentity(url, params, { width, height }, runtime.parameterMetadata.simulation), parametersAt: () => params, signal, assertCurrent }
      assertCurrent()
      await runtime.render(this.authorTarget.texture, width, height, params, this.authorAssets.get(url) ?? {}, info, options?.overrides, undefined, true, undefined, undefined, 'interactive', assertCurrent, undefined, simulationInput)
      assertCurrent()
      const rendered = runtime.outputTexture ?? this.authorTarget.texture
      const precise = rendered.format === VIDEO_EDIT_PRECISE_FORMAT
      if (precise && !this.authorFloatPresentation) {
        const module = this.device.createShaderModule({ code: VIDEO_EDIT_PRESENT_SHADER })
        this.authorFloatPresentation = this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.canvasFormat }] }, primitive: { topology: 'triangle-list' } })
      }
      const encoder = this.device.createCommandEncoder(), pipeline = precise ? this.authorFloatPresentation! : this.authorPresentation
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: this.context.getCurrentTexture().createView(), loadOp: 'clear', storeOp: 'store' }] })
      pass.setPipeline(pipeline); pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: rendered.createView() }] }))
      pass.draw(3); pass.end()
      fence = this.fences!.arm(encoder)
      this.device.queue.submit([encoder.finish()])
      gpu.end()
      const finished = fence; fence = undefined
      await finished.wait()
    } catch (error) { gpu.discard(); fence?.abandon(); throw error }
    const [fault] = await gpu.settle()
    if (fault) throw new Error(`作者效果 GPU 执行失败：${fault.message}`)
    assertCurrent()
    return { elapsedMs: performance.now() - started, bitmap: this.canvas.transferToImageBitmap(), ...(options?.observe ? { elements: runtime.observeElements() } : {}) }
  }
  private copyY!: GpuRenderPipeline
  private copyUv!: GpuRenderPipeline
  private copyRgba!: GpuRenderPipeline
  private readonly copyDeep = new Map<VideoEditOwnedFormat, GpuRenderPipeline>()
  private cachedVideo!: GpuRenderPipeline
  /** Reduced playback resolution (task 4.9): decoded pictures enter owned memory at 1/divisor size; export keeps 1. */
  private pictureDivisor: number = 1
  /** Copies per divisor and source transfer, compiled on first use: [y, uv, rgba by owned format]. */
  private readonly downscale = new Map<string, Promise<{ y: GpuRenderPipeline; uv: GpuRenderPipeline; rgba: Map<string, GpuRenderPipeline> }>>()
  private canvasFormat = 'bgra8unorm'
  /** Layer pipelines for owned targets, per target format; compiled on first use. */
  private readonly offscreen = new Map<VideoEditGpuColorFormat, Promise<LayerPipelines>>()
  private presentReady?: Promise<GpuRenderPipeline>
  /** The `rgba16float` composition target of high-precision frames, canvas-sized, kept until size change or dispose. */
  private precise?: { texture: GpuTexture; width: number; height: number }
  /** 运动模糊的累积图与相加混合管线（第一次用到运动模糊时才建）。 */
  private motionTarget?: { texture: GpuTexture; width: number; height: number }
  private readonly motionAdditive = new Map<boolean, Promise<LayerPipelines>>()
  private readonly precision = { snapshots: 0, frames: 0 }
  private sampler: unknown
  private readonly uniforms = new Map<string, GpuBuffer>()
  private readonly textures = new Map<string, { texture: GpuTexture; key: string; bytes: number; textRaster?: Omit<VideoEditTextRaster, 'canvas'> }>()
  private protectedImages = new Set<string>()
  private protectedUniforms = new Set<string>()
  private imageUploads = 0
  private readonly imageIds = new WeakMap<ImageBitmap, number>()
  private nextImageId = 0
  private lost: string | undefined
  private readonly ready: Promise<void>
  private readonly waits = new Set<() => void>()
  /** 在途的合成帧，只用于背压：只等结清，帧的失败交给各自的 `completion`，不在后面的帧里抛出。 */
  private readonly uploads = new Set<Promise<void>>()
  private fences?: VideoEditGpuFrameFences
  private readonly copies = new Set<Promise<void>>()
  private disposed = false
  private readonly pool: Array<{ width: number; height: number; format: string; texture: GpuTexture; chroma?: GpuTexture; bytes: number }> = []
  private readonly blankReleases = new Set<() => void>()
  /** 帧混合管线，按输出平面格式；首次使用时编译。 */
  private readonly blendPipelines = new Map<string, Promise<GpuRenderPipeline>>()
  constructor(readonly canvas: OffscreenCanvas, private readonly shared?: VideoEditGpuCompositor, private readonly capturePresentation?: () => VideoEditPresentationCapture | undefined, readyTiming?: (durationMs: number, stage?: string) => void, private readonly onPresentationWait?: () => void) {
    this.context = getWebGpuContext(canvas)
    this.manager.onDeviceLost(reason => { this.lost = reason })
    const started = performance.now()
    this.ready = this.initialize(readyTiming).then(() => { readyTiming?.(performance.now() - started) })
  }
  async prepare(): Promise<void> {
    await this.ready
    this.assertDevice()
    if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用，请重新加载预览。')
  }
  /** 这一帧的提交窗口从这里开始；嵌套合成与代码画面共用设备，提交都落在根帧的窗口里。 */
  async beginFrameGpu(): Promise<VideoEditFrameGpu> {
    await this.ready
    return new VideoEditFrameGpu(videoEditGpuLedger(this.device))
  }
  private assertDevice(): void {
    this.shared?.assertDevice()
    if (this.lost) throw new VideoEditGpuDeviceLostError(this.lost)
  }
  private async initialize(timing?: (durationMs: number, stage?: string) => void): Promise<void> {
    const deviceStarted = performance.now()
    const managed = this.shared ? undefined : await this.manager.acquire()
    if (this.shared) await this.shared.ready
    recordVideoEditPreparation('adapterDevice', performance.now() - deviceStarted)
    timing?.(performance.now() - deviceStarted, 'device')
    const pipelineStarted = performance.now()
    this.device = this.shared?.device ?? managed!.device as VideoGpuDevice
    setVideoEditMaxTextureDimension((this.device as VideoGpuDevice & { limits?: { maxTextureDimension2D?: number } }).limits?.maxTextureDimension2D)
    videoEditGpuLedger(this.device)
    this.fences = new VideoEditGpuFrameFences(this.device, reason => { this.lost ??= reason })
    const format = this.shared?.canvasFormat ?? managed!.provider.getPreferredCanvasFormat()
    this.canvasFormat = format
    this.context.configure({ device: this.device, format, alphaMode: 'premultiplied', usage: 0x10 | 0x01 })
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.device.pushErrorScope('validation')
    let keys: Array<keyof LayerPipelines>, pending: Array<Promise<GpuRenderPipeline>>
    try {
      // Independent pipelines compile concurrently; no synchronous driver compilation on the first frame.
      const create = (descriptor: unknown): Promise<GpuRenderPipeline> => this.device.createRenderPipelineAsync?.(descriptor) ?? Promise.resolve(this.device.createRenderPipeline(descriptor))
      const layers = this.layerPipelines(format, create)
      keys = Object.keys(layers) as Array<keyof LayerPipelines>
      const copyShader = this.device.createShaderModule({ code: VIDEO_EDIT_COPY_SHADER })
      const copy = (entryPoint: string, format: string): Promise<GpuRenderPipeline> => create({ layout: 'auto', vertex: { module: copyShader, entryPoint: 'vs' }, fragment: { module: copyShader, entryPoint, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
      pending = [...keys.map(key => layers[key]), copy('y', 'r8unorm'), copy('uv', 'rg8unorm'), copy('rgba', 'rgba8unorm'), copy('rgba', 'rgb10a2unorm'), copy('rgba', 'rgba16float')]
    } catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
    // 作用域是设备级栈：等待异步管线前弹出，避免与同设备其他区段交错；异步管线的失败由 Promise 交回。
    const scope = this.device.popErrorScope()
    const results = await Promise.allSettled(pending)
    const error = await scope
    const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
    if (failed) throw failed.reason
    if (error) throw new Error(`无法初始化剪辑 GPU 合成：${error.message}`)
    const pipelines = results.map(result => (result as PromiseFulfilledResult<GpuRenderPipeline>).value)
    for (const [index, key] of keys.entries()) this[key] = pipelines[index]
    ;[this.copyY, this.copyUv, this.copyRgba] = pipelines.slice(4, 7)
    this.copyDeep.set('rgb10a2unorm', pipelines[7]); this.copyDeep.set('rgba16float', pipelines[8])
    recordVideoEditPreparation('compositorPipelines', performance.now() - pipelineStarted)
    timing?.(performance.now() - pipelineStarted, 'pipelines')
  }
  /** Nested layers must belong to this device so the parent can sample them without readback or 8-bit quantization. */
  fork(canvas: OffscreenCanvas, capturePresentation?: () => VideoEditPresentationCapture | undefined): VideoEditGpuCompositor { return new VideoEditGpuCompositor(canvas, this, capturePresentation) }
  private layerPipelines(format: string, create?: undefined, mode?: 'over' | 'add', floatCode?: boolean): LayerPipelines
  private layerPipelines(format: string, create: (descriptor: unknown) => Promise<GpuRenderPipeline>): { [K in keyof LayerPipelines]: Promise<GpuRenderPipeline> }
  private layerPipelines(format: string, create: (descriptor: unknown) => GpuRenderPipeline | Promise<GpuRenderPipeline> = descriptor => this.device.createRenderPipeline(descriptor), mode: 'over' | 'add' = 'over', floatCode = format === VIDEO_EDIT_PRECISE_FORMAT): { [K in keyof LayerPipelines]: GpuRenderPipeline | Promise<GpuRenderPipeline> } {
    // over：预乘 alpha 的“盖在上面”；add：运动模糊累积时把各次取样直接相加。
    const factor = mode === 'add' ? 'one' : 'one-minus-src-alpha'
    const blend = { color: { srcFactor: 'one', dstFactor: factor }, alpha: { srcFactor: 'one', dstFactor: factor } }
    const pipeline = (code: string): GpuRenderPipeline | Promise<GpuRenderPipeline> => {
      const shader = this.device.createShaderModule({ code })
      return create({ layout: 'auto', vertex: { module: shader, entryPoint: 'vs' }, fragment: { module: shader, entryPoint: 'fs', targets: [{ format, blend }] }, primitive: { topology: 'triangle-list' } })
    }
    const video = pipeline(videoEditLayerShader(true)); const image = pipeline(videoEditLayerShader(false)); const codeImage = pipeline(floatCode ? videoEditFloatCodeLayerShader() : videoEditLayerShader(false, true))
    return { video, image, codeImage, cachedVideo: pipeline(VIDEO_EDIT_CACHED_YUV_SHADER) }
  }
  private async compiled<T>(build: () => T, failure: string): Promise<T> {
    await this.ready
    this.assertDevice()
    if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用。')
    this.device.pushErrorScope('validation')
    let result: T
    try { result = build() }
    catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
    const error = await this.device.popErrorScope()
    if (error) throw new Error(`${failure}：${error.message}`)
    this.assertDevice()
    if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用。')
    return result
  }
  /**
   * 运动模糊的累积：rgba16float 离屏图（按序列尺寸复用）与相加混合的图层管线。多次取样按 1/N 不透明度相加，
   * 半浮点精度下平均不会出现 8 位量化的色带。
   */
  private motionResources(width: number, height: number, floatCode: boolean): Promise<{ target: GpuTexture; additive: LayerPipelines }> {
    let pending = this.motionAdditive.get(floatCode)
    if (!pending) { pending = this.compiled(() => this.layerPipelines(VIDEO_EDIT_PRECISE_FORMAT, undefined, 'add', floatCode), '运动模糊合成管线初始化失败'); this.motionAdditive.set(floatCode, pending) }
    return pending.then(additive => {
      if (!this.motionTarget || this.motionTarget.width !== width || this.motionTarget.height !== height) {
        this.motionTarget?.texture.destroy()
        this.motionTarget = { texture: this.device.createTexture({ size: [width, height], format: VIDEO_EDIT_PRECISE_FORMAT, usage: 0x10 | 0x04 }), width, height }
      }
      return { target: this.motionTarget.texture, additive }
    })
  }
  /** Layer pipelines writing an owned target of `format` (offscreen code surfaces and the high-precision target). */
  private offscreenPipelines(format: VideoEditGpuColorFormat): Promise<LayerPipelines> {
    let ready = this.offscreen.get(format)
    if (!ready) { ready = this.compiled(() => this.layerPipelines(format), '离屏合成管线初始化失败'); this.offscreen.set(format, ready) }
    return ready
  }
  /** Pictures snapshotted from now on are stored at 1/divisor of their decoded size; the layer shader samples them by UV. */
  setPictureDivisor(divisor: number): void { this.pictureDivisor = divisor; this.codeRuntime?.setRenderDivisor(divisor) }
  private downscalePipelines(divisor: 1 | 2 | 4 | 8, srgb = false): Promise<{ y: GpuRenderPipeline; uv: GpuRenderPipeline; rgba: Map<string, GpuRenderPipeline> }> {
    const key = `${divisor}:${srgb}`
    let ready = this.downscale.get(key)
    if (!ready) {
      ready = this.compiled(() => {
        const module = this.device.createShaderModule({ code: divisor === 1 ? VIDEO_EDIT_COPY_SHADER : videoEditDownscaleCopyShader(divisor) })
        const copy = (entryPoint: string, format: string): GpuRenderPipeline => this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint, constants: { SRGB_TO_REC709: Number(srgb) }, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
        return { y: copy('y', 'r8unorm'), uv: copy('uv', 'rg8unorm'), rgba: new Map((['rgba8unorm', 'rgb10a2unorm', 'rgba16float'] as const).map(format => [format, copy('rgba', format)])) }
      }, '缩小回放分辨率的复制管线初始化失败')
      this.downscale.set(key, ready)
      ready.catch(() => { if (this.downscale.get(key) === ready) this.downscale.delete(key) })
    }
    return ready
  }
  /** Final pass of a high-precision frame: `rgba16float` target to the canvas format, with the fixed dither. */
  private presentPipeline(): Promise<GpuRenderPipeline> {
    return this.presentReady ??= this.compiled(() => {
      const module = this.device.createShaderModule({ code: VIDEO_EDIT_PRESENT_SHADER })
      return this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: this.canvasFormat }] }, primitive: { topology: 'triangle-list' } })
    }, '高精度合成呈现管线初始化失败')
  }
  private preciseTarget(): GpuTexture {
    const { width, height } = this.canvas
    if (this.precise && (this.precise.width !== width || this.precise.height !== height)) { this.precise.texture.destroy(); this.precise = undefined }
    this.precise ??= { texture: this.device.createTexture({ size: [width, height], format: VIDEO_EDIT_PRECISE_FORMAT, usage: 0x04 | 0x10 | VIDEO_EDIT_READBACK_USAGE }), width, height }
    return this.precise.texture
  }
  /** Deferred copies may only be consumed on this device/queue. The final draw
   * completion covers earlier copies; retain decoder frames until their fence.
   * A borrowed native frame is imported as is and stays borrowed until the copy's fence: it is never closed here
   * (closing a shared texture frame in a worker crashes the renderer process, record 002).
   * Owned format: compact 4:2:0 planes when `compact`; otherwise `videoEditGpuFrameFormat()` (`rgb10a2unorm` or
   * `rgba16float` for more than 8 bits, `rgba8unorm` for the rest). */
  async snapshot(sample: VideoSample | VideoEditNativePicture, compact: boolean, deferCompletion = false, pictureDivisor?: number): Promise<VideoEditGpuFrame> {
    await this.ready
    if (this.disposed) throw new Error('剪辑预览已关闭。')
    this.assertDevice()
    while (this.copies.size >= 2) {
      await Promise.race(this.copies)
      if (this.disposed) throw new Error('剪辑预览已关闭。')
      this.assertDevice()
    }
    if (this.disposed) throw new Error('剪辑预览已关闭。')
    // A reduced playback resolution copies a box-averaged picture of 1/divisor size (task 4.9); the frame keeps its
    // display size, so placement, fit and effects are unchanged and only the stored pixels shrink. `pictureDivisor`
    // overrides it for one copy (the program's resident jump pictures, `videoEditJumpPreview.ts`).
    // 整数预览沿用 box 采样；连续比例保留源采样，由合成器已有的纹理缩放完成重采样。
    const requestedDivisor = pictureDivisor ?? this.pictureDivisor
    const divisor = isVideoEditRenderDivisor(requestedDivisor) ? requestedDivisor : 1
    let reduced = divisor === 1 ? undefined : await this.downscalePipelines(divisor)
    if (this.disposed) throw new Error('剪辑预览已关闭。')
    // Copy on the compositor's device; no Skia canvas or cross-context fences.
    const borrowed = sample instanceof VideoEditNativePicture
    const frame = borrowed ? sample.frame : sample.toVideoFrame()
    const closeFrame = (): void => { if (!borrowed) frame.close() }
    const decodedWidth = frame.visibleRect?.width ?? sample.codedWidth; const decodedHeight = frame.visibleRect?.height ?? sample.codedHeight
    const width = Math.max(1, Math.ceil(decodedWidth / divisor)); const height = Math.max(1, Math.ceil(decodedHeight / divisor))
    const uvWidth = Math.ceil(width / 2); const uvHeight = Math.ceil(height / 2)
    // A native picture without decoder details is treated as having alpha and more than 10 bits (rgba16float).
    const owned = compact ? undefined : videoEditGpuFrameFormat(sample, borrowed ? sample.sourceDepth ?? { bitDepth: null, hasAlpha: true } : undefined)
    const highPrecision = owned !== undefined && owned !== 'rgba8unorm'
    const format = owned ?? 'r8unorm'
    const index = this.pool.findIndex(entry => entry.width === width && entry.height === height && entry.format === format)
    const recycled = index >= 0 ? this.pool.splice(index, 1)[0] : undefined
    const texture = recycled?.texture ?? this.device.createTexture({ size: [width, height], format, usage: 0x04 | 0x10 })
    const chroma = compact ? recycled?.chroma ?? this.device.createTexture({ size: [uvWidth, uvHeight], format: 'rg8unorm', usage: 0x04 | 0x10 }) : undefined
    const bytes = compact ? width * height + uvWidth * uvHeight * 2 : width * height * (owned === 'rgba16float' ? 8 : 4)
    let retained = false
    let copying: VideoEditGpuWindow | undefined
    try {
      if (frame.colorSpace?.transfer === 'iec61966-2-1') reduced = await this.downscalePipelines(divisor, true)
      // 延迟完成的复制由使用它的帧负责：不认领，落在那一帧的窗口里。
      if (!deferCompletion) copying = videoEditGpuLedger(this.device).openSync()
      const encoder = this.device.createCommandEncoder()
      const resource = this.device.importExternalTexture({ source: frame })
      const planes: Array<readonly [GpuTexture, GpuRenderPipeline]> = reduced
        ? chroma ? [[texture, reduced.y], [chroma, reduced.uv]] : [[texture, reduced.rgba.get(format)!]]
        : chroma ? [[texture, this.copyY], [chroma, this.copyUv]] : [[texture, this.copyDeep.get(format as VideoEditOwnedFormat) ?? this.copyRgba]]
      for (const [target, pipeline] of planes) {
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource }] }))
        pass.draw(3); pass.end()
      }
      this.device.queue.submit([encoder.finish()])
      copying?.end()
      const completion = this.device.queue.onSubmittedWorkDone().finally(() => { closeFrame(); this.copies.delete(completion) })
      if (borrowed) sample.holdUntil(completion)
      this.copies.add(completion); retained = true
      void completion.catch(() => {})
      if (!deferCompletion) await completion
      const faults = await copying?.settle()
      if (faults?.length) throw new VideoEditGpuFrameError('content', faults.map(fault => fault.message))
      if (highPrecision) this.precision.snapshots++
      return new VideoEditGpuFrame(sample, texture, chroma, bytes, () => {
        // Reuse evicted allocations instead of stalling the driver at every
        // working-set boundary. Idle pool has a separate hard 64 MiB ceiling
        // (one 4K rgba16float picture, 63.3 MiB, still fits).
        if (!this.disposed && this.pool.length < 4 && this.pool.reduce((sum, entry) => sum + entry.bytes, 0) + bytes <= 64 * 1024 ** 2) this.pool.push({ width, height, format, texture, chroma, bytes })
        else { texture.destroy(); chroma?.destroy() }
      }, undefined, highPrecision)
    } catch (error) { copying?.discard(); texture.destroy(); chroma?.destroy(); throw error } finally { if (!retained) closeFrame() }
  }
  /**
   * 网页画面：把借来的共享纹理帧左上角 width×height 原样拷进本设备的 rgba8unorm 纹理（网页内容与图片、Canvas 一样按
   * sRGB 数值使用，不做转换），提交后交回帧。传入同尺寸的 `target` 时原地覆盖：同一队列上更早读它的工作都已提交。
   */
  async copyWebFrame(native: NativeVideoFrame, width: number, height: number, target?: GpuTexture): Promise<{ texture: GpuTexture; owner: GpuDevice }> {
    try {
      await this.ready
      if (this.disposed) throw new Error('剪辑预览已关闭。')
      this.assertDevice()
    } catch (error) { native.release(); throw error }
    const texture = target ?? this.device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: 0x02 | 0x04 | 0x10 })
    try {
      const encoder = this.device.createCommandEncoder()
      const resource = this.device.importExternalTexture({ source: native.frame })
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: texture.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
      pass.setPipeline(this.copyRgba)
      pass.setBindGroup(0, this.device.createBindGroup({ layout: this.copyRgba.getBindGroupLayout(0), entries: [{ binding: 0, resource }] }))
      pass.draw(3); pass.end()
      this.device.queue.submit([encoder.finish()])
      if (native.meta.webRestore) {
        const restore = native.meta.webRestore
        if (width < 8 || height < 4 || restore.length !== 1024 || !restore.every(value => Number.isInteger(value) && value >= 0 && value <= 255)) throw new Error('网页快照原始像素无效')
        this.device.queue.writeTexture({ texture }, Uint8Array.from(restore), { bytesPerRow: 256 }, [8, 4])
      }
    } catch (error) {
      if (!target) texture.destroy()
      native.release()
      throw error
    }
    native.release(this.device)
    return { texture, owner: this.device }
  }
  /** 占位由设备按尺寸共享；作者可直接读取输入尺寸，不能把透明纹理的 1×1 暴露为内容尺寸。 */
  private blankTexture(width: number, height: number): { texture: GpuTexture; release: () => void } {
    const key = `${width}x${height}`
    let pool = blankTexturesByDevice.get(this.device)
    if (!pool) { pool = new Map(); blankTexturesByDevice.set(this.device, pool) }
    let entry = pool.get(key)
    if (!entry) {
      entry = { texture: this.device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: 0x04 }), users: 0 }
      pool.set(key, entry)
    }
    entry.users++
    const borrowed = entry
    let released = false
    const release = (): void => {
      if (released) return
      released = true
      this.blankReleases.delete(release)
      const completed = this.device.queue.onSubmittedWorkDone().catch(() => undefined).then(() => {
        if (--borrowed.users === 0) { borrowed.texture.destroy(); pool!.delete(key) }
      }).finally(() => this.copies.delete(completed))
      this.copies.add(completed)
    }
    this.blankReleases.add(release)
    return { texture: entry.texture, release }
  }

  async blank(width: number, height: number, timestamp: number, duration: number): Promise<VideoEditGpuFrame> {
    await this.ready
    this.assertDevice()
    if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用。')
    const w = Math.max(1, Math.ceil(width)), h = Math.max(1, Math.ceil(height))
    const blank = this.blankTexture(w, h)
    return new VideoEditGpuFrame({ timestamp, duration, displayWidth: w, displayHeight: h, rotation: 0, flip: false }, blank.texture, undefined, 0, blank.release)
  }
  /** 同尺寸占位不占本帧必需输入预算，由设备池持有到最后一个合成器释放。 */
  async blankWebPicture(web: AuthorWebFrame): Promise<VideoEditWebPicture> {
    await this.ready
    this.assertDevice()
    if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用。')
    const size = codeWebPixelSize(web)
    const blank = this.blankTexture(size.width, size.height)
    const picture = new VideoEditWebPicture(blank.texture, size.width, size.height, this.device, web, false)
    picture.isPlaceholder = true
    picture.releasePlaceholder = blank.release
    return picture
  }
  /**
   * 帧混合（时间重映射补帧）：`a`、`b` 是同一素材相邻两帧，返回 a·(1−weight) + b·weight 的新帧（同尺寸、同格式，
   * 紧凑帧逐平面混合）。两帧结构不同（例如回放分辨率刚切换）时返回 undefined，由调用方退回帧采样。
   */
  async blend(a: VideoEditGpuFrame, b: VideoEditGpuFrame, weight: number): Promise<VideoEditGpuFrame | undefined> {
    await this.ready
    this.assertDevice()
    if (this.disposed) throw new Error('剪辑预览已关闭。')
    type Shape = { width: number; height: number; format: string }
    const shape = (texture: GpuTexture | undefined): Shape | undefined => texture as unknown as Shape | undefined
    const planes = [[shape(a.texture), shape(b.texture)], [shape(a.chroma), shape(b.chroma)]] as const
    if (planes.some(([left, right]) => Boolean(left) !== Boolean(right) || left && right && (left.width !== right.width || left.height !== right.height || left.format !== right.format))) return undefined
    const pipeline = (format: string): Promise<GpuRenderPipeline> => {
      let pending = this.blendPipelines.get(format)
      if (!pending) {
        const module = this.device.createShaderModule({ code: VIDEO_EDIT_FRAME_BLEND_SHADER })
        const descriptor = { layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } }
        pending = Promise.resolve(this.device.createRenderPipelineAsync?.(descriptor) ?? this.device.createRenderPipeline(descriptor))
        this.blendPipelines.set(format, pending)
      }
      return pending
    }
    const luma = planes[0][0]!; const chroma = planes[1][0]
    const texture = this.device.createTexture({ size: [luma.width, luma.height], format: luma.format, usage: 0x04 | 0x10 })
    const chromaTexture = chroma ? this.device.createTexture({ size: [chroma.width, chroma.height], format: chroma.format, usage: 0x04 | 0x10 }) : undefined
    try {
      const uniform = this.device.createBuffer({ size: 16, usage: 0x08 | 0x40 })
      this.device.queue.writeBuffer(uniform, 0, new Float32Array([Math.max(0, Math.min(1, weight)), 0, 0, 0]))
      const encoder = this.device.createCommandEncoder()
      const jobs: Array<readonly [GpuTexture, GpuTexture, GpuTexture, string]> = [[texture, a.texture, b.texture, luma.format], ...(chromaTexture && chroma ? [[chromaTexture, a.chroma!, b.chroma!, chroma.format] as const] : [])]
      for (const [target, left, right, format] of jobs) {
        const program = await pipeline(format)
        const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 0 } }] })
        pass.setPipeline(program)
        pass.setBindGroup(0, this.device.createBindGroup({ layout: program.getBindGroupLayout(0), entries: [{ binding: 0, resource: left.createView() }, { binding: 1, resource: right.createView() }, { binding: 2, resource: { buffer: uniform } }] }))
        pass.draw(3); pass.end()
      }
      this.device.queue.submit([encoder.finish()])
      void this.device.queue.onSubmittedWorkDone().then(() => uniform.destroy(), () => uniform.destroy())
      return new VideoEditGpuFrame(a, texture, chromaTexture, a.allocationSize(), undefined, undefined, a.highPrecision)
    } catch (error) { texture.destroy(); chromaTexture?.destroy(); throw error }
  }
  async code(): Promise<VideoEditCodeGpu> {
    await this.ready
    this.assertDevice()
    if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用，请重新加载预览。')
    if (!this.codeRuntime) {
      const { VideoEditCodeGpu } = await import('./videoEditCodeGpu')
      this.assertDevice()
      if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用，请重新加载预览。')
      this.codeRuntime ??= new VideoEditCodeGpu(this.device)
      // 代码生成器与解码画面共用预览或导出的实际渲染比例。
      this.codeRuntime.setRenderDivisor(this.pictureDivisor)
    }
    return this.codeRuntime
  }
  async spatial(): Promise<import('./videoEditSpatialComposite').VideoEditSpatialGpu> {
    const runtime = await this.code()
    if (!this.spatialRuntime) {
      const { VideoEditSpatialGpu } = await import('./videoEditSpatialComposite')
      this.assertDevice()
      this.spatialRuntime ??= new VideoEditSpatialGpu(this.device, {
        trimIdle: budget => runtime.trimIdleTextures(budget),
        allocate: (spec, mipLevelCount, clear = true) => runtime.effectAllocator.allocate(spec.width, spec.height, spec.format, mipLevelCount, false, clear),
        release: texture => runtime.effectAllocator.release(texture),
      })
    }
    return this.spatialRuntime
  }
  /** 统一三维渲染器（与合成器共用 GPUDevice），第一次用到三维时创建。 */
  threeSpace(): Promise<import('./videoEditThreeSpace').VideoEditThreeSpace> {
    this.assertDevice()
    const pending = this.threeSpaceRuntime ??= import('./videoEditThreeSpace').then(({ VideoEditThreeSpace }) => VideoEditThreeSpace.create(this.device))
    pending.catch(() => { if (this.threeSpaceRuntime === pending) this.threeSpaceRuntime = undefined })
    return pending
  }
  private async disposeThreeSpace(): Promise<void> {
    const pending = this.threeSpaceRuntime
    this.threeSpaceRuntime = undefined
    await (await pending?.catch(() => undefined))?.dispose()
  }
  spatialPicture(lease: Pick<import('./videoEditSpatialContracts').SpatialPictureLease, 'texture' | 'width' | 'height' | 'format' | 'carriesLight'>): VideoEditCodePicture {
    const picture = new VideoEditCodePicture(lease.texture, lease.width, lease.height, this.device, lease.format)
    picture.carriesLight = lease.carriesLight
    return picture
  }
  codePerformance(): import('@/core/videoEdit/codeMaterial/performance').CodeFramePerformance[] { return this.codeRuntime?.framePerformance() ?? [] }
  captureCodePerformance(): () => import('@/core/videoEdit/codeMaterial/performance').CodeFramePerformance[] { return this.codeRuntime?.captureFramePerformance() ?? (() => []) }
  codeDiagnostics(): ReturnType<VideoEditCodeGpu['diagnostics']> | undefined { return this.codeRuntime?.diagnostics() }
  /** High-precision path counters: owned `rgba16float` snapshots, frames composed through the precise target and its size. */
  precisionDiagnostics() { return { highPrecisionSnapshots: this.precision.snapshots, highPrecisionFrames: this.precision.frames, preciseTargetBytes: this.precise ? this.precise.width * this.precise.height * 8 : 0 } }
  /**
   * Raw half floats (RGBA per pixel) of one row of the last high-precision composition, before the 8-bit
   * quantization; undefined when no frame used the precise target. Acceptance probes only (task 2.7).
   */
  async readPreciseRow(y: number): Promise<Uint16Array | undefined> {
    await this.ready
    if (this.disposed || this.lost || !this.precise) return undefined
    const { texture, width, height } = this.precise
    return readVideoEditPreciseRow(this.device, texture, width, Math.min(height - 1, Math.max(0, Math.floor(y))))
  }
  imageDiagnostics() { return { textures: this.textures.size, bytes: [...this.textures.values()].reduce((total, entry) => total + entry.bytes, 0), uploads: this.imageUploads } }
  private imageKey(picture: ImageBitmap): string {
    if (!this.imageIds.has(picture)) this.imageIds.set(picture, ++this.nextImageId)
    return `image:${this.imageIds.get(picture)}`
  }
  /**
   * 纹理按实际栅格尺寸记账。预算只是淘汰目标：超出时先销毁本帧不显示的图片与文字纹理，本帧要画的一律上传，不报错。
   * 图片已按画面需要的尺寸解码（不超过单张纹理上限），文字栅格档位也在上限之内。
   */
  private texture(id: string, key: string, source: ImageBitmap | OffscreenCanvas): GpuTexture {
    const cached = this.textures.get(id)
    if (cached?.key === key) return cached.texture
    const bytes = source.width * source.height * 4
    let retained = [...this.textures.values()].reduce((total, entry) => total + entry.bytes, 0) - (cached?.bytes ?? 0)
    for (const [other, entry] of this.textures) {
      if (retained + bytes <= videoEditGpuBudget().imageBytes) break
      if (other === id || this.protectedImages.has(other)) continue
      entry.texture.destroy(); this.textures.delete(other); retained -= entry.bytes
    }
    const texture = this.device.createTexture({ size: [source.width, source.height], format: 'rgba8unorm', usage: 0x02 | 0x04 | 0x10 })
    const started = performance.now()
    // Preserve the bitmap's premultiplied pixels. Unpremultiplying on upload and
    // multiplying again in the layer shader loses translucent edge precision.
    try { this.device.queue.copyExternalImageToTexture({ source }, { texture, premultipliedAlpha: true }, [source.width, source.height]); recordVideoEditPreparation('codeImageUpload', performance.now() - started) }
    catch (error) { texture.destroy(); throw error }
    cached?.texture.destroy(); this.textures.set(id, { texture, key, bytes }); this.imageUploads++
    return texture
  }
  private retainTextures(keys: ReadonlySet<string>): void {
    for (const [key, value] of this.textures) if (!keys.has(key)) { value.texture.destroy(); this.textures.delete(key) }
  }
  /** Ordinary image clips and code references borrow the same full-size upload. */
  async prepareImages(pictures: ReadonlyMap<string, ImageBitmap | VideoEditCodePicture>, shouldPresent: () => boolean, visibleText: ReadonlySet<string> = new Set(), visibleClips: ReadonlySet<string> = new Set()): Promise<ReadonlyMap<string, VideoEditCodeImageInput>> {
    await this.ready
    if (!shouldPresent() || this.disposed) throw new DOMException('图片画面已取消。', 'AbortError')
    this.assertDevice()
    // 图片与文字按实际纹理尺寸记账（`texture`）；代码画面借用设备上的现有纹理，不上传。
    const unique = new Set(pictures.values())
    for (const image of unique) if (image instanceof VideoEditCodePicture && image.owner !== this.device) throw new Error('视频输入画面不属于当前GPU设备。')
    this.protectedImages = new Set([...unique].filter((image): image is ImageBitmap => !(image instanceof VideoEditCodePicture)).map(image => this.imageKey(image)).concat([...visibleText].map(id => `text:${id}`)))
    this.protectedUniforms = new Set(visibleClips)
    this.retainTextures(new Set([...this.protectedImages, ...[...visibleText].map(id => `text:${id}`)]))
    for (const bitmap of this.inputBitmaps) bitmap.close()
    this.inputBitmaps.clear()
    // GPU consumers sample the texture. The bitmap copy exists only for Canvas-side readers,
    // made on first read and only within this frame (the texture is the timeline's for this frame).
    const generation = ++this.inputGeneration
    const sources = new Map<VideoEditCodePicture, ImageBitmap>()
    const bitmapOf = (picture: VideoEditCodePicture): ImageBitmap => {
      if (generation !== this.inputGeneration || this.disposed) throw new DOMException('图片画面已过期。', 'AbortError')
      let source = sources.get(picture)
      if (!source) {
        this.bitmapBridge ??= new VideoEditGpuBitmapBridge(this.device)
        source = this.bitmapBridge.copy(picture.texture, picture.width, picture.height)
        sources.set(picture, source); this.inputBitmaps.add(source)
      }
      return source
    }
    return new Map<string, VideoEditCodeImageInput>([...pictures].map(([mediaId, picture]): [string, VideoEditCodeImageInput] => {
      if (picture instanceof VideoEditCodePicture) {
        const input: VideoEditCodeImageInput = { texture: picture.texture, width: picture.width, height: picture.height, owner: this.device, premultiplied: true, ...(picture instanceof VideoEditWebPicture ? { web: picture.web } : {}) }
        Object.defineProperty(input, 'source', { enumerable: true, get: () => bitmapOf(picture) })
        return [mediaId, input]
      }
      const key = this.imageKey(picture)
      return [mediaId, { texture: this.texture(key, key, picture), width: picture.width, height: picture.height, owner: this.device, premultiplied: true, source: picture }]
    }))
  }
  /** 画面已准备完毕、只等刷新时刻时，可启动不绘制的低优先级准备。 */
  get waitingForPresentation(): boolean { return this.waits.size > 0 }
  async draw(document: VideoEditComposition, clips: VideoEditClip[], pictures: VideoEditPicture[], shouldPresent: () => boolean, deadline?: number, target?: VideoEditCodePicture, viewport?: VideoEditMaterialViewport): Promise<{ presented: boolean; completion: Promise<void> }> {
    await this.ready
    if (this.disposed || !shouldPresent()) return { presented: false, completion: Promise.resolve() }
    // 8-bit-only frames draw straight into the canvas (unchanged); any high-precision input moves the whole frame
    // to the rgba16float target.
    const highPrecision = !target && pictures.some(videoEditPictureHighPrecision)
    const pipelines = target ? await this.offscreenPipelines(target.textureFormat) : highPrecision ? await this.offscreenPipelines(VIDEO_EDIT_PRECISE_FORMAT) : undefined
    const present = highPrecision ? await this.presentPipeline() : undefined
    if (!shouldPresent()) return { presented: false, completion: Promise.resolve() }
    const deadlineStarted = performance.now()
    if (deadline !== undefined && performance.timeOrigin + performance.now() < deadline - 0.8) await new Promise<void>(resolve => {
      let request = 0
      const finish = (): void => { self.cancelAnimationFrame(request); this.waits.delete(finish); resolve() }
      const tick = (at: number): void => { if (!shouldPresent() || performance.timeOrigin + at >= deadline - 0.8) finish(); else request = self.requestAnimationFrame(tick) }
      this.waits.add(finish); request = self.requestAnimationFrame(tick); this.onPresentationWait?.()
    })
    traceVideoEditFrame('compositor.deadline', -1, deadlineStarted)
    if (deadline !== undefined) recordVideoEditPreparation('presentDeadline', performance.now() - deadlineStarted)
    if (!shouldPresent()) return { presented: false, completion: Promise.resolve() }
    this.assertDevice()
    const inflightStarted = performance.now()
    while (this.uploads.size >= 2) await Promise.race(this.uploads)
    traceVideoEditFrame('compositor.inflight', -1, inflightStarted)
    recordVideoEditPreparation('presentInflight', performance.now() - inflightStarted)
    if (this.disposed || !shouldPresent()) return { presented: false, completion: Promise.resolve() }
    if (target) {
      if (target.width !== document.width || target.height !== document.height) throw new Error('离屏合成需要序列全尺寸目标。')
      this.codeRuntime?.assertPictureLive(target)
      if (target.owner !== this.device || pictures.some(picture => picture instanceof VideoEditCodePicture && picture.texture === target.texture)) throw new Error('离屏合成输入输出不能跨设备或引用同一纹理。')
    }
    const motion = clips.some(clip => (clip as VideoEditMotionSampledClip).motionSamples?.length) ? await this.motionResources(document.width, document.height, target?.highPrecision ?? highPrecision) : undefined
    if (this.disposed || !shouldPresent()) return { presented: false, completion: Promise.resolve() }
    const device = this.device
    const frames: VideoFrame[] = []
    const submission = videoEditGpuLedger(device).openSync()
    device.pushErrorScope('validation')
    let scopeOpen = true
    let historyBuffer: PresentationBuffer | undefined
    let fence: VideoEditGpuFrameFence | undefined
    try {
      const encoder = device.createCommandEncoder()
      // 上屏这一次提交是本帧在 GPU 上的最后一段：首尾打点，并在同一提交里解析本帧所有计时点。
      const timer = target ? undefined : videoEditGpuTimer(device)
      const timed = timer?.begin('composite', encoder)
      const canvas = target ? undefined : this.context.getCurrentTexture()
      const composed = present ? this.preciseTarget() : undefined
      const main = target?.texture ?? composed ?? canvas!
      let pass = encoder.beginRenderPass({ colorAttachments: [{ view: main.createView(), clearValue: { r: 0, g: 0, b: 0, a: target && !target.opaqueBackground ? 0 : 1 }, loadOp: 'clear', storeOp: 'store' }] })
      const retained = new Set<string>()
      clips.forEach((clip, index) => {
        const picture = pictures[index]
        let resource: unknown
        const external = picture instanceof VideoSample
        const cachedVideo = picture instanceof VideoEditGpuFrame
        const code = picture instanceof VideoEditCodePicture
        const reference = viewport ? { ...document, ...viewport.referenceSize } : document
        let width = reference.width; let height = reference.height
        let textRaster: Omit<VideoEditTextRaster, 'canvas'> | undefined
        if (external) {
          const frame = picture.toVideoFrame(); frames.push(frame)
          resource = device.importExternalTexture({ source: frame }); width = picture.displayWidth; height = picture.displayHeight
        } else if (code) {
          if (picture.owner !== device) throw new Error('代码画面不属于当前剪辑GPU设备。')
          this.codeRuntime?.assertPictureLive(picture)
          // 放置按画面尺寸：回放分辨率降低时纹理更小，按 UV 取样（与降采样的视频帧保留显示尺寸相同）。
          resource = picture.texture.createView(); width = picture.displayWidth ?? picture.width; height = picture.displayHeight ?? picture.height
        } else if (cachedVideo) {
          resource = picture.texture.createView(); width = picture.displayWidth; height = picture.displayHeight
        } else {
          const id = picture ? this.imageKey(picture) : `text:${clip.id}`
          // 空间材料面按推近档位重新栅格文字；放大很多的文字逐档降到单张纹理上限之内。
          let resolution = videoEditTextResolution(clip.scale) * (viewport?.rasterTier ?? 1)
          if (!picture && resolution > 1) {
            const size = videoEditTextRasterSize(clip, reference), limit = videoEditMaxTextureDimension()
            while (resolution > 1 && Math.max(size.width, size.height) * resolution > limit) resolution /= 2
          }
          const key = picture ? id : JSON.stringify([reference.width, reference.height, clip.text, clip.textStyle, documentFontRevision(), resolution])
          let cached = this.textures.get(id)
          if (cached?.key !== key) {
            let source: ImageBitmap | OffscreenCanvas
            if (picture) source = picture
            else {
              const textClip = viewport || this.pictureDivisor === 1 ? clip : { ...clip, textStyle: scaleVideoEditTextStyle(clip.textStyle ?? defaultVideoEditTextStyle(document.height * this.pictureDivisor), 1 / this.pictureDivisor) }
              const raster = rasterizeVideoEditText(textClip, reference, resolution, videoEditMaxTextureDimension())
              source = raster.canvas; textRaster = { x: raster.x, y: raster.y, width: raster.width, height: raster.height }
            }
            this.texture(id, key, source); cached = this.textures.get(id)!
            if (textRaster) cached.textRaster = textRaster
          }
          resource = cached.texture.createView()
          textRaster = cached.textRaster
          if (picture) { width = picture.width; height = picture.height }
        }
        const pictureWidth = width, pictureHeight = height
        const uniformFor = (key: string): GpuBuffer => {
          retained.add(key)
          let buffer = this.uniforms.get(key)
          if (!buffer) { buffer = device.createBuffer({ size: 96, usage: 0x08 | 0x40 }); this.uniforms.set(key, buffer) }
          return buffer
        }
        /** 一个变换（片段当前的，或运动模糊快门内的一次取样）对应的图层几何。 */
        const geometry = (placement: VideoEditClipPlacement) => {
          const fit = Math.min(document.width / pictureWidth, document.height / pictureHeight) * placement.scale
          const aspect = videoEditClipScaleAspect(placement)
          const rotation = placement.rotation * Math.PI / 180
          const center = videoEditClipCenterPosition(placement, { width: pictureWidth, height: pictureHeight }, document)
          let layerWidth = pictureWidth, layerHeight = pictureHeight
          if (textRaster) {
            const dx = (textRaster.x + textRaster.width / 2) * fit; const dy = (textRaster.y + textRaster.height / 2) * fit * aspect
            center.x += (dx * Math.cos(rotation) - dy * Math.sin(rotation)) / document.width
            center.y += (dx * Math.sin(rotation) + dy * Math.cos(rotation)) / document.height
            layerWidth = textRaster.width; layerHeight = textRaster.height
          }
          return { fit, aspect, rotation, center, layerWidth, layerHeight }
        }
        const { fit, aspect, rotation, center } = geometry(clip)
        if (textRaster) { width = textRaster.width; height = textRaster.height }
        const uniform = uniformFor(clip.id)
        let quad = videoEditClipTrackingQuad(clip)
        if (viewport) {
          const original = quad ?? [[0, 0], [1, 0], [1, 1], [0, 1]].map(([u, v]) => {
            const point = videoEditClipToFrame(clip, { width: pictureWidth, height: pictureHeight }, reference, u, v)
            return [point.x, point.y]
          })
          quad = original.map(([x, y]) => [(x * reference.width - viewport.bounds.x) / viewport.bounds.width, (y * reference.height - viewport.bounds.y) / viewport.bounds.height]) as typeof quad
        }
        let h = quad ? videoEditCornerPinMatrix(quad) : undefined
        if (h && textRaster) {
          // Corner pin is defined on the entire source frame, while UVs now cover only the text's local rectangle.
          const u = .5 + textRaster.x / reference.width; const v = .5 + textRaster.y / reference.height
          const sx = textRaster.width / reference.width; const sy = textRaster.height / reference.height
          const denominator = h[6] * u + h[7] * v + h[8]
          if (Math.abs(denominator) < 1e-8) throw new Error('文字区域位于透视消失点，无法呈现。')
          h = [h[0] * sx, h[1] * sy, h[0] * u + h[1] * v + h[2], h[3] * sx, h[4] * sy, h[3] * u + h[4] * v + h[5], h[6] * sx, h[7] * sy, denominator].map(value => value / denominator) as typeof h
        }
        const warp=h ? [h[0],h[1],h[2],0,h[3],h[4],h[5],0,h[6],h[7],h[8],0] : new Array<number>(12).fill(0)
        const orientation = [external || cachedVideo ? picture.rotation : 0, (external || cachedVideo) && picture.flip ? 1 : 0]
        const carriesLight = code && picture.carriesLight
        const uniformData = (layout: ReturnType<typeof geometry>, opacity: number): Float32Array => new Float32Array([layout.layerWidth * layout.fit / document.width, layout.layerHeight * layout.fit * layout.aspect / document.height, Math.cos(layout.rotation), Math.sin(layout.rotation), layout.center.x * 2, layout.center.y * 2, opacity, Number(carriesLight), document.height / document.width, document.width / document.height, ...orientation, ...warp])
        const choose = (set: LayerPipelines | undefined): GpuRenderPipeline => code || (!external && !cachedVideo) ? set?.codeImage ?? this.codeImage : external ? set?.video ?? this.video : cachedVideo && picture.chroma ? set?.cachedVideo ?? this.cachedVideo : set?.image ?? this.image
        const bind = (pipeline: GpuRenderPipeline, buffer: GpuBuffer) => device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer } }, ...(cachedVideo && picture.chroma ? [{ binding: 3, resource: picture.chroma.createView() }] : [])] })
        const samples = !h ? (clip as VideoEditMotionSampledClip).motionSamples : undefined
        if (samples?.length && motion) {
          // 运动模糊：快门内各次取样按 1/N 不透明度相加到离屏累积图（预乘），再把累积图叠到画面上；等于这些姿态的平均。
          // 累积与叠回都只在这一层扫过的范围里做，小画面、局部运动不必动整幅画面。
          const bounds = (clip as VideoEditMotionSampledClip).motionBounds ?? [0, 0, 1, 1]
          // 范围是画面比例坐标：累积图按序列尺寸、叠回按实际输出尺寸各自换算，都夹在目标之内
          const rect = (width: number, height: number): [number, number, number, number] => {
            const x = Math.max(0, Math.floor(bounds[0] * width)), y = Math.max(0, Math.floor(bounds[1] * height))
            return [x, y, Math.min(width, Math.ceil(bounds[2] * width)) - x, Math.min(height, Math.ceil(bounds[3] * height)) - y]
          }
          const mainSize = main as { width?: number; height?: number }
          const outputWidth = mainSize.width ?? document.width, outputHeight = mainSize.height ?? document.height
          const [sx, sy, sw, sh] = rect(document.width, document.height), [ox, oy, ow, oh] = rect(outputWidth, outputHeight)
          if (sw <= 0 || sh <= 0 || ow <= 0 || oh <= 0) return
          type Scissored = { setScissorRect(x: number, y: number, width: number, height: number): void }
          pass.end()
          const accumulate = encoder.beginRenderPass({ colorAttachments: [{ view: motion.target.createView(), clearValue: { r: 0, g: 0, b: 0, a: 0 }, loadOp: 'clear', storeOp: 'store' }] })
          ;(accumulate as typeof accumulate & Scissored).setScissorRect(sx, sy, sw, sh)
          const additive = choose(motion.additive)
          samples.forEach((sample, sampleIndex) => {
            const buffer = uniformFor(`${clip.id}:motion:${sampleIndex}`)
            device.queue.writeBuffer(buffer, 0, uniformData(geometry({ ...sample, ...(sample.scaleAspect === undefined && clip.scaleAspect !== undefined ? { scaleAspect: clip.scaleAspect } : {}) }), clip.opacity / samples.length))
            accumulate.setPipeline(additive); accumulate.setBindGroup(0, bind(additive, buffer)); accumulate.draw(6)
          })
          accumulate.end()
          pass = encoder.beginRenderPass({ colorAttachments: [{ view: main.createView(), loadOp: 'load', storeOp: 'store' }] })
          ;(pass as typeof pass & Scissored).setScissorRect(ox, oy, ow, oh)
          const over = pipelines?.codeImage ?? this.codeImage
          const buffer = uniformFor(`${clip.id}:motion:result`)
          device.queue.writeBuffer(buffer, 0, new Float32Array([1, 1, 1, 0, 0, 0, 1, Number(carriesLight), document.height / document.width, document.width / document.height, 0, 0, ...new Array<number>(12).fill(0)]))
          pass.setPipeline(over)
          pass.setBindGroup(0, device.createBindGroup({ layout: over.getBindGroupLayout(0), entries: [{ binding: 0, resource: motion.target.createView() }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer } }] }))
          pass.draw(6)
          ;(pass as typeof pass & Scissored).setScissorRect(0, 0, outputWidth, outputHeight)
          return
        }
        device.queue.writeBuffer(uniform, 0, uniformData({ fit, aspect, rotation, center, layerWidth: width, layerHeight: height }, clip.opacity))
        const pipeline = choose(pipelines)
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, bind(pipeline, uniform))
        pass.draw(6)
      })
      pass.end()
      if (present && composed && canvas) {
        const quantize = encoder.beginRenderPass({ colorAttachments: [{ view: canvas.createView(), clearValue: { r: 0, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] })
        quantize.setPipeline(present)
        quantize.setBindGroup(0, device.createBindGroup({ layout: present.getBindGroupLayout(0), entries: [{ binding: 0, resource: composed.createView() }] }))
        quantize.draw(3); quantize.end()
        this.precision.frames++
      }
      timer?.end(timed, encoder)
      const readGpuTimings = timer?.finishFrame(encoder)
      const capture = target ? undefined : this.capturePresentation?.()
      const bytesPerRow = Math.ceil(this.canvas.width * 4 / 256) * 256
      if (capture && !capture.gpu) {
        historyBuffer = device.createBuffer({ size: bytesPerRow * this.canvas.height, usage: 0x01 | 0x08 }) as PresentationBuffer
        // Encode the copy in this submission: canvas expiry cannot clear the owned buffer afterwards.
        ;(encoder as unknown as PresentationEncoder).copyTextureToBuffer({ texture: canvas }, { buffer: historyBuffer, bytesPerRow }, { width: this.canvas.width, height: this.canvas.height, depthOrArrayLayers: 1 })
      }
      // 栅栏编进这一帧最后一次提交：取位图时是位图拷贝那一次。
      const capturing = capture?.gpu && canvas
      if (!capturing) fence = this.fences!.arm(encoder)
      device.queue.submit([encoder.finish()])
      readGpuTimings?.()
      if (target) target.carriesLight = pictures.some(picture => picture instanceof VideoEditCodePicture && picture.carriesLight)
      if (capture?.gpu && canvas) {
        this.bitmapBridge ??= new VideoEditGpuBitmapBridge(device)
        capture(Promise.resolve(this.bitmapBridge.capture(canvas, this.canvas.width, this.canvas.height, this.canvasFormat, last => { fence = this.fences!.arm(last) })))
      }
      if (capture && historyBuffer) {
        const buffer = historyBuffer; historyBuffer = undefined
        const width = this.canvas.width; const height = this.canvas.height; const bgra = this.canvasFormat === 'bgra8unorm'
        const pixels = (async (): Promise<ImageBitmap> => {
          try {
            await buffer.mapAsync(1)
            const mapped = new Uint8Array(buffer.getMappedRange()); const rgba = new Uint8ClampedArray(width * height * 4)
            for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
              const from = y * bytesPerRow + x * 4; const to = (y * width + x) * 4
              rgba[to] = mapped[from + (bgra ? 2 : 0)]; rgba[to + 1] = mapped[from + 1]; rgba[to + 2] = mapped[from + (bgra ? 0 : 2)]; rgba[to + 3] = mapped[from + 3]
            }
            buffer.unmap()
            const ratio = Math.min(1, Math.sqrt((capture.maxPixels ?? 1280 * 720) / (width * height)))
            return await createImageBitmap(new ImageData(rgba, width, height), { resizeWidth: Math.max(1, Math.floor(width * ratio)), resizeHeight: Math.max(1, Math.floor(height * ratio)), resizeQuality: 'high' })
          } finally { buffer.destroy() }
        })()
        void pixels.catch(() => {})
        capture(pixels)
      }
      const validation = device.popErrorScope(); scopeOpen = false
      submission.end()
      const finished = fence!; fence = undefined
      const completion = Promise.all([finished.wait(), validation, submission.settle()]).then(([, error, faults]) => {
        this.assertDevice()
        const messages = [...(error?.message ? [error.message] : []), ...faults.map(fault => fault.message)]
        if (messages.length) throw new VideoEditGpuFrameError('composite', messages)
      }).finally(() => { frames.forEach(frame => frame.close()) })
      const inFlight: Promise<void> = completion.catch(() => {}).finally(() => { this.uploads.delete(inFlight) })
      this.uploads.add(inFlight)
      const ids = new Set(clips.map(clip => clip.id))
      this.retainTextures(new Set([...this.protectedImages, ...pictures.flatMap((picture, index) => picture instanceof VideoSample || picture instanceof VideoEditGpuFrame || picture instanceof VideoEditCodePicture ? [] : [picture ? this.imageKey(picture) : `text:${clips[index].id}`])]))
      for (const [id, value] of this.uniforms) if (!ids.has(id) && !retained.has(id) && !this.protectedUniforms.has(id)) { value.destroy(); this.uniforms.delete(id) }
      return { presented: true, completion }
    } catch (error) { submission.discard(); fence?.abandon(); historyBuffer?.destroy(); if (scopeOpen) await device.popErrorScope(); frames.forEach(frame => frame.close()); throw error }
  }
  async dispose(): Promise<void> {
    if (this.disposed) return
    const failures: unknown[] = []
    for (const bitmap of this.inputBitmaps) bitmap.close()
    this.inputBitmaps.clear(); this.bitmapBridge?.dispose(); this.bitmapBridge = undefined
    this.disposed = true
    this.cancelPresentation()
    await this.ready.catch(() => {})
    await Promise.allSettled([...this.offscreen.values(), this.presentReady, ...this.downscale.values()])
    await Promise.allSettled([...this.uploads, ...this.copies])
    try { await this.disposeAuthorRuntimes() } catch (error) { failures.push(error) }
    try { await this.disposeThreeSpace() } catch (error) { failures.push(error) }
    try { await this.spatialRuntime?.dispose() } catch (error) { failures.push(error) }
    try { await this.codeRuntime?.dispose() } catch (error) { failures.push(error) }
    for (const assets of this.authorAssets.values()) for (const image of Object.values(assets)) image.close()
    this.authorAssets.clear()
    this.authorTarget?.texture.destroy(); this.authorTarget = undefined
    for (const value of this.textures.values()) value.texture.destroy()
    for (const value of this.uniforms.values()) value.destroy()
    for (const value of this.pool) { value.texture.destroy(); value.chroma?.destroy() }
    this.pool.length = 0
    for (const release of this.blankReleases) release()
    await Promise.allSettled([...this.copies])
    this.precise?.texture.destroy(); this.precise = undefined
    this.motionTarget?.texture.destroy(); this.motionTarget = undefined
    this.textures.clear(); this.uniforms.clear(); this.fences?.dispose(); if (!this.shared) this.manager.destroy()
    if (failures.length) throw new AggregateError(failures, '剪辑渲染资源释放失败。')
  }
  cancelPresentation(): void { for (const finish of this.waits) finish() }
  /** Font changes retire glyph/generated surfaces, while decoded pictures keep their owning device. */
  async invalidateFontResources(): Promise<void> {
    await Promise.allSettled([...this.uploads, ...this.copies])
    await this.disposeAuthorRuntimes()
    await this.disposeThreeSpace()
    await this.spatialRuntime?.dispose(); this.spatialRuntime = undefined
    await this.codeRuntime?.dispose(); this.codeRuntime = undefined
    for (const [id, value] of this.textures) if (id.startsWith('text:')) {
      value.texture.destroy(); this.textures.delete(id)
    }
  }
}
import { videoEditClipCenterPosition, videoEditClipScaleAspect, videoEditClipToFrame, type VideoEditClipPlacement } from '@/core/videoEdit/clipGeometry'
export interface VideoEditMaterialViewport {
  referenceSize: { width: number; height: number }
  bounds: { x: number; y: number; width: number; height: number }
  /** 推近时材料面相对一倍栅格的二次幂档位；文字按二维档位乘此倍率重新栅格。 */
  rasterTier?: number
}
import type { VideoEditMotionSampledClip } from '@/core/videoEdit/motionBlur'
