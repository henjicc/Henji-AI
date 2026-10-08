import { documentFontRevision } from '@/platform/fontFaces'
import { VideoSample } from 'mediabunny'
import { rasterizeVideoEditText, videoEditTextResolution, type VideoEditTextRaster } from './videoEditTextSurface'
import { defaultVideoEditTextStyle, scaleVideoEditTextStyle } from '@/core/videoEdit/text'
import { VIDEO_EDIT_PRECISE_FORMAT, VideoEditGpuFrame, videoEditGpuFrameFormat, videoEditPictureHighPrecision, type VideoEditGpuColorFormat, type VideoEditOwnedFormat } from './videoEditGpuFrame'
import { VIDEO_EDIT_CACHED_YUV_SHADER, VIDEO_EDIT_COPY_SHADER, VIDEO_EDIT_PRESENT_SHADER, VIDEO_EDIT_READBACK_USAGE, readVideoEditPreciseRow, videoEditDownscaleCopyShader, videoEditLayerShader } from './videoEditGpuShaders'
import type { VideoEditRenderDivisor } from '@/core/videoEdit/playbackResolution'
import { VideoEditNativePicture } from './videoEditNativePicture'
import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import { ImageEditWebGpuDeviceManager } from '@/core/imageEdit/webgpu/deviceManager'
import { getWebGpuContext, type GpuDevice, type GpuTexture, type GpuBuffer, type GpuRenderPipeline } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditCodeGpu, VideoEditCodePicture } from './videoEditCodeGpu'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'
import { videoEditClipTrackingQuad } from './videoEditTrackResults'
import { videoEditCornerPinMatrix } from '@/core/videoEdit/tracking'

interface VideoGpuDevice extends GpuDevice {
  importExternalTexture(descriptor: { source: VideoFrame }): unknown
}
export type VideoEditPicture = VideoSample | VideoEditGpuFrame | VideoEditCodePicture | ImageBitmap | null
interface LayerPipelines { video: GpuRenderPipeline; image: GpuRenderPipeline; codeImage: GpuRenderPipeline; cachedVideo: GpuRenderPipeline }
/** Full resolution composition, shared by preview and export. VideoFrames stay on
 * the GPU import path; no CPU pixels or thumbnail-sized intermediate surfaces.
 *
 * Precision (task 2.7): a frame whose inputs are all 8-bit composes straight into the 8-bit canvas exactly as before.
 * A frame with any high-precision input (10-bit and deeper material, native `rgbaf16`, or effects/transitions built
 * on them) composes into one `rgba16float` target of the canvas size and is quantized to the canvas, with a fixed
 * dither, in a final pass of the same submission. */
export class VideoEditGpuCompositor {
  private readonly manager = new ImageEditWebGpuDeviceManager()
  private readonly context
  private device!: VideoGpuDevice
  private video!: GpuRenderPipeline
  private image!: GpuRenderPipeline
  private codeImage!: GpuRenderPipeline
  private codeRuntime?: VideoEditCodeGpu
  private copyY!: GpuRenderPipeline
  private copyUv!: GpuRenderPipeline
  private copyRgba!: GpuRenderPipeline
  private readonly copyDeep = new Map<VideoEditOwnedFormat, GpuRenderPipeline>()
  private cachedVideo!: GpuRenderPipeline
  /** Reduced playback resolution (task 4.9): decoded pictures enter owned memory at 1/divisor size; export keeps 1. */
  private pictureDivisor: VideoEditRenderDivisor = 1
  /** Box-average copies per divisor, compiled on first use: [y, uv, rgba by owned format]. */
  private readonly downscale = new Map<number, Promise<{ y: GpuRenderPipeline; uv: GpuRenderPipeline; rgba: Map<string, GpuRenderPipeline> }>>()
  private canvasFormat = 'bgra8unorm'
  /** Layer pipelines for owned targets, per target format; compiled on first use. */
  private readonly offscreen = new Map<VideoEditGpuColorFormat, Promise<LayerPipelines>>()
  private presentReady?: Promise<GpuRenderPipeline>
  /** The `rgba16float` composition target of high-precision frames, canvas-sized, kept until size change or dispose. */
  private precise?: { texture: GpuTexture; width: number; height: number }
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
  private readonly uploads = new Set<Promise<void>>()
  private readonly copies = new Set<Promise<void>>()
  private disposed = false
  private readonly pool: Array<{ width: number; height: number; format: string; texture: GpuTexture; chroma?: GpuTexture; bytes: number }> = []
  private blankTexture?: GpuTexture
  constructor(readonly canvas: OffscreenCanvas, private readonly shared?: VideoEditGpuCompositor) {
    this.context = getWebGpuContext(canvas)
    this.manager.onDeviceLost(reason => { this.lost = reason })
    this.ready = this.initialize()
  }
  private async initialize(): Promise<void> {
    const managed = this.shared ? undefined : await this.manager.acquire()
    if (this.shared) await this.shared.ready
    this.device = this.shared?.device ?? managed!.device as VideoGpuDevice
    const format = this.shared?.canvasFormat ?? managed!.provider.getPreferredCanvasFormat()
    this.canvasFormat = format
    this.context.configure({ device: this.device, format, alphaMode: 'premultiplied' })
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.device.pushErrorScope('validation')
    Object.assign(this, this.layerPipelines(format))
    const copyShader = this.device.createShaderModule({ code: VIDEO_EDIT_COPY_SHADER })
    const copy = (entryPoint: string, format: string): GpuRenderPipeline => this.device.createRenderPipeline({ layout: 'auto', vertex: { module: copyShader, entryPoint: 'vs' }, fragment: { module: copyShader, entryPoint, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
    this.copyY = copy('y', 'r8unorm'); this.copyUv = copy('uv', 'rg8unorm')
    this.copyRgba = copy('rgba', 'rgba8unorm')
    for (const deep of ['rgb10a2unorm', 'rgba16float'] as const) this.copyDeep.set(deep, copy('rgba', deep))
    const error = await this.device.popErrorScope()
    if (error) throw new Error(`无法初始化剪辑 GPU 合成：${error.message}`)
  }
  /** Nested layers must belong to this device so the parent can sample them without readback or 8-bit quantization. */
  fork(canvas: OffscreenCanvas): VideoEditGpuCompositor { return new VideoEditGpuCompositor(canvas, this) }
  private layerPipelines(format: string): LayerPipelines {
    const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } }
    const pipeline = (code: string): GpuRenderPipeline => {
      const shader = this.device.createShaderModule({ code })
      return this.device.createRenderPipeline({ layout: 'auto', vertex: { module: shader, entryPoint: 'vs' }, fragment: { module: shader, entryPoint: 'fs', targets: [{ format, blend }] }, primitive: { topology: 'triangle-list' } })
    }
    const video = pipeline(videoEditLayerShader(true)); const image = pipeline(videoEditLayerShader(false)); const codeImage = pipeline(videoEditLayerShader(false, true))
    return { video, image, codeImage, cachedVideo: pipeline(VIDEO_EDIT_CACHED_YUV_SHADER) }
  }
  private async compiled<T>(build: () => T, failure: string): Promise<T> {
    await this.ready
    if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用。')
    this.device.pushErrorScope('validation')
    let result: T
    try { result = build() }
    catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
    const error = await this.device.popErrorScope()
    if (error) throw new Error(`${failure}：${error.message}`)
    if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用。')
    return result
  }
  /** Layer pipelines writing an owned target of `format` (offscreen code surfaces and the high-precision target). */
  private offscreenPipelines(format: VideoEditGpuColorFormat): Promise<LayerPipelines> {
    let ready = this.offscreen.get(format)
    if (!ready) { ready = this.compiled(() => this.layerPipelines(format), '离屏合成管线初始化失败'); this.offscreen.set(format, ready) }
    return ready
  }
  /** Pictures snapshotted from now on are stored at 1/divisor of their decoded size; the layer shader samples them by UV. */
  setPictureDivisor(divisor: VideoEditRenderDivisor): void { this.pictureDivisor = divisor }
  private downscalePipelines(divisor: 2 | 4 | 8): Promise<{ y: GpuRenderPipeline; uv: GpuRenderPipeline; rgba: Map<string, GpuRenderPipeline> }> {
    let ready = this.downscale.get(divisor)
    if (!ready) {
      ready = this.compiled(() => {
        const module = this.device.createShaderModule({ code: videoEditDownscaleCopyShader(divisor) })
        const copy = (entryPoint: string, format: string): GpuRenderPipeline => this.device.createRenderPipeline({ layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
        return { y: copy('y', 'r8unorm'), uv: copy('uv', 'rg8unorm'), rgba: new Map((['rgba8unorm', 'rgb10a2unorm', 'rgba16float'] as const).map(format => [format, copy('rgba', format)])) }
      }, '缩小回放分辨率的复制管线初始化失败')
      this.downscale.set(divisor, ready)
      ready.catch(() => { if (this.downscale.get(divisor) === ready) this.downscale.delete(divisor) })
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
  async snapshot(sample: VideoSample | VideoEditNativePicture, compact: boolean, deferCompletion = false): Promise<VideoEditGpuFrame> {
    await this.ready
    if (this.disposed) throw new Error('剪辑预览已关闭。')
    if (this.lost) throw new Error(`剪辑 GPU 已中断，请重新加载预览：${this.lost}`)
    while (this.copies.size >= 2) {
      await Promise.race(this.copies)
      if (this.disposed) throw new Error('剪辑预览已关闭。')
      if (this.lost) throw new Error(`剪辑 GPU 已中断，请重新加载预览：${this.lost}`)
    }
    if (this.disposed) throw new Error('剪辑预览已关闭。')
    // A reduced playback resolution copies a box-averaged picture of 1/divisor size (task 4.9); the frame keeps its
    // display size, so placement, fit and effects are unchanged and only the stored pixels shrink.
    const divisor = this.pictureDivisor
    const reduced = divisor === 1 ? undefined : await this.downscalePipelines(divisor)
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
    try {
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
      const completion = this.device.queue.onSubmittedWorkDone().finally(() => { closeFrame(); this.copies.delete(completion) })
      if (borrowed) sample.holdUntil(completion)
      this.copies.add(completion); retained = true
      void completion.catch(() => {})
      if (!deferCompletion) await completion
      if (highPrecision) this.precision.snapshots++
      return new VideoEditGpuFrame(sample, texture, chroma, bytes, () => {
        // Reuse evicted allocations instead of stalling the driver at every
        // working-set boundary. Idle pool has a separate hard 64 MiB ceiling
        // (one 4K rgba16float picture, 63.3 MiB, still fits).
        if (!this.disposed && this.pool.length < 4 && this.pool.reduce((sum, entry) => sum + entry.bytes, 0) + bytes <= 64 * 1024 ** 2) this.pool.push({ width, height, format, texture, chroma, bytes })
        else { texture.destroy(); chroma?.destroy() }
      }, undefined, highPrecision)
    } catch (error) { texture.destroy(); chroma?.destroy(); throw error } finally { if (!retained) closeFrame() }
  }
  /**
   * A transparent owned picture for a video layer without a picture at its source time. One shared 1×1 texture
   * (WebGPU zero-initializes it); releasing the frame never destroys it.
   */
  async blank(width: number, height: number, timestamp: number, duration: number): Promise<VideoEditGpuFrame> {
    await this.ready
    if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用。')
    this.blankTexture ??= this.device.createTexture({ size: [1, 1], format: 'rgba8unorm', usage: 0x04 })
    return new VideoEditGpuFrame({ timestamp, duration, displayWidth: Math.max(1, width), displayHeight: Math.max(1, height), rotation: 0, flip: false }, this.blankTexture, undefined, 4, () => {})
  }
  async code(): Promise<VideoEditCodeGpu> {
    await this.ready
    if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用，请重新加载预览。')
    this.codeRuntime ??= new VideoEditCodeGpu(this.device)
    return this.codeRuntime
  }
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
  private texture(id: string, key: string, source: ImageBitmap | OffscreenCanvas): GpuTexture {
    const cached = this.textures.get(id)
    if (cached?.key === key) return cached.texture
    const bytes = source.width * source.height * 4
    const retained = [...this.textures.values()].reduce((total, entry) => total + entry.bytes, 0) - (cached?.bytes ?? 0)
    if (source.width < 1 || source.height < 1 || source.width > 8192 || source.height > 8192 || retained + bytes > 256 * 1024 ** 2) throw new Error('图片或文字超出 GPU 单张纹理 8192 像素或驻留 256MiB 技术预算。')
    const texture = this.device.createTexture({ size: [source.width, source.height], format: 'rgba8unorm', usage: 0x02 | 0x04 | 0x10 })
    try { this.device.queue.copyExternalImageToTexture({ source }, { texture, premultipliedAlpha: false }, [source.width, source.height]) }
    catch (error) { texture.destroy(); throw error }
    cached?.texture.destroy(); this.textures.set(id, { texture, key, bytes }); this.imageUploads++
    return texture
  }
  private retainTextures(keys: ReadonlySet<string>): void {
    for (const [key, value] of this.textures) if (!keys.has(key)) { value.texture.destroy(); this.textures.delete(key) }
  }
  /** Ordinary image clips and code references borrow the same full-size upload. */
  async prepareImages(pictures: ReadonlyMap<string, ImageBitmap>, shouldPresent: () => boolean, visibleText: ReadonlySet<string> = new Set(), visibleClips: ReadonlySet<string> = new Set()): Promise<ReadonlyMap<string, VideoEditCodeImageInput>> {
    await this.ready
    if (!shouldPresent() || this.disposed) throw new DOMException('图片画面已取消。', 'AbortError')
    if (this.lost) throw new Error(`剪辑 GPU 已中断：${this.lost}`)
    const unique = new Set(pictures.values()); const bytes = [...unique].reduce((sum, image) => sum + image.width * image.height * 4, 0)
    if (unique.size + visibleText.size > 32 || bytes + visibleText.size * this.canvas.width * this.canvas.height * 4 > 256 * 1024 ** 2) throw new Error('可见图片与文字超过32份或256MiB预算，请减少同时显示的素材。')
    this.protectedImages = new Set([...unique].map(image => this.imageKey(image)).concat([...visibleText].map(id => `text:${id}`)))
    this.protectedUniforms = new Set(visibleClips)
    this.retainTextures(new Set([...this.protectedImages, ...[...visibleText].map(id => `text:${id}`)]))
    return new Map([...pictures].map(([mediaId, picture]) => {
      const key = this.imageKey(picture)
      return [mediaId, { texture: this.texture(key, key, picture), width: picture.width, height: picture.height, owner: this.device, premultiplied: false }]
    }))
  }
  async draw(document: VideoEditComposition, clips: VideoEditClip[], pictures: VideoEditPicture[], shouldPresent: () => boolean, deadline?: number, target?: VideoEditCodePicture): Promise<{ presented: boolean; completion: Promise<void> }> {
    await this.ready
    if (this.disposed || !shouldPresent()) return { presented: false, completion: Promise.resolve() }
    // 8-bit-only frames draw straight into the canvas (unchanged); any high-precision input moves the whole frame
    // to the rgba16float target.
    const highPrecision = !target && pictures.some(videoEditPictureHighPrecision)
    const pipelines = target ? await this.offscreenPipelines(target.textureFormat) : highPrecision ? await this.offscreenPipelines(VIDEO_EDIT_PRECISE_FORMAT) : undefined
    const present = highPrecision ? await this.presentPipeline() : undefined
    if (!shouldPresent()) return { presented: false, completion: Promise.resolve() }
    if (deadline !== undefined && performance.timeOrigin + performance.now() < deadline - 0.8) await new Promise<void>(resolve => {
      let request = 0
      const finish = (): void => { self.cancelAnimationFrame(request); this.waits.delete(finish); resolve() }
      const tick = (at: number): void => { if (!shouldPresent() || performance.timeOrigin + at >= deadline - 0.8) finish(); else request = self.requestAnimationFrame(tick) }
      this.waits.add(finish); request = self.requestAnimationFrame(tick)
    })
    if (!shouldPresent()) return { presented: false, completion: Promise.resolve() }
    if (this.lost) throw new Error(`剪辑 GPU 已中断，请重新加载预览：${this.lost}`)
    while (this.uploads.size >= 2) await Promise.race(this.uploads)
    if (this.disposed || !shouldPresent()) return { presented: false, completion: Promise.resolve() }
    if (target) {
      if (target.width !== document.width || target.height !== document.height) throw new Error('离屏合成需要序列全尺寸目标。')
      this.codeRuntime?.assertPictureLive(target)
      if (target.owner !== this.device || pictures.some(picture => picture instanceof VideoEditCodePicture && picture.texture === target.texture)) throw new Error('离屏合成输入输出不能跨设备或引用同一纹理。')
    }
    const device = this.device
    const frames: VideoFrame[] = []
    try {
      const encoder = device.createCommandEncoder()
      const canvas = target ? undefined : this.context.getCurrentTexture()
      const composed = present ? this.preciseTarget() : undefined
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: (target?.texture ?? composed ?? canvas!).createView(), clearValue: { r: 0, g: 0, b: 0, a: target ? 0 : 1 }, loadOp: 'clear', storeOp: 'store' }] })
      clips.forEach((clip, index) => {
        const picture = pictures[index]
        let resource: unknown
        const external = picture instanceof VideoSample
        const cachedVideo = picture instanceof VideoEditGpuFrame
        const code = picture instanceof VideoEditCodePicture
        let width = document.width; let height = document.height
        let textRaster: Omit<VideoEditTextRaster, 'canvas'> | undefined
        if (external) {
          const frame = picture.toVideoFrame(); frames.push(frame)
          resource = device.importExternalTexture({ source: frame }); width = picture.displayWidth; height = picture.displayHeight
        } else if (code) {
          if (picture.owner !== device) throw new Error('代码画面不属于当前剪辑GPU设备。')
          this.codeRuntime?.assertPictureLive(picture)
          resource = picture.texture.createView(); width = picture.width; height = picture.height
        } else if (cachedVideo) {
          resource = picture.texture.createView(); width = picture.displayWidth; height = picture.displayHeight
        } else {
          const id = picture ? this.imageKey(picture) : `text:${clip.id}`
          const resolution = videoEditTextResolution(clip.scale)
          const key = picture ? id : JSON.stringify([document.width, document.height, clip.text, clip.textStyle, documentFontRevision(), resolution])
          let cached = this.textures.get(id)
          if (cached?.key !== key) {
            let source: ImageBitmap | OffscreenCanvas
            if (picture) source = picture
            else {
              const textClip = this.pictureDivisor === 1 ? clip : { ...clip, textStyle: scaleVideoEditTextStyle(clip.textStyle ?? defaultVideoEditTextStyle(document.height * this.pictureDivisor), 1 / this.pictureDivisor) }
              const raster = rasterizeVideoEditText(textClip, document, resolution)
              source = raster.canvas; textRaster = { x: raster.x, y: raster.y, width: raster.width, height: raster.height }
            }
            this.texture(id, key, source); cached = this.textures.get(id)!
            if (textRaster) cached.textRaster = textRaster
          }
          resource = cached.texture.createView()
          textRaster = cached.textRaster
          if (picture) { width = picture.width; height = picture.height }
        }
        let uniform = this.uniforms.get(clip.id)
        if (!uniform) { uniform = device.createBuffer({ size: 96, usage: 0x08 | 0x40 }); this.uniforms.set(clip.id, uniform) }
        const fit = Math.min(document.width / width, document.height / height) * clip.scale
        const rotation = clip.rotation * Math.PI / 180
        const center = videoEditClipCenterPosition(clip, { width, height }, document)
        if (textRaster) {
          const dx = (textRaster.x + textRaster.width / 2) * fit; const dy = (textRaster.y + textRaster.height / 2) * fit
          center.x += (dx * Math.cos(rotation) - dy * Math.sin(rotation)) / document.width
          center.y += (dx * Math.sin(rotation) + dy * Math.cos(rotation)) / document.height
          width = textRaster.width; height = textRaster.height
        }
        const quad=videoEditClipTrackingQuad(clip); let h=quad ? videoEditCornerPinMatrix(quad) : undefined
        if (h && textRaster) {
          // Corner pin is defined on the entire source frame, while UVs now cover only the text's local rectangle.
          const u = .5 + textRaster.x / document.width; const v = .5 + textRaster.y / document.height
          const sx = textRaster.width / document.width; const sy = textRaster.height / document.height
          const denominator = h[6] * u + h[7] * v + h[8]
          if (Math.abs(denominator) < 1e-8) throw new Error('文字区域位于透视消失点，无法呈现。')
          h = [h[0] * sx, h[1] * sy, h[0] * u + h[1] * v + h[2], h[3] * sx, h[4] * sy, h[3] * u + h[4] * v + h[5], h[6] * sx, h[7] * sy, denominator].map(value => value / denominator) as typeof h
        }
        const warp=h ? [h[0],h[1],h[2],0,h[3],h[4],h[5],0,h[6],h[7],h[8],0] : new Array<number>(12).fill(0)
        device.queue.writeBuffer(uniform, 0, new Float32Array([width * fit / document.width, height * fit / document.height, Math.cos(rotation), Math.sin(rotation), center.x * 2, center.y * 2, clip.opacity, 0, document.height / document.width, document.width / document.height, external || cachedVideo ? picture.rotation : 0, (external || cachedVideo) && picture.flip ? 1 : 0, ...warp]))
        const pipeline = code ? pipelines?.codeImage ?? this.codeImage : external ? pipelines?.video ?? this.video : cachedVideo && picture.chroma ? pipelines?.cachedVideo ?? this.cachedVideo : pipelines?.image ?? this.image
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: uniform } }, ...(cachedVideo && picture.chroma ? [{ binding: 3, resource: picture.chroma.createView() }] : [])] }))
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
      device.queue.submit([encoder.finish()])
      const completion = device.queue.onSubmittedWorkDone().finally(() => { frames.forEach(frame => frame.close()); this.uploads.delete(completion) })
      this.uploads.add(completion)
      const ids = new Set(clips.map(clip => clip.id))
      this.retainTextures(new Set([...this.protectedImages, ...pictures.flatMap((picture, index) => picture instanceof VideoSample || picture instanceof VideoEditGpuFrame || picture instanceof VideoEditCodePicture ? [] : [picture ? this.imageKey(picture) : `text:${clips[index].id}`])]))
      for (const [id, value] of this.uniforms) if (!ids.has(id) && !this.protectedUniforms.has(id)) { value.destroy(); this.uniforms.delete(id) }
      return { presented: true, completion }
    } catch (error) { frames.forEach(frame => frame.close()); throw error }
  }
  async dispose(): Promise<void> {
    this.disposed = true
    this.cancelPresentation()
    await this.ready.catch(() => {})
    await Promise.allSettled([...this.offscreen.values(), this.presentReady, ...this.downscale.values()])
    await Promise.allSettled([...this.uploads, ...this.copies])
    await this.codeRuntime?.dispose()
    for (const value of this.textures.values()) value.texture.destroy()
    for (const value of this.uniforms.values()) value.destroy()
    for (const value of this.pool) { value.texture.destroy(); value.chroma?.destroy() }
    this.pool.length = 0; this.blankTexture?.destroy(); this.blankTexture = undefined
    this.precise?.texture.destroy(); this.precise = undefined
    this.textures.clear(); this.uniforms.clear(); if (!this.shared) this.manager.destroy()
  }
  cancelPresentation(): void { for (const finish of this.waits) finish() }
}
import { videoEditClipCenterPosition } from '@/core/videoEdit/clipGeometry'
