import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { CodeMatrix } from '@/core/videoEdit/codeMaterial/contract'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'
import { authorLayerBlur, authorLayerSamples, authorRasterScale } from './videoEditAuthorLayers'
import type { AuthorAssets, AuthorFrameInfo, AuthorModule, AuthorParameters, AuthorWebGL, AuthorWebGPU } from './videoEditAuthorModule'

interface Surface { canvas: OffscreenCanvas; texture: GpuTexture }

/** One instance per effect instance, owned by the existing render worker/device. */
export class VideoEditAuthorRuntime {
  private readonly surfaces: Surface[] = []
  private readonly textures = new Set<GpuTexture>()
  private layerGpu?: VideoEditAuthorGpu
  private get layers(): VideoEditAuthorGpu { return this.layerGpu ??= new VideoEditAuthorGpu(this.device) }
  private gl?: WebGL2RenderingContext
  private webgl?: AuthorWebGL
  private webgpu?: AuthorWebGPU
  private closed = false
  private readonly defaults: AuthorParameters
  constructor(private readonly device: GpuDevice, private readonly effect: AuthorModule) {
    this.defaults = Object.fromEntries((effect.params ?? []).map(parameter => [parameter.key, parameter.default]))
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
  async render(target: GpuTexture, width: number, height: number, params: AuthorParameters, assets: AuthorAssets, info: AuthorFrameInfo): Promise<void> {
    if (this.closed) throw new Error('代码效果会话已关闭。')
    try {
      params = { ...this.defaults, ...params }
      if (!Number.isFinite(info.time) || !(info.frameDuration > 0) || !Number.isFinite(info.clip?.time) || !(info.clip.duration > 0)) throw new Error('效果需要有效的帧时间和片段时间。')
      if (this.effect.createWebGPU) {
        this.webgpu ??= await this.effect.createWebGPU(this.device)
        await this.webgpu.draw(target, info.time, params, width, height, assets, info)
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
        return
      }
      const list = this.effect.layers ? this.effect.layers(params, width, height, assets, info) : [{ draw: (ctx: OffscreenCanvasRenderingContext2D, time: number): void => this.effect.draw!(ctx, time, params, width, height, assets, info) }]
      if (!Array.isArray(list)) throw new Error('layers() 必须返回图层数组。')
      await this.layers.begin(target)
      for (let index = 0; index < list.length; index++) {
        const layer = list[index]
        try {
          if (typeof layer.draw !== 'function') throw new Error('缺少 draw(ctx,t)。')
          // Frameflow batches adjacent untransformed layers onto one canvas.
          // This also preserves Canvas compositing between those layers.
          if (!layer.pose) {
            const flat = this.surface(index * 2, width, height)
            const ctx = flat.canvas.getContext('2d')
            if (!ctx) throw new Error('Canvas2D 不可用。')
            ctx.reset()
            let end = index
            while (end < list.length && !list[end].pose) {
              const still = list[end]
              ctx.save()
              try {
                if (still.clip) { const [x0, y0, x1, y1] = still.clip; ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip() }
                still.draw(ctx, info.time)
              } catch (cause) { throw new Error(`静态层 ${end + 1}：${cause instanceof Error ? cause.message : String(cause)}`, { cause }) }
              finally { ctx.restore() }
              end++
            }
            this.device.queue.copyExternalImageToTexture({ source: flat.canvas }, { texture: flat.texture, premultipliedAlpha: true }, [width, height])
            this.layers.draw(target, width, height, { texture: flat.texture, x: 0, y: 0, width, height }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1, 0, 0, 1, 0, 0], opacity: 1 } }])
            index = end - 1
            continue
          }
          if (!layer.bounds) throw new Error('运动层需要 bounds:[x0,y0,x1,y1]。')
          const [x, y, right, bottom] = layer.bounds ?? [0, 0, width, height]
          if (![x, y, right, bottom].every(Number.isFinite) || right <= x || bottom <= y) throw new Error('图层范围无效。')
          const bounds = { x, y, width: right - x, height: bottom - y }
          const samples = authorLayerSamples(layer, this.effect, info, bounds)
          if (!samples.some(sample => sample.pose)) continue
          const center = layer.pose?.(info.time) ?? samples.map(sample => layer.pose?.(info.time + sample.offset.numerator * info.frameDuration)).find(Boolean)
          const need = Math.max(1, ...samples.flatMap(sample => sample.pose ? [Math.hypot(sample.pose.matrix[0], sample.pose.matrix[1]), Math.hypot(sample.pose.matrix[2], sample.pose.matrix[3])] : []))
          const unitPad = authorLayerBlur(center, 1, layer.blurShape).pad
          const textureLimit = (this.device as GpuDevice & { limits?: Record<string, number> }).limits?.maxTextureDimension2D ?? 8192
          const limit = Math.min((textureLimit - 2 * unitPad) / Math.max(bounds.width, bounds.height), Math.sqrt(16e6 / Math.max(1, bounds.width * bounds.height)))
          const resolution = authorRasterScale(need, limit)
          const { radius, pad } = authorLayerBlur(center, resolution, layer.blurShape)
          const surface = this.surface(index * 2, Math.ceil(bounds.width * resolution) + pad * 2, Math.ceil(bounds.height * resolution) + pad * 2)
          const ctx = surface.canvas.getContext('2d')
          if (!ctx) throw new Error('Canvas2D 不可用。')
          ctx.reset(); ctx.setTransform(resolution, 0, 0, resolution, pad - x * resolution, pad - y * resolution)
          layer.draw(ctx, info.time)
          let picture = surface.texture
          if (radius > 0 && layer.blurShape !== 'lens') {
            // Use the original Canvas/Skia blur operator, without pixel readback
            // or a second author draw. Do not substitute a different blur kernel.
            const blurred = this.surface(index * 2 + 1, surface.canvas.width, surface.canvas.height)
            const blurContext = blurred.canvas.getContext('2d')
            if (!blurContext) throw new Error('Canvas2D 不可用。')
            blurContext.reset(); blurContext.filter = `blur(${radius}px)`
            blurContext.drawImage(surface.canvas, 0, 0); blurContext.filter = 'none'
            this.device.queue.copyExternalImageToTexture({ source: blurred.canvas }, { texture: blurred.texture, premultipliedAlpha: true }, [surface.canvas.width, surface.canvas.height])
            this.layers.mipmaps(blurred.texture, surface.canvas.width, surface.canvas.height)
            picture = blurred.texture
          } else {
            this.device.queue.copyExternalImageToTexture({ source: surface.canvas }, { texture: surface.texture, premultipliedAlpha: true }, [surface.canvas.width, surface.canvas.height])
            this.layers.mipmaps(surface.texture, surface.canvas.width, surface.canvas.height)
          }
          if (radius > 0 && layer.blurShape === 'lens') {
            const blurred = this.surface(index * 2 + 1, surface.canvas.width, surface.canvas.height)
            this.layers.lens(surface.texture, blurred.texture, surface.canvas.width, surface.canvas.height, radius)
            this.layers.mipmaps(blurred.texture, surface.canvas.width, surface.canvas.height)
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
          throw new Error(`第 ${index + 1} 层${layer.name ? `「${layer.name}」` : ''}：${cause instanceof Error ? cause.message : String(cause)}`, { cause })
        }
      }
      this.layers.finish()
      while (this.surfaces.length > list.length * 2) {
        const surface = this.surfaces.pop()!
        if (!surface) continue
        surface.texture.destroy(); this.textures.delete(surface.texture); surface.canvas.width = surface.canvas.height = 1
      }
    } catch (cause) {
      throw new Error(`代码效果「${this.effect.name}」在 ${info.time} 秒执行失败：${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    }
  }
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    try { await this.webgl?.dispose?.(); await this.webgpu?.dispose?.(); await this.effect.dispose?.() }
    finally {
      await this.layerGpu?.dispose()
      for (const texture of this.textures) texture.destroy()
      this.textures.clear()
      for (const surface of this.surfaces) if (surface) surface.canvas.width = surface.canvas.height = 1
      this.surfaces.length = 0
      this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
    }
  }
}
