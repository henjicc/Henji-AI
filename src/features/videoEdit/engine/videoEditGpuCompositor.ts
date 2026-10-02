import { VideoSample } from 'mediabunny'
import { VideoEditGpuFrame } from './videoEditGpuFrame'
import { VideoEditNativePicture } from './videoEditNativePicture'
import type { VideoEditClip, VideoEditComposition } from '@/core/videoEdit/document'
import { ImageEditWebGpuDeviceManager } from '@/core/imageEdit/webgpu/deviceManager'
import { getWebGpuContext, type GpuDevice, type GpuTexture, type GpuBuffer, type GpuRenderPipeline } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { VideoEditCodeGpu, VideoEditCodePicture } from './videoEditCodeGpu'
import type { VideoEditCodeImageInput } from './videoEditCodeGpu'

interface VideoGpuDevice extends GpuDevice {
  importExternalTexture(descriptor: { source: VideoFrame }): unknown
}
export type VideoEditPicture = VideoSample | VideoEditGpuFrame | VideoEditCodePicture | ImageBitmap | null
interface LayerPipelines { video: GpuRenderPipeline; image: GpuRenderPipeline; codeImage: GpuRenderPipeline; cachedVideo: GpuRenderPipeline }
const vertex = `
struct Params { size: vec2f, rotation: vec2f, position: vec2f, brightness: f32, opacity: f32, aspect: vec2f, padding: vec2f }
@group(0) @binding(2) var<uniform> p: Params;
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
  let uv = array<vec2f, 6>(vec2f(0,0),vec2f(0,1),vec2f(1,0),vec2f(1,0),vec2f(0,1),vec2f(1,1))[i];
  let point = (uv * 2 - 1) * p.size;
  let rotated = vec2f(point.x * p.rotation.x - point.y * p.rotation.y * p.aspect.x,
                      point.x * p.rotation.y * p.aspect.y + point.y * p.rotation.x);
  var sampleUv = uv;
  if (p.padding.y == 1) { sampleUv.x = 1 - sampleUv.x; }
  if (p.padding.x == 90) { sampleUv = vec2f(sampleUv.y, 1 - sampleUv.x); }
  if (p.padding.x == 180) { sampleUv = 1 - sampleUv; }
  if (p.padding.x == 270) { sampleUv = vec2f(1 - sampleUv.y, sampleUv.x); }
  return Vertex(vec4f(rotated.x + p.position.x, -rotated.y - p.position.y, 0, 1), sampleUv);
}
@group(0) @binding(1) var s: sampler;
`
/** Full resolution composition, shared by preview and export. VideoFrames stay on
 * the GPU import path; no CPU pixels or thumbnail-sized intermediate surfaces. */
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
  private cachedVideo!: GpuRenderPipeline
  private rgbaReady?: Promise<LayerPipelines>
  private sampler: unknown
  private readonly uniforms = new Map<string, GpuBuffer>()
  private readonly textures = new Map<string, { texture: GpuTexture; key: string; bytes: number }>()
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
  private readonly pool: Array<{ width: number; height: number; texture: GpuTexture; chroma?: GpuTexture; bytes: number }> = []
  private blankTexture?: GpuTexture
  constructor(readonly canvas: OffscreenCanvas) {
    this.context = getWebGpuContext(canvas)
    this.manager.onDeviceLost(reason => { this.lost = reason })
    this.ready = this.initialize()
  }
  private async initialize(): Promise<void> {
    const managed = await this.manager.acquire()
    this.device = managed.device as VideoGpuDevice
    const format = managed.provider.getPreferredCanvasFormat()
    this.context.configure({ device: this.device, format, alphaMode: 'premultiplied' })
    this.sampler = this.device.createSampler({ magFilter: 'linear', minFilter: 'linear' })
    this.device.pushErrorScope('validation')
    Object.assign(this, this.layerPipelines(format))
    const copyShader = this.device.createShaderModule({ code: `
struct Vertex { @builtin(position) position: vec4f, @location(0) uv: vec2f }
@vertex fn vs(@builtin(vertex_index) i: u32) -> Vertex {
 let uv = array<vec2f, 3>(vec2f(0,0), vec2f(0,2), vec2f(2,0))[i];
 return Vertex(vec4f(uv.x * 2 - 1, 1 - uv.y * 2, 0, 1), uv);
}
@group(0) @binding(0) var t: texture_external;
@fragment fn rgba(v: Vertex) -> @location(0) vec4f { return textureLoad(t, vec2u(v.position.xy)); }
@fragment fn y(v: Vertex) -> @location(0) vec4f {
 let c = textureLoad(t, vec2u(v.position.xy)).rgb;
 return vec4f(dot(c, vec3f(0.2126, 0.7152, 0.0722)), 0, 0, 1);
}
@fragment fn uv(v: Vertex) -> @location(0) vec4f {
 let point = vec2u(v.position.xy) * 2u;
 let edge = textureDimensions(t) - 1u;
 let c = (textureLoad(t, min(point, edge)).rgb + textureLoad(t, min(point + vec2u(1,0), edge)).rgb + textureLoad(t, min(point + vec2u(0,1), edge)).rgb + textureLoad(t, min(point + vec2u(1,1), edge)).rgb) * 0.25;
 let luma = dot(c, vec3f(0.2126, 0.7152, 0.0722));
 return vec4f((c.b - luma) / 1.8556 + 0.5, (c.r - luma) / 1.5748 + 0.5, 0, 1);
}
` })
    const copy = (entryPoint: string, format: string): GpuRenderPipeline => this.device.createRenderPipeline({ layout: 'auto', vertex: { module: copyShader, entryPoint: 'vs' }, fragment: { module: copyShader, entryPoint, targets: [{ format }] }, primitive: { topology: 'triangle-list' } })
    this.copyY = copy('y', 'r8unorm'); this.copyUv = copy('uv', 'rg8unorm')
    this.copyRgba = copy('rgba', 'rgba8unorm')
    const error = await this.device.popErrorScope()
    if (error) throw new Error(`无法初始化剪辑 GPU 合成：${error.message}`)
  }
  private layerPipelines(format: string): LayerPipelines {
    const pipeline = (external: boolean, premultiplied = false): GpuRenderPipeline => {
      const sample = external ? 'textureSampleBaseClampToEdge(t, s, v.uv)' : 'textureSample(t, s, v.uv)'
      const shader = this.device.createShaderModule({ code: vertex + `
@group(0) @binding(0) var t: ${external ? 'texture_external' : 'texture_2d<f32>'};
@fragment fn fs(v: Vertex) -> @location(0) vec4f {
 let c = ${sample}; let alpha = c.a * p.opacity;
 return vec4f(${premultiplied ? 'clamp(c.rgb * p.brightness, vec3f(0), vec3f(c.a)) * p.opacity' : 'clamp(c.rgb * p.brightness, vec3f(0), vec3f(1)) * alpha'}, alpha);
}` })
      return this.device.createRenderPipeline({ layout: 'auto', vertex: { module: shader, entryPoint: 'vs' }, fragment: { module: shader, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] }, primitive: { topology: 'triangle-list' } })
    }
    const video = pipeline(true); const image = pipeline(false); const codeImage = pipeline(false, true)
    const cachedShader = this.device.createShaderModule({ code: vertex + `
@group(0) @binding(0) var y: texture_2d<f32>;
@group(0) @binding(3) var uv: texture_2d<f32>;
@fragment fn fs(v: Vertex) -> @location(0) vec4f {
 let luma = textureSample(y, s, v.uv).r;
 let chroma = textureSample(uv, s, v.uv).rg - 0.5;
 let rgb = vec3f(luma + 1.5748 * chroma.y, luma - 0.187324 * chroma.x - 0.468124 * chroma.y, luma + 1.8556 * chroma.x);
 return vec4f(clamp(rgb * p.brightness, vec3f(0), vec3f(1)) * p.opacity, p.opacity);
}` })
    const cachedVideo = this.device.createRenderPipeline({ layout: 'auto', vertex: { module: cachedShader, entryPoint: 'vs' }, fragment: { module: cachedShader, entryPoint: 'fs', targets: [{ format, blend: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } } }] }, primitive: { topology: 'triangle-list' } })
    return { video, image, codeImage, cachedVideo }
  }
  private async rgbaPipelines(): Promise<LayerPipelines> {
    return this.rgbaReady ??= (async () => {
      await this.ready
      if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用。')
      this.device.pushErrorScope('validation')
      let pipelines: LayerPipelines
      try { pipelines = this.layerPipelines('rgba8unorm') }
      catch (error) { await this.device.popErrorScope().catch(() => null); throw error }
      const error = await this.device.popErrorScope()
      if (error) throw new Error(`离屏合成管线初始化失败：${error.message}`)
      if (this.disposed || this.lost) throw new Error('剪辑GPU会话不可用。')
      return pipelines
    })()
  }
  /** Deferred copies may only be consumed on this device/queue. The final draw
   * completion covers earlier copies; retain decoder frames until their fence.
   * A borrowed native frame is imported as is and stays borrowed until the copy's fence: it is never closed here
   * (closing a shared texture frame in a worker crashes the renderer process, record 002). The copy keeps the
   * existing owned formats; higher bit depth for 10-bit and above material belongs to the pipeline task 2.7. */
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
    // Copy on the compositor's device; no Skia canvas or cross-context fences.
    const borrowed = sample instanceof VideoEditNativePicture
    const frame = borrowed ? sample.frame : sample.toVideoFrame()
    const closeFrame = (): void => { if (!borrowed) frame.close() }
    const width = frame.visibleRect?.width ?? sample.codedWidth; const height = frame.visibleRect?.height ?? sample.codedHeight
    const uvWidth = Math.ceil(width / 2); const uvHeight = Math.ceil(height / 2)
    const index = this.pool.findIndex(entry => entry.width === width && entry.height === height && !!entry.chroma === compact)
    const recycled = index >= 0 ? this.pool.splice(index, 1)[0] : undefined
    const texture = recycled?.texture ?? this.device.createTexture({ size: [width, height], format: compact ? 'r8unorm' : 'rgba8unorm', usage: 0x04 | 0x10 })
    const chroma = compact ? recycled?.chroma ?? this.device.createTexture({ size: [uvWidth, uvHeight], format: 'rg8unorm', usage: 0x04 | 0x10 }) : undefined
    const bytes = compact ? width * height + uvWidth * uvHeight * 2 : width * height * 4
    let retained = false
    try {
      const encoder = this.device.createCommandEncoder()
      const resource = this.device.importExternalTexture({ source: frame })
      const planes: Array<readonly [GpuTexture, GpuRenderPipeline]> = chroma ? [[texture, this.copyY], [chroma, this.copyUv]] : [[texture, this.copyRgba]]
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
      return new VideoEditGpuFrame(sample, texture, chroma, bytes, () => {
        // Reuse evicted allocations instead of stalling the driver at every
        // working-set boundary. Idle pool has a separate hard 64 MiB ceiling.
        if (!this.disposed && this.pool.length < 4 && this.pool.reduce((sum, entry) => sum + entry.bytes, 0) + bytes <= 64 * 1024 ** 2) this.pool.push({ width, height, texture, chroma, bytes })
        else { texture.destroy(); chroma?.destroy() }
      })
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
    if (source.width < 1 || source.height < 1 || source.width > 8192 || source.height > 8192 || retained + bytes > 256 * 1024 ** 2 || !cached && this.textures.size >= 32) throw new Error('可见图片与文字超过32份或256MiB预算，请减少同时显示的素材。')
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
    const pipelines = target ? await this.rgbaPipelines() : undefined
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
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: (target?.texture ?? this.context.getCurrentTexture()).createView(), clearValue: { r: 0, g: 0, b: 0, a: target ? 0 : 1 }, loadOp: 'clear', storeOp: 'store' }] })
      clips.forEach((clip, index) => {
        const picture = pictures[index]
        let resource: unknown
        const external = picture instanceof VideoSample
        const cachedVideo = picture instanceof VideoEditGpuFrame
        const code = picture instanceof VideoEditCodePicture
        let width = document.width; let height = document.height
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
          const key = picture ? id : `${document.width}:${document.height}:${clip.text}`
          let cached = this.textures.get(id)
          if (cached?.key !== key) {
            let source: ImageBitmap | OffscreenCanvas
            if (picture) source = picture
            else {
              source = new OffscreenCanvas(document.width, document.height)
              const text = source.getContext('2d')!
              text.fillStyle = 'white'; text.textAlign = 'center'; text.textBaseline = 'middle'; text.font = `${Math.round(document.height / 15)}px sans-serif`
              clip.text.split('\n').forEach((line, row) => text.fillText(line, document.width / 2, document.height / 2 + row * document.height / 12))
            }
            this.texture(id, key, source); cached = this.textures.get(id)!
          }
          resource = cached.texture.createView()
          if (picture) { width = picture.width; height = picture.height }
        }
        let uniform = this.uniforms.get(clip.id)
        if (!uniform) { uniform = device.createBuffer({ size: 48, usage: 0x08 | 0x40 }); this.uniforms.set(clip.id, uniform) }
        const fit = Math.min(document.width / width, document.height / height) * clip.scale
        const rotation = clip.rotation * Math.PI / 180
        device.queue.writeBuffer(uniform, 0, new Float32Array([width * fit / document.width, height * fit / document.height, Math.cos(rotation), Math.sin(rotation), clip.x * 2, clip.y * 2, clip.brightness, clip.opacity, document.height / document.width, document.width / document.height, external || cachedVideo ? picture.rotation : 0, (external || cachedVideo) && picture.flip ? 1 : 0]))
        const pipeline = code ? pipelines?.codeImage ?? this.codeImage : external ? pipelines?.video ?? this.video : cachedVideo && picture.chroma ? pipelines?.cachedVideo ?? this.cachedVideo : pipelines?.image ?? this.image
        pass.setPipeline(pipeline)
        pass.setBindGroup(0, device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource }, { binding: 1, resource: this.sampler }, { binding: 2, resource: { buffer: uniform } }, ...(cachedVideo && picture.chroma ? [{ binding: 3, resource: picture.chroma.createView() }] : [])] }))
        pass.draw(6)
      })
      pass.end(); device.queue.submit([encoder.finish()])
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
    await this.rgbaReady?.catch(() => {})
    await Promise.allSettled([...this.uploads, ...this.copies])
    await this.codeRuntime?.dispose()
    for (const value of this.textures.values()) value.texture.destroy()
    for (const value of this.uniforms.values()) value.destroy()
    for (const value of this.pool) { value.texture.destroy(); value.chroma?.destroy() }
    this.pool.length = 0; this.blankTexture?.destroy(); this.blankTexture = undefined
    this.textures.clear(); this.uniforms.clear(); this.manager.destroy()
  }
  cancelPresentation(): void { for (const finish of this.waits) finish() }
}
