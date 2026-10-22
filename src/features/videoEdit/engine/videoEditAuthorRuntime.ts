import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { CodeMatrix } from '@/core/videoEdit/codeMaterial/contract'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'
import { authorLayerBlur, authorLayerSamples, authorPoseMatrix, authorRasterScale } from './videoEditAuthorLayers'
import { AUTHOR_WHOLE_EFFECT_ID, authorLayerId, authorOverrideMatrix, observeAuthorElement, type AuthorElementObservation, type AuthorElementOverrides } from './videoEditAuthorElements'
import type { AuthorAssets, AuthorFrameInfo, AuthorGpuInputs, AuthorLayer, AuthorModule, AuthorParameters, AuthorWebGL, AuthorWebGPU } from './videoEditAuthorModule'
import type { AuthorSourceLocations } from './videoEditAuthorBundle'
import { authorEffectMetadata, authorParameterValues, type AuthorEffectMetadata } from './videoEditAuthorParameters'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'
import { AuthorCanvasAsset, AuthorCanvasUnrecordable, recordAuthorCanvas, replayAuthorCanvas, type AuthorCanvasRecording } from './videoEditAuthorCanvasRecorder'

interface Surface { canvas: OffscreenCanvas; texture: GpuTexture; /** Recorded commands whose raster the texture holds. */ signature?: string }
type Matrix = [number, number, number, number, number, number]
/** An image read outside a recorded draw before its bitmap of this frame exists. */
class AuthorAssetPending extends Error { constructor(readonly key: string) { super(`作者图片 ${key} 尚未准备`) } }

/** One instance per effect instance, owned by the existing render worker/device. */
export class VideoEditAuthorRuntime {
  private readonly surfaces: Surface[] = []
  private readonly textures = new Set<GpuTexture>()
  private readonly canvasImages = new Map<string, { source: ImageBitmap; pixels: ImageData; version: number }>()
  private assetVersion = 0
  /** Images the author reads outside recorded canvas draws (e.g. for its own WebGL scene): made every frame up front. */
  private readonly eagerAssets = new Set<string>()
  /** Layers whose drawing cannot be recorded; they draw directly every frame. */
  private readonly directLayers = new Set<string>()
  private measureContext?: OffscreenCanvasRenderingContext2D
  private layerGpu?: VideoEditAuthorGpu
  private get layers(): VideoEditAuthorGpu { return this.layerGpu ??= new VideoEditAuthorGpu(this.device) }
  private gl?: WebGL2RenderingContext
  private webgl?: AuthorWebGL
  private webgpu?: AuthorWebGPU
  private nativeOverrideTarget?: { texture: GpuTexture; width: number; height: number }
  private closed = false
  readonly parameterMetadata: AuthorEffectMetadata
  private lastFrame?: { layers: AuthorLayer[]; width: number; height: number; time: number; parameters: AuthorParameters; overrides?: AuthorElementOverrides }
  constructor(private readonly device: GpuDevice, private readonly effect: AuthorModule, private readonly locations?: AuthorSourceLocations, private readonly ownsModule = true) {
    this.parameterMetadata = authorEffectMetadata(effect)
  }
  private texture(width: number, height: number): GpuTexture {
    const texture = this.device.createTexture({ size: [width, height], mipLevelCount: 1 + Math.floor(Math.log2(Math.max(width, height))), format: 'rgba8unorm', usage: 0x01 | 0x02 | 0x04 | 0x10 })
    this.textures.add(texture)
    return texture
  }
  private surface(index: number, width: number, height: number): Surface {
    const previous = this.surfaces[index]
    if (previous?.canvas.width === width && previous.canvas.height === height) return previous
    if (previous) { previous.texture.destroy(); this.textures.delete(previous.texture); previous.canvas.width = previous.canvas.height = 1 }
    const surface = { canvas: new OffscreenCanvas(width, height), texture: this.texture(width, height) }
    this.surfaces[index] = surface
    return surface
  }
  /** Selection reads the last successful frame; normal playback builds no hit graph. */
  observeElements(): AuthorElementObservation[] {
    const frame = this.lastFrame
    if (!frame) return []
    return frame.layers.flatMap((layer, index) => {
      const pose = layer.pose ? layer.pose(frame.time) : {}
      const id = authorLayerId(layer, index), override = frame.overrides && Object.hasOwn(frame.overrides, id) ? frame.overrides[id] : undefined
      if (!pose || override?.hidden || (pose.opacity ?? 1) * (override?.opacity ?? 1) <= 0) return []
      const bounds = layer.bounds ?? [0, 0, frame.width, frame.height]
      const matrix = authorPoseMatrix(pose)
      const sourceSpan = layer.sourceSpan ?? this.locations?.layers[id] ?? (layer.factory && this.locations?.factories?.[layer.factory.file]?.[layer.factory.name]) ?? this.locations?.fallback
      return [{ ...observeAuthorElement(this.effect, sourceSpan ? { ...layer, sourceSpan } : layer, index, bounds, override ? authorOverrideMatrix(matrix, bounds, override) : matrix, frame.parameters), baseMatrix: matrix, baseOpacity: pose.opacity ?? 1, opacity: (pose.opacity ?? 1) * (override?.opacity ?? 1) }]
    })
  }
  private renders: Promise<unknown> = Promise.resolve()
  /** One frame at a time per instance: a warm-up ahead of the playhead and a visible frame never share surfaces. */
  render(target: GpuTexture, width: number, height: number, params: AuthorParameters, assets: AuthorAssets, info: AuthorFrameInfo, overrides?: AuthorElementOverrides, inputs?: AuthorGpuInputs): Promise<void> {
    const result = this.renders.then(() => this.renderFrame(target, width, height, params, assets, info, overrides, inputs))
    this.renders = result.catch(() => undefined)
    return result
  }
  private async renderFrame(target: GpuTexture, width: number, height: number, params: AuthorParameters, assets: AuthorAssets, info: AuthorFrameInfo, overrides?: AuthorElementOverrides, inputs?: AuthorGpuInputs): Promise<void> {
    if (this.closed) throw new Error('代码效果会话已关闭。')
    const frameImages: ImageBitmap[] = []
    try {
      params = authorParameterValues(this.parameterMetadata, params)
      if (!Number.isFinite(info.time) || !(info.frameDuration > 0) || !Number.isFinite(info.clip?.time) || !(info.clip.duration > 0)) throw new Error('效果需要有效的帧时间和片段时间。')
      const whole: AuthorLayer = { id: AUTHOR_WHOLE_EFFECT_ID, name: this.effect.name, bounds: [0, 0, width, height], draw() {} }
      if ((this.effect.createWebGPU || this.effect.createWebGL) && overrides && Object.hasOwn(overrides, AUTHOR_WHOLE_EFFECT_ID)) {
        if (!this.nativeOverrideTarget || this.nativeOverrideTarget.width !== width || this.nativeOverrideTarget.height !== height) {
          if (this.nativeOverrideTarget) { this.nativeOverrideTarget.texture.destroy(); this.textures.delete(this.nativeOverrideTarget.texture) }
          const texture = this.device.createTexture({ size: [width, height], format: 'rgba8unorm', usage: 0x01 | 0x02 | 0x04 | 0x08 | 0x10 })
          this.textures.add(texture); this.nativeOverrideTarget = { texture, width, height }
        }
        const picture = this.nativeOverrideTarget.texture
        await this.renderFrame(picture, width, height, params, assets, info, undefined, inputs)
        await this.layers.begin(target)
        const samples = authorLayerSamples(whole, this.effect, info, { x: 0, y: 0, width, height }, overrides[AUTHOR_WHOLE_EFFECT_ID])
        this.layers.draw(target, width, height, { texture: picture, x: 0, y: 0, width, height }, samples)
        this.layers.finish()
        this.lastFrame = { layers: [whole], width, height, time: info.time, parameters: params, overrides }
        return
      }
      if (this.effect.createWebGPU) {
        this.webgpu ??= await this.effect.createWebGPU(this.device)
        await this.webgpu.draw(target, info.time, params, width, height, assets, info, inputs)
        this.lastFrame = { layers: [whole], width, height, time: info.time, parameters: params }
        return
      }
      if (this.effect.createWebGL) {
        // Preserve the context when dimensions change; recreate only the upload texture.
        if (!this.gl) {
          const canvas = new OffscreenCanvas(width, height)
          this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true }) ?? undefined
          if (!this.gl) throw new Error('WebGL2 不可用。')
          this.webgl = this.effect.createWebGL(this.gl)
        }
        const gl = this.gl, canvas = gl.canvas as OffscreenCanvas
        if (canvas.width !== width) canvas.width = width
        if (canvas.height !== height) canvas.height = height
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, width, height)
        gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        this.webgl!.draw(info.time, params, width, height, assets, info)
        this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture: target, premultipliedAlpha: true }, [width, height])
        this.lastFrame = { layers: [whole], width, height, time: info.time, parameters: params }
        return
      }
      for (const [key, cached] of this.canvasImages) if (assets[key] !== cached.source) {
        this.canvasImages.delete(key); this.eagerAssets.delete(key)
      }
      for (const [key, source] of Object.entries(assets)) {
        if (!(source instanceof ImageBitmap) || this.canvasImages.has(key)) continue
        const pixelsStarted = performance.now()
        const canvas = new OffscreenCanvas(source.width, source.height)
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) throw new Error('Canvas2D 不可用。')
        context.drawImage(source, 0, 0)
        this.canvasImages.set(key, { source, pixels: context.getImageData(0, 0, source.width, source.height), version: ++this.assetVersion })
        canvas.width = canvas.height = 1
        recordVideoEditPreparation('authorAssetPixels', performance.now() - pixelsStarted)
      }
      // Reusing a bitmap lets Chromium change its low-quality downsampling
      // after GPU promotion. Keep immutable pixels, with a fresh image each frame,
      // created only when this frame actually draws the image (a reused layer raster needs none).
      const fresh = new Map<string, ImageBitmap>()
      const freshAsset = async (key: string): Promise<void> => {
        const cached = this.canvasImages.get(key)
        if (!cached || fresh.has(key)) return
        const copyStarted = performance.now()
        const copy = await createImageBitmap(cached.pixels)
        recordVideoEditPreparation('authorAssetCopy', performance.now() - copyStarted)
        frameImages.push(copy); fresh.set(key, copy)
      }
      let recording = false
      const canvasAssets: Record<string, CanvasImageSource> = {}
      for (const [key, source] of Object.entries(assets)) {
        const cached = this.canvasImages.get(key)
        if (!cached) { canvasAssets[key] = source; continue }
        const standIn = new AuthorCanvasAsset(key, cached.pixels.width, cached.pixels.height)
        Object.defineProperty(canvasAssets, key, { enumerable: true, get: () => {
          if (recording) return standIn
          const image = fresh.get(key)
          if (!image) { this.eagerAssets.add(key); throw new AuthorAssetPending(key) }
          return image
        } })
      }
      assets = canvasAssets
      const assetSignature = (keys: Iterable<string>): string => JSON.stringify([...keys].sort().map(key => [key, this.canvasImages.get(key)?.version]))
      const measure = this.measureContext ??= new OffscreenCanvas(1, 1).getContext('2d') ?? undefined
      /** Draws into a surface unless the recorded commands equal the ones its texture already holds. */
      const paint = async (surface: Surface, slot: string, setup: Matrix, draw: (ctx: OffscreenCanvasRenderingContext2D) => void): Promise<boolean> => {
        let recorded: AuthorCanvasRecording | undefined
        if (measure && !this.directLayers.has(slot)) {
          recording = true
          try { recorded = recordAuthorCanvas(surface.canvas, measure, setup, draw) } catch (error) {
            if (!(error instanceof AuthorCanvasUnrecordable) && !(error instanceof TypeError)) throw error
            // Images handed outside the canvas, pixel reads, unknown APIs: this layer draws directly from now on.
            this.directLayers.add(slot)
          } finally { recording = false }
        }
        const signature = recorded?.comparable ? `${slot}\u0000${surface.canvas.width}x${surface.canvas.height}\u0000${setup.join(',')}\u0000${assetSignature(recorded.assets)}\u0000${recorded.signature}` : undefined
        if (signature && surface.signature === signature) { recordVideoEditPreparation('authorRasterReused', 0); return false }
        for (const key of recorded?.assets ?? []) await freshAsset(key)
        const ctx = surface.canvas.getContext('2d')
        if (!ctx) throw new Error('Canvas2D 不可用。')
        ctx.reset(); ctx.setTransform(...setup)
        const rasterStarted = performance.now()
        surface.signature = undefined
        if (recorded) replayAuthorCanvas(recorded, ctx, key => fresh.get(key)!)
        else draw(ctx)
        recordVideoEditPreparation('authorRaster', performance.now() - rasterStarted)
        surface.signature = signature
        return true
      }
      for (let attempt = 0; ; attempt++) {
        for (const key of this.eagerAssets) await freshAsset(key)
        try {
      const listStarted = performance.now()
      const list = this.effect.layers ? this.effect.layers(params, width, height, assets, info) : [{ ...whole, draw: (ctx: OffscreenCanvasRenderingContext2D, time: number): void => this.effect.draw!(ctx, time, params, width, height, assets, info) }]
      recordVideoEditPreparation('authorLayerList', performance.now() - listStarted)
      if (!Array.isArray(list)) throw new Error('layers() 必须返回图层数组。')
      await this.layers.begin(target)
      for (let index = 0; index < list.length; index++) {
        const id = authorLayerId(list[index], index), override = overrides && Object.hasOwn(overrides, id) ? overrides[id] : undefined
        const layer = override && !list[index].pose ? { ...list[index], bounds: list[index].bounds ?? [0, 0, width, height] as [number, number, number, number], pose: () => ({}) } : list[index]
        try {
          if (typeof layer.draw !== 'function') throw new Error('缺少 draw(ctx,t)。')
          // Frameflow batches adjacent untransformed layers onto one canvas.
          // This also preserves Canvas compositing between those layers.
          if (!layer.pose) {
            const flat = this.surface(index * 2, width, height)
            let end = index
            while (end < list.length && !list[end].pose && !(overrides && Object.hasOwn(overrides, authorLayerId(list[end], end)))) end++
            const stills = list.slice(index, end), first = index
            const changed = await paint(flat, `flat:${index}:${end}`, [1, 0, 0, 1, 0, 0], ctx => {
              stills.forEach((still, offset) => {
                ctx.save()
                try {
                  if (still.clip) { const [x0, y0, x1, y1] = still.clip; ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip() }
                  still.draw(ctx, info.time)
                } catch (cause) { throw cause instanceof AuthorCanvasUnrecordable || cause instanceof AuthorAssetPending || cause instanceof TypeError ? cause : new Error(`静态层 ${first + offset + 1}：${cause instanceof Error ? cause.message : String(cause)}`, { cause }) }
                finally { ctx.restore() }
              })
            })
            if (changed) {
              const flatUpload = performance.now()
              this.device.queue.copyExternalImageToTexture({ source: flat.canvas }, { texture: flat.texture, premultipliedAlpha: true }, [width, height])
              recordVideoEditPreparation('authorUpload', performance.now() - flatUpload)
            }
            this.layers.draw(target, width, height, { texture: flat.texture, x: 0, y: 0, width, height }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 0, 0], opacity: 1 } }])
            index = end - 1
            continue
          }
          if (!layer.bounds) throw new Error('运动层需要 bounds:[x0,y0,x1,y1]。')
          const [x, y, right, bottom] = layer.bounds ?? [0, 0, width, height]
          if (![x, y, right, bottom].every(Number.isFinite) || right <= x || bottom <= y) throw new Error('图层范围无效。')
          const bounds = { x, y, width: right - x, height: bottom - y }
          const samples = authorLayerSamples(layer, this.effect, info, bounds, override)
          if (!samples.some(sample => sample.pose)) continue
          const center = layer.pose?.(info.time) ?? samples.map(sample => layer.pose?.(info.time + sample.offset.numerator * info.frameDuration)).find(Boolean)
          const need = Math.max(1, ...samples.flatMap(sample => sample.pose ? [Math.hypot(sample.pose.matrix[0], sample.pose.matrix[1]), Math.hypot(sample.pose.matrix[2], sample.pose.matrix[3])] : []))
          const unitPad = authorLayerBlur(center, 1, layer.blurShape).pad
          const textureLimit = (this.device as GpuDevice & { limits?: Record<string, number> }).limits?.maxTextureDimension2D ?? 8192
          const limit = Math.min((textureLimit - 2 * unitPad) / Math.max(bounds.width, bounds.height), Math.sqrt(16e6 / Math.max(1, bounds.width * bounds.height)))
          const resolution = authorRasterScale(need, limit)
          const { radius, pad } = authorLayerBlur(center, resolution, layer.blurShape)
          const surface = this.surface(index * 2, Math.ceil(bounds.width * resolution) + pad * 2, Math.ceil(bounds.height * resolution) + pad * 2)
          const changed = await paint(surface, `layer:${index}:${id}`, [resolution, 0, 0, resolution, pad - x * resolution, pad - y * resolution], ctx => layer.draw(ctx, info.time))
          const uploadStarted = performance.now()
          let picture = surface.texture
          if (radius > 0 && layer.blurShape !== 'lens') {
            // Use the original Canvas/Skia blur operator, without pixel readback
            // or a second author draw. Do not substitute a different blur kernel.
            const blurred = this.surface(index * 2 + 1, surface.canvas.width, surface.canvas.height)
            const blurSignature = surface.signature && `${surface.signature}\u0000blur:${radius}`
            if (changed || !blurSignature || blurred.signature !== blurSignature) {
              const blurContext = blurred.canvas.getContext('2d')
              if (!blurContext) throw new Error('Canvas2D 不可用。')
              blurContext.reset(); blurContext.filter = `blur(${radius}px)`
              blurContext.drawImage(surface.canvas, 0, 0); blurContext.filter = 'none'
              this.device.queue.copyExternalImageToTexture({ source: blurred.canvas }, { texture: blurred.texture, premultipliedAlpha: true }, [surface.canvas.width, surface.canvas.height])
              this.layers.mipmaps(blurred.texture, surface.canvas.width, surface.canvas.height)
              blurred.signature = blurSignature
            }
            picture = blurred.texture
          } else if (changed) {
            this.device.queue.copyExternalImageToTexture({ source: surface.canvas }, { texture: surface.texture, premultipliedAlpha: true }, [surface.canvas.width, surface.canvas.height])
            this.layers.mipmaps(surface.texture, surface.canvas.width, surface.canvas.height)
          }
          recordVideoEditPreparation('authorUpload', performance.now() - uploadStarted)
          if (radius > 0 && layer.blurShape === 'lens') {
            const blurred = this.surface(index * 2 + 1, surface.canvas.width, surface.canvas.height)
            this.layers.lens(surface.texture, blurred.texture, surface.canvas.width, surface.canvas.height, radius)
            this.layers.mipmaps(blurred.texture, surface.canvas.width, surface.canvas.height)
            blurred.signature = undefined
            picture = blurred.texture
          }
          const poses = samples.map(sample => {
            if (!sample.pose) return sample
            const m = sample.pose.matrix, ox = x - pad / resolution, oy = y - pad / resolution
            const matrix: CodeMatrix = [m[0] / resolution, m[1] / resolution, m[2] / resolution, m[3] / resolution, m[4] + m[0] * ox + m[2] * oy, m[5] + m[1] * ox + m[3] * oy]
            return { ...sample, pose: { ...sample.pose, matrix } }
          })
          this.layers.draw(target, width, height, { texture: picture, x: 0, y: 0, width: surface.canvas.width, height: surface.canvas.height }, poses, layer.clip)
        } catch (cause) {
          if (cause instanceof AuthorAssetPending) throw cause
          throw new Error(`第 ${index + 1} 层${layer.name ? `「${layer.name}」` : ''}：${cause instanceof Error ? cause.message : String(cause)}`, { cause })
        }
      }
      this.layers.finish()
      this.lastFrame = { layers: list, width, height, time: info.time, parameters: params, overrides }
      while (this.surfaces.length > list.length * 2) {
        const surface = this.surfaces.pop()!
        if (!surface) continue
        surface.texture.destroy(); this.textures.delete(surface.texture); surface.canvas.width = surface.canvas.height = 1
      }
      break
        } catch (error) {
          // An image read outside a recorded canvas draw needs its bitmap before the author code runs: draw the frame again.
          if (!(error instanceof AuthorAssetPending) || attempt > Object.keys(assets).length) throw error
          this.layers.abandon()
        }
      }
    } catch (cause) {
      throw new Error(`代码效果「${this.effect.name}」在 ${info.time} 秒执行失败：${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    } finally {
      frameImages.forEach(image => image.close())
    }
  }
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.lastFrame = undefined
    const errors: unknown[] = []
    const release = async (action: () => unknown): Promise<void> => {
      try { await action() } catch (error) { errors.push(error) }
    }
    await release(() => this.webgl?.dispose?.())
    await release(() => this.webgpu?.dispose?.())
    if (this.ownsModule) await release(() => this.effect.dispose?.())
    await release(() => this.layerGpu?.dispose())
    for (const texture of this.textures) await release(() => texture.destroy())
    this.textures.clear()
    this.canvasImages.clear()
    for (const surface of this.surfaces) if (surface) await release(() => { surface.canvas.width = surface.canvas.height = 1 })
    this.surfaces.length = 0
    await release(() => this.gl?.getExtension('WEBGL_lose_context')?.loseContext())
    if (errors.length) throw new AggregateError(errors, '代码效果资源释放失败。')
  }
}
