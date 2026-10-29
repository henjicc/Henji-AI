import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { CodeMatrix } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeLayerStatistics } from '@/core/videoEdit/codeMaterial/performance'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'
import { authorLayerBlur, authorLayerSamples, authorPoseMatrix, authorRasterScale, authorStillCrop, authorStillGroups, authorStillRaster } from './videoEditAuthorLayers'
import { authorCanvasContent, type AuthorCanvasBox } from './videoEditAuthorCanvasBounds'
import { AUTHOR_WHOLE_EFFECT_ID, authorLayerId, authorOverrideMatrix, observeAuthorElement, type AuthorElementObservation, type AuthorElementOverrides } from './videoEditAuthorElements'
import type { AuthorAssets, AuthorFrameInfo, AuthorGpuInputs, AuthorLayer, AuthorModule, AuthorParameters, AuthorWebGL, AuthorWebGPU } from './videoEditAuthorModule'
import type { AuthorSourceLocations } from './videoEditAuthorBundle'
import { authorEffectMetadata, authorParameterValues, type AuthorEffectMetadata } from './videoEditAuthorParameters'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'
import { AuthorCanvasAsset, AuthorCanvasUnrecordable, authorCanvasContext, authorCanvasTextContext, trackAuthorCanvasText, recordAuthorCanvas, replayAuthorCanvas, sameAuthorCanvasRecording, type AuthorCanvasRecording } from './videoEditAuthorCanvasRecorder'
import { TEXT_DRAW_OBSERVER, TEXT_LAYER_CONTEXT, observeTextLayouts, authorModuleTextLayouts, type TextDrawObservation, type TextDrawObserverContext } from '../../../core/videoEdit/textDrawObservation'

/** One recorded layer. The same object is kept across frames while its commands and image versions stay equal. */
interface Painted { recording: AuthorCanvasRecording; assets: string }
/** What a texture holds: the recorded layers painted into it (compared by reference) and where. */
interface SurfaceContent { key: string; parts: Painted[] }
/**
 * Motion layers own a raster canvas and a mipmapped texture. Still groups paint on the shared scratch canvas and keep
 * only their texture: a canvas is needed only while painting, before the upload.
 */
interface Surface { texture: GpuTexture; width: number; height: number; mips?: boolean; canvas?: OffscreenCanvas; content?: SurfaceContent }
/** `quiet`: frames since the layer last changed; Infinity while it has not changed since it first appeared. */
/** `cache`：作者给的内容键与 bounds/clip 组成的签名；与上一帧相同就不调用 draw，沿用上一帧的录制。 */
interface LayerHistory { textLayouts?: Map<string, number | undefined>; painted?: Painted; quiet: number; cache?: string; textRaster?: string }
interface Part { painted?: Painted; draw(ctx: OffscreenCanvasRenderingContext2D): void }
type Matrix = [number, number, number, number, number, number]
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
/** 一段相邻无位姿图层最多拆成几张栅格；每张一份不超过整帧的纹理。 */
const MAX_STILL_GROUPS = 4
/** 静止层组按内容范围栅格，画布按尺寸留几张复用（同一组每帧尺寸不变，不必每帧重建画布）；总面积不超过两帧。 */
const SCRATCH_CANVASES = 4
/**
 * 变过的层要连续这么多帧不变才算静止。初次出现的层先算静止（第二帧就能把在变的层拆出去）；变过一次的层隔几帧又变
 * （低帧率计数、间歇闪烁）时一直留在“在变”组里，分组不来回切换，静止组不被反复重画。
 */
const QUIET_FRAMES = 12
/** 在录制之外读过的图片，这么多帧没再读就不再每帧预先拷位图（再读时经 AuthorAssetPending 重试补上）。 */
const EAGER_FRAMES = 8
const sameContent = (held: SurfaceContent | undefined, next: SurfaceContent): boolean =>
  !!held && held.key === next.key && held.parts.length === next.parts.length && held.parts.every((part, index) => part === next.parts[index])
/** 图层的内容签名：作者给了 cacheKey（字符串或有限数字）才有，连同 bounds、clip 与画布尺寸。 */
function layerCacheSignature(layer: AuthorLayer, width: number, height: number): string | undefined {
  const key = layer.cacheKey
  if (typeof key !== 'string' && !(typeof key === 'number' && Number.isFinite(key))) return undefined
  return JSON.stringify([typeof key, key, layer.bounds ?? null, layer.clip ?? null, width, height])
}
/** An image read outside a recorded draw before its bitmap of this frame exists. */
class AuthorAssetPending extends Error { constructor(readonly key: string) { super(`作者图片 ${key} 尚未准备`) } }

/** One instance per effect instance, owned by the existing render worker/device. */
export class VideoEditAuthorRuntime {
  private readonly surfaces: Surface[] = []
  private readonly textures = new Set<GpuTexture>()
  /** 静止层组共用的画布，按尺寸复用：只在重画时用，画完立刻拷进该组的纹理。 */
  private readonly scratchCanvases = new Map<string, OffscreenCanvas>()
  /** `pixels` 缺省表示逐帧换图的输入（视频）：每张只画一次，直接用，不读回像素。 */
  private readonly canvasImages = new Map<string, { source: ImageBitmap; pixels?: ImageData; version: number }>()
  /** 每个输入连续换图的帧数；连续两次换图（视频帧）后改为直接画。 */
  private readonly assetChanges = new Map<string, number>()
  /** 上一帧画了逐帧变化输入的运动层：按 1 倍栅格。 */
  private readonly liveLayers = new Set<string>()
  private assetVersion = 0
  /**
   * Images the author reads outside recorded canvas draws (e.g. for its own WebGL scene), with the Canvas frame that last
   * read them: made up front while they were read within EAGER_FRAMES frames. An author that read an image once and then
   * keeps its own copy stops costing a bitmap copy every frame; a later read gets its bitmap through the existing retry.
   */
  private readonly eagerAssets = new Map<string, number>()
  private canvasFrames = 0
  /** Layers whose drawing cannot be recorded; they draw directly every frame. */
  private readonly directLayers = new Set<string>()
  /** Last successful frame's recording of every layer slot, with how recently it changed. */
  private history = new Map<string, LayerHistory>()
  /** Still runs with a layer that cannot be recorded or leaks canvas state: painted as one group, as Frameflow does. */
  private readonly combinedRuns = new Set<string>()
  private measureContext?: OffscreenCanvasRenderingContext2D
  private layerGpu?: VideoEditAuthorGpu
  private get layers(): VideoEditAuthorGpu { return this.layerGpu ??= new VideoEditAuthorGpu(this.device) }
  private gl?: WebGL2RenderingContext
  private webgl?: AuthorWebGL
  private webgpu?: AuthorWebGPU
  private nativeOverrideTarget?: { texture: GpuTexture; width: number; height: number }
  private closed = false
  readonly parameterMetadata: AuthorEffectMetadata
  private lastFrame?: { layers: AuthorLayer[]; width: number; height: number; time: number; parameters: AuthorParameters; overrides?: AuthorElementOverrides; directText?: Map<number, TextDrawObservation[]>; textUncovered?: Map<number, string[]>; textLayouts?: Map<string, number | undefined> }
  constructor(private readonly device: GpuDevice, private readonly effect: AuthorModule, private readonly locations?: AuthorSourceLocations, private readonly ownsModule = true, apiVersion?: number) {
    this.parameterMetadata = authorEffectMetadata(effect, apiVersion)
  }
  private texture(width: number, height: number, mips: boolean): GpuTexture {
    const texture = this.device.createTexture({ size: [width, height], mipLevelCount: mips ? 1 + Math.floor(Math.log2(Math.max(width, height))) : 1, format: 'rgba8unorm', usage: 0x01 | 0x02 | 0x04 | 0x10 })
    this.textures.add(texture)
    return texture
  }
  private release(surface: Surface): void {
    surface.texture.destroy(); this.textures.delete(surface.texture)
    if (surface.canvas) surface.canvas.width = surface.canvas.height = 1
  }
  /**
   * `canvas`: a motion layer's own raster canvas with a mipmapped texture; otherwise a texture for a still group.
   * `mips`: a still group rastered larger than it is drawn (full canvas pixels into a reduced target) samples mip levels.
   */
  private surface(index: number, width: number, height: number, canvas: boolean, mips = canvas): Surface {
    const previous = this.surfaces[index]
    if (previous && previous.width === width && previous.height === height && !!previous.canvas === canvas && !!previous.mips === mips) return previous
    if (previous) this.release(previous)
    const surface: Surface = { texture: this.texture(width, height, mips), width, height, mips, ...(canvas ? { canvas: new OffscreenCanvas(width, height) } : {}) }
    this.surfaces[index] = surface
    return surface
  }
  private scratch(width: number, height: number, budget: number): OffscreenCanvas {
    const key = `${width}x${height}`
    let canvas = this.scratchCanvases.get(key)
    if (canvas) { this.scratchCanvases.delete(key); this.scratchCanvases.set(key, canvas); return canvas }
    let area = width * height
    for (const value of this.scratchCanvases.values()) area += value.width * value.height
    for (const [oldKey, old] of this.scratchCanvases) {
      if (this.scratchCanvases.size < SCRATCH_CANVASES && area <= budget) break
      area -= old.width * old.height
      this.scratchCanvases.delete(oldKey)
      if (!canvas) canvas = old
      else old.width = old.height = 1
    }
    if (canvas) { canvas.width = width; canvas.height = height } else canvas = new OffscreenCanvas(width, height)
    this.scratchCanvases.set(key, canvas)
    return canvas
  }
  /** Selection reads the last successful frame; normal playback builds no hit graph. */
  observeElements(): AuthorElementObservation[] {
    const frame = this.lastFrame
    if (!frame) return []
    let attachedUnassigned = false
    return frame.layers.flatMap((layer, index) => {
      const pose = layer.pose ? layer.pose(frame.time) : {}
      const id = authorLayerId(layer, index), override = frame.overrides && Object.hasOwn(frame.overrides, id) ? frame.overrides[id] : undefined
      if (!pose || override?.hidden || (pose.opacity ?? 1) * (override?.opacity ?? 1) <= 0) return []
      const bounds = layer.bounds ?? [0, 0, frame.width, frame.height]
      const matrix = authorPoseMatrix(pose)
      const posed = !!layer.pose || !!override
      const recording = this.history.get(`${posed ? 'layer' : 'still'}:${index}:${id}`)?.painted?.recording
      const combined = [...this.history.entries()].find(([key]) => { const match = /^flat:(\d+):(\d+)$/.exec(key); return match && index >= Number(match[1]) && index < Number(match[2]) })?.[1].painted?.recording
      const observed = combined ?? recording
      const textDraws = frame.directText?.get(index) ?? observed?.textDraws.filter(draw => draw.layerIndex === undefined || draw.layerIndex === index)
      const textLayouts = [...frame.textLayouts ?? []].filter(([, owner]) => owner === index).map(([id]) => id)
      const unassignedTextLayouts = attachedUnassigned ? [] : [...frame.textLayouts ?? []].filter(([, owner]) => owner === undefined).map(([id]) => id)
      attachedUnassigned = true
      const sourceSpan = layer.sourceSpan ?? this.locations?.layers[id] ?? (layer.factory && this.locations?.factories?.[layer.factory.file]?.[layer.factory.name]) ?? this.locations?.fallback
      return [{ ...observeAuthorElement(this.effect, sourceSpan ? { ...layer, sourceSpan } : layer, index, bounds, override ? authorOverrideMatrix(matrix, bounds, override) : matrix, frame.parameters), baseMatrix: matrix, baseOpacity: pose.opacity ?? 1, opacity: (pose.opacity ?? 1) * (override?.opacity ?? 1),
        ...(textDraws ? { textDraws: structuredClone(textDraws).map(draw => ({ ...draw,
          // 运动层的 GPU scissor 在作者画幅坐标裁切；内部 Canvas clip 已由录制保存。
          ...(posed && layer.clip ? { stageClip: [...layer.clip] as [number, number, number, number] } : {}),
        })) } : {}), textLayouts, unassignedTextLayouts, textUncovered: [...(observed?.textUncoveredByLayer?.[index] ?? []), ...(frame.textUncovered?.get(index) ?? [])] }]
    })
  }
  private renders: Promise<unknown> = Promise.resolve()
  /** One frame at a time per instance: a warm-up ahead of the playhead and a visible frame never share surfaces. */
  /**
   * `motionBlur`：序列的运动模糊总开关，管带位姿图层的快门取样。返回 Canvas 图层这一帧的沿用与上传统计（原生 GPU 入口没有）。
   * `output`：`target` 的像素尺寸，缺省等于画布尺寸 `width`×`height`。回放分辨率降低时比画布小：Canvas 图层的作者坐标仍是
   * 画布像素，由宿主按比例缩小栅格与合成；WebGPU / WebGL 入口拿到的 target 与 width/height 是缩小后的像素尺寸。
   */
  render(target: GpuTexture, width: number, height: number, params: AuthorParameters, assets: AuthorAssets, info: AuthorFrameInfo, overrides?: AuthorElementOverrides, inputs?: AuthorGpuInputs, motionBlur = true, output?: { width: number; height: number }): Promise<CodeLayerStatistics | undefined> {
    const result = this.renders.then(() => this.renderFrame(target, width, height, params, assets, info, overrides, inputs, motionBlur, output))
    this.renders = result.catch(() => undefined)
    return result
  }
  private async renderFrame(target: GpuTexture, width: number, height: number, params: AuthorParameters, assets: AuthorAssets, info: AuthorFrameInfo, overrides?: AuthorElementOverrides, inputs?: AuthorGpuInputs, motionBlur = true, output?: { width: number; height: number }): Promise<CodeLayerStatistics | undefined> {
    if (this.closed) throw new Error('代码效果会话已关闭。')
    const frameImages: ImageBitmap[] = []
    // 画布像素到 target 像素的比例：完整分辨率与导出为 1，所有路径与原来逐条相同。
    const outWidth = output?.width ?? width, outHeight = output?.height ?? height
    if (![outWidth, outHeight].every(value => Number.isInteger(value) && value >= 1)) throw new Error('输出尺寸无效。')
    const sx = outWidth / width, sy = outHeight / height
    const scale = sx !== 1 || sy !== 1 ? [sx, sy] as const : undefined
    try {
      params = authorParameterValues(this.parameterMetadata, params)
      if (!Number.isFinite(info.time) || !(info.frameDuration > 0) || !Number.isFinite(info.clip?.time) || !(info.clip.duration > 0)) throw new Error('效果需要有效的帧时间和片段时间。')
      const whole: AuthorLayer = { id: AUTHOR_WHOLE_EFFECT_ID, name: this.effect.name, bounds: [0, 0, width, height], draw() {} }
      if ((this.effect.createWebGPU || this.effect.createWebGL) && overrides && Object.hasOwn(overrides, AUTHOR_WHOLE_EFFECT_ID)) {
        if (!this.nativeOverrideTarget || this.nativeOverrideTarget.width !== outWidth || this.nativeOverrideTarget.height !== outHeight) {
          if (this.nativeOverrideTarget) { this.nativeOverrideTarget.texture.destroy(); this.textures.delete(this.nativeOverrideTarget.texture) }
          const texture = this.device.createTexture({ size: [outWidth, outHeight], format: 'rgba8unorm', usage: 0x01 | 0x02 | 0x04 | 0x08 | 0x10 })
          this.textures.add(texture); this.nativeOverrideTarget = { texture, width: outWidth, height: outHeight }
        }
        const picture = this.nativeOverrideTarget.texture
        const statistics = await this.renderFrame(picture, width, height, params, assets, info, undefined, inputs, motionBlur, output)
        await this.layers.begin(target)
        const samples = authorLayerSamples(whole, this.effect, info, { x: 0, y: 0, width, height }, overrides[AUTHOR_WHOLE_EFFECT_ID], motionBlur)
        // 整幅画面按画布像素取样（纹理坐标与纹理尺寸无关），覆盖矩阵仍是画布像素，外面再叠输出比例。
        this.layers.draw(target, outWidth, outHeight, { texture: picture, x: 0, y: 0, width, height }, samples, undefined, scale)
        this.layers.finish()
        this.lastFrame = { layers: [whole], width, height, time: info.time, parameters: params, overrides }
        return statistics
      }
      if (this.effect.createWebGPU) {
        this.webgpu ??= await this.effect.createWebGPU(this.device)
        await this.webgpu.draw(target, info.time, params, outWidth, outHeight, assets, info, inputs)
        this.lastFrame = { layers: [whole], width, height, time: info.time, parameters: params }
        return undefined
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
        if (canvas.width !== outWidth) canvas.width = outWidth
        if (canvas.height !== outHeight) canvas.height = outHeight
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, outWidth, outHeight)
        gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        this.webgl!.draw(info.time, params, outWidth, outHeight, assets, info)
        this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture: target, premultipliedAlpha: true }, [outWidth, outHeight])
        this.lastFrame = { layers: [whole], width, height, time: info.time, parameters: params }
        return { reused: 0, redrawn: 0, direct: 0, video: 0, uploads: 1, uploadBytes: outWidth * outHeight * 4 }
      }
      // 连续两帧都换了图的输入是逐帧变化的视频帧：之后直接画；某帧没换就回到静态图片的像素缓存。
      for (const [key, cached] of this.canvasImages) {
        const changed = assets[key] !== cached.source
        this.assetChanges.set(key, changed ? (this.assetChanges.get(key) ?? 0) + 1 : 0)
        if (changed || !cached.pixels) { this.canvasImages.delete(key); this.eagerAssets.delete(key) }
      }
      for (const [key, source] of Object.entries(assets)) {
        if (!(source instanceof ImageBitmap) || this.canvasImages.has(key)) continue
        if ((this.assetChanges.get(key) ?? 0) >= 2) { this.canvasImages.set(key, { source, version: ++this.assetVersion }); continue }
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
        if (!cached.pixels) { fresh.set(key, cached.source); return }
        const copyStarted = performance.now()
        const copy = await createImageBitmap(cached.pixels)
        recordVideoEditPreparation('authorAssetCopy', performance.now() - copyStarted)
        frameImages.push(copy); fresh.set(key, copy)
      }
      let recording = false
      const canvasFrame = ++this.canvasFrames
      for (const [key, last] of this.eagerAssets) if (canvasFrame - last > EAGER_FRAMES) this.eagerAssets.delete(key)
      const canvasAssets: Record<string, CanvasImageSource> = {}
      for (const [key, source] of Object.entries(assets)) {
        const cached = this.canvasImages.get(key)
        if (!cached) { canvasAssets[key] = source; continue }
        const standIn = new AuthorCanvasAsset(key, cached.source.width, cached.source.height)
        Object.defineProperty(canvasAssets, key, { enumerable: true, get: () => {
          if (recording) return standIn
          const image = fresh.get(key)
          this.eagerAssets.set(key, canvasFrame)
          if (!image) throw new AuthorAssetPending(key)
          return image
        } })
      }
      assets = canvasAssets
      const assetSignature = (keys: Iterable<string>): string => JSON.stringify([...keys].sort().map(key => [key, this.canvasImages.get(key)?.version]))
      const measure = this.measureContext ??= new OffscreenCanvas(1, 1).getContext('2d') ?? undefined
      for (let attempt = 0; ; attempt++) {
        for (const key of this.eagerAssets.keys()) await freshAsset(key)
        const statistics: CodeLayerStatistics = { reused: 0, redrawn: 0, direct: 0, video: 0, uploads: 0, uploadBytes: 0 }
        const history = new Map<string, LayerHistory>()
        const directText = new Map<number, TextDrawObservation[]>()
        const textUncovered = new Map<number, string[]>(), textLayouts = new Map<string, number | undefined>([...authorModuleTextLayouts.get(this.effect) ?? []].map(id => [id, undefined]))
        let textLayer: number | undefined, recordedLayouts: Map<string, number | undefined> | undefined
        const authorCall = <T>(run: () => T): T => observeTextLayouts(id => { textLayouts.set(id, textLayer); recordedLayouts?.set(id, textLayer) }, () => trackAuthorCanvasText(run))
        const textContext = (ctx: OffscreenCanvasRenderingContext2D, index: number): OffscreenCanvasRenderingContext2D => {
          textLayer = index
          if ((ctx as TextDrawObserverContext)[TEXT_DRAW_OBSERVER]) { (ctx as TextDrawObserverContext)[TEXT_LAYER_CONTEXT]?.(index); return ctx }
          const facts: TextDrawObservation[] = []; directText.set(index, facts)
          return authorCanvasTextContext(ctx, fact => facts.push(fact), reason => { const reasons = textUncovered.get(index) ?? []; if (!reasons.includes(reason)) reasons.push(reason); textUncovered.set(index, reasons) })
        }
        const used = new Set<number>()
        /**
         * Records one layer slot. A recording equal to the previous frame's (same commands, same image versions) is
         * replaced by that previous object, so a texture's content is compared by reference. Unrecordable: undefined.
         */
        /**
         * `cache`：作者声明的内容签名（见 layerCacheSignature）。与上一帧这一层相同、用到的图片版本也没变时不调用 draw，
         * 直接沿用上一帧的录制（随后的栅格比对自然沿用纹理）；没有签名时每帧照常录制比对。
         */
        const record = (slot: string, size: { width: number; height: number }, setup: Matrix, draw: (ctx: OffscreenCanvasRenderingContext2D) => void, cache?: string): { painted?: Painted; volatile: boolean; video: boolean } => {
          const previous = this.history.get(slot)
          let painted: Painted | undefined
          let layouts: Map<string, number | undefined> | undefined
          const held = previous?.painted
          const textRaster = JSON.stringify(setup.slice(0, 4))
          if (cache !== undefined && held && previous.cache === cache && (!held.recording.textDraws.length || previous.textRaster === textRaster) && !this.directLayers.has(slot) && held.assets === assetSignature(held.recording.assets)) { painted = held; layouts = previous.textLayouts; for (const [id, index] of layouts ?? []) textLayouts.set(id, index) }
          else if (measure && !this.directLayers.has(slot)) {
            recording = true
            try {
              recordedLayouts = layouts = new Map(); textLayer = undefined
              const recorded = authorCall(() => recordAuthorCanvas(size, measure, setup, draw))
              const assetVersions = assetSignature(recorded.assets), held = previous?.painted
              painted = held && held.assets === assetVersions && sameAuthorCanvasRecording(held.recording, recorded) ? held : { recording: recorded, assets: assetVersions }
            } catch (error) {
              if (!(error instanceof AuthorCanvasUnrecordable) && !(error instanceof TypeError)) throw error
              // Images handed outside the canvas, pixel reads, unknown APIs: this layer draws directly from now on.
              this.directLayers.add(slot)
            } finally { recording = false; recordedLayouts = undefined; textLayer = undefined }
          }
          const quiet = !previous ? (painted ? Infinity : 0) : painted && painted === previous.painted ? previous.quiet + 1 : 0
          history.set(slot, { painted, quiet, textRaster, textLayouts: layouts, ...(cache !== undefined && painted ? { cache } : {}) })
          return { painted, volatile: quiet < QUIET_FRAMES, video: [...painted?.recording.assets ?? []].some(key => (this.assetChanges.get(key) ?? 0) >= 2) }
        }
        /** `effects`：栅格比画布像素缩小的比例，阴影与滤镜长度按它换算（只给录下的、可换算的图层）。 */
        const paint = async (canvas: OffscreenCanvas, setup: Matrix, parts: Part[], effects?: { sx: number; sy: number }): Promise<void> => {
          for (const part of parts) for (const key of part.painted?.recording.assets ?? []) await freshAsset(key)
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('Canvas2D 不可用。')
          ctx.reset(); ctx.setTransform(...setup)
          const rasterStarted = performance.now()
          for (const part of parts) {
            if (part.painted) replayAuthorCanvas(part.painted.recording, ctx, key => fresh.get(key)!, setup, effects)
            else authorCall(() => part.draw(authorCanvasContext(ctx, setup)))
          }
          recordVideoEditPreparation('authorRaster', performance.now() - rasterStarted)
        }
        const assetSize = (key: string): readonly [number, number] | undefined => { const cached = this.canvasImages.get(key)?.source; return cached && [cached.width, cached.height] }
        /** 录下的几层画到的范围（画布像素）与能否缩小栅格；有一层推不出就是 undefined（整幅）。 */
        const contentOf = (parts: Painted[]): { bounds: AuthorCanvasBox | null | undefined; scalable: boolean } => {
          if (!measure) return { bounds: undefined, scalable: false }
          let bounds: AuthorCanvasBox | null = null, known = true, scalable = true
          for (const part of parts) {
            const content = authorCanvasContent(part.recording, measure, assetSize)
            // 读画布本身的层依赖画布尺寸与已画内容：整幅、按原尺寸画。
            if (content.readsCanvas) return { bounds: undefined, scalable: false }
            scalable &&= content.scalable
            if (content.bounds === undefined) known = false
            else if (content.bounds) bounds = bounds ? [Math.min(bounds[0], content.bounds[0]), Math.min(bounds[1], content.bounds[1]), Math.max(bounds[2], content.bounds[2]), Math.max(bounds[3], content.bounds[3])] : content.bounds
          }
          return { bounds: known ? bounds : undefined, scalable }
        }
        const upload = (source: OffscreenCanvas, texture: GpuTexture, region: { x: number; y: number; width: number; height: number }): void => {
          this.device.queue.copyExternalImageToTexture(region.x || region.y ? { source, origin: [region.x, region.y] } : { source }, { texture, premultipliedAlpha: true }, [region.width, region.height])
          statistics.uploads++; statistics.uploadBytes += region.width * region.height * 4
        }
        /**
         * Still layers drawn in sequence on one transparent canvas, as Frameflow does. Only the part that can hold content
         * is rastered and uploaded: `crop` (the layers' clips, canvas pixels) narrowed to what the recorded commands paint.
         * At a reduced output the raster is scaled like the target, with shadows and filters converted; layers whose drawing
         * cannot be scaled faithfully (direct drawing, reading the canvas, unknown filters) are rastered at canvas pixels
         * with mip levels and drawn smaller. `layers`/`video`: how many author layers the parts stand for, and how many of
         * them draw a video input.
         */
        const stillGroup = async (slot: string, surfaceIndex: number, parts: Part[], crop: { x: number; y: number; width: number; height: number }, layers: number, video: number): Promise<void> => {
          const recorded = parts.every(part => part.painted) ? parts.map(part => part.painted!) : undefined
          const analysed = recorded ? contentOf(recorded) : { bounds: undefined, scalable: false }
          const rx = analysed.scalable ? sx : 1, ry = analysed.scalable ? sy : 1
          const raster = analysed.bounds === null ? null : authorStillRaster(crop, analysed.bounds, rx, ry, rx === 1 ? width : outWidth, ry === 1 ? height : outHeight)
          // 什么也没画（或全在裁剪外）：不占纹理、不画。
          if (!raster) { statistics.reused += layers; statistics.video += video; return }
          const mips = !!scale && rx === 1 && ry === 1
          const surface = this.surface(surfaceIndex, raster.width, raster.height, false, mips)
          used.add(surfaceIndex)
          const content = recorded && { key: `${slot}\u0000${width}x${height}\u0000${raster.x},${raster.y}\u0000${rx},${ry}`, parts: recorded }
          if (content && sameContent(surface.content, content)) { statistics.reused += layers; recordVideoEditPreparation('authorRasterReused', 0) }
          else {
            surface.content = undefined
            const canvas = this.scratch(raster.width, raster.height, 2 * Math.max(width * height, outWidth * outHeight))
            await paint(canvas, [rx, 0, 0, ry, 0 - raster.x, 0 - raster.y], parts, rx !== 1 || ry !== 1 ? { sx: rx, sy: ry } : undefined)
            const uploadStarted = performance.now()
            upload(canvas, surface.texture, { x: 0, y: 0, width: raster.width, height: raster.height })
            if (mips) this.layers.mipmaps(surface.texture, raster.width, raster.height)
            recordVideoEditPreparation('authorUpload', performance.now() - uploadStarted)
            surface.content = content && recorded!.every(part => part.recording.comparable) ? content : undefined
            if (recorded) statistics.redrawn += layers; else statistics.direct += layers
          }
          statistics.video += video
          // 栅格像素 → 画布像素；输出比例由 scale 叠在外面（完整分辨率时就是 [1,0,0,1,x,y]）。
          this.layers.draw(target, outWidth, outHeight, { texture: surface.texture, x: 0, y: 0, width: raster.width, height: raster.height }, [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1 / rx, 0, 0, 1 / ry, raster.x / rx, raster.y / ry], opacity: 1 } }], undefined, scale)
        }
        try {
      const listStarted = performance.now()
      const list = this.effect.layers ? authorCall(() => this.effect.layers!(params, width, height, assets, info)) : [{ ...whole, draw: (ctx: OffscreenCanvasRenderingContext2D, time: number): void => this.effect.draw!(ctx, time, params, width, height, assets, info) }]
      recordVideoEditPreparation('authorLayerList', performance.now() - listStarted)
      if (!Array.isArray(list)) throw new Error('layers() 必须返回图层数组。')
      const drawStill = (ctx: OffscreenCanvasRenderingContext2D, still: AuthorLayer, position: number): void => {
        ctx.save()
        try {
          if (still.clip) { const [x0, y0, x1, y1] = still.clip; ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip() }
          still.draw(textContext(ctx, position), info.time)
        } catch (cause) { throw cause instanceof AuthorCanvasUnrecordable || cause instanceof AuthorAssetPending || cause instanceof TypeError ? cause : new Error(`静态层 ${position + 1}：${cause instanceof Error ? cause.message : String(cause)}`, { cause }) }
        finally { ctx.restore() }
      }
      /**
       * Adjacent untransformed layers [start, end). Each is recorded on its own; layers that changed recently (QUIET_FRAMES)
       * are split from the still ones (see authorStillGroups), so a pulse or a video redraws without the static part.
       */
      const stillRun = async (start: number, end: number): Promise<void> => {
        const run = `flat:${start}:${end}`, frame = { width, height }, full = { x: 0, y: 0, width, height }
        const stills: Array<{ position: number; layer: AuthorLayer; painted: Painted; volatile: boolean; video: boolean }> = []
        if (!this.combinedRuns.has(run)) {
          for (let position = start; position < end; position++) {
            const still = list[position]
            const recorded = record(`still:${position}:${authorLayerId(still, position)}`, frame, IDENTITY, ctx => drawStill(ctx, still, position), layerCacheSignature(still, width, height))
            const painted = recorded.painted
            // 录制不了，或 save/restore 不成对（状态与裁剪会漏给后面的层）：这一段整组画在一张画布上。
            if (!painted?.recording.balanced) { this.combinedRuns.add(run); break }
            stills.push({ position, layer: still, painted, volatile: recorded.volatile, video: recorded.video })
          }
        }
        if (this.combinedRuns.has(run)) {
          const layers = list.slice(start, end)
          const draw = (ctx: OffscreenCanvasRenderingContext2D): void => layers.forEach((still, offset) => drawStill(ctx, still, start + offset))
          const signatures = layers.map(still => layerCacheSignature(still, width, height))
          const recorded = record(run, frame, IDENTITY, draw, signatures.every(value => value !== undefined) ? JSON.stringify(signatures) : undefined)
          await stillGroup(run, start * 2, [{ painted: recorded.painted, draw }], full, layers.length, recorded.video ? 1 : 0)
          return
        }
        for (const group of authorStillGroups(stills.map(still => ({ volatile: still.volatile, isolated: still.painted.recording.isolated })), MAX_STILL_GROUPS)) {
          const members = stills.slice(group.start, group.end)
          const crop = authorStillCrop(members.map(member => member.layer.clip), width, height)
          const video = members.filter(member => member.video).length
          if (!crop) { statistics.reused += members.length; statistics.video += video; continue }
          await stillGroup(`flat:${members[0].position}:${members.at(-1)!.position + 1}`, members[0].position * 2, members.map(member => ({ painted: member.painted, draw: ctx => drawStill(ctx, member.layer, member.position) })), crop, members.length, video)
        }
      }
      await this.layers.begin(target)
      for (let index = 0; index < list.length; index++) {
        const id = authorLayerId(list[index], index), override = overrides && Object.hasOwn(overrides, id) ? overrides[id] : undefined
        const layer = override && !list[index].pose ? { ...list[index], bounds: list[index].bounds ?? [0, 0, width, height] as [number, number, number, number], pose: () => ({}) } : list[index]
        try {
          if (typeof layer.draw !== 'function') throw new Error('缺少 draw(ctx,t)。')
          // Frameflow batches adjacent untransformed layers onto one canvas.
          // This also preserves Canvas compositing between those layers.
          if (!layer.pose) {
            let end = index
            while (end < list.length && !list[end].pose && !(overrides && Object.hasOwn(overrides, authorLayerId(list[end], end)))) end++
            await stillRun(index, end)
            index = end - 1
            continue
          }
          if (!layer.bounds) throw new Error('运动层需要 bounds:[x0,y0,x1,y1]。')
          const [x, y, right, bottom] = layer.bounds ?? [0, 0, width, height]
          if (![x, y, right, bottom].every(Number.isFinite) || right <= x || bottom <= y) throw new Error('图层范围无效。')
          const bounds = { x, y, width: right - x, height: bottom - y }
          const samples = authorLayerSamples(layer, this.effect, info, bounds, override, motionBlur)
          if (!samples.some(sample => sample.pose)) continue
          const center = layer.pose?.(info.time) ?? samples.map(sample => layer.pose?.(info.time + sample.offset.numerator * info.frameDuration)).find(Boolean)
          const need = Math.max(1, ...samples.flatMap(sample => sample.pose ? [Math.hypot(sample.pose.matrix[0], sample.pose.matrix[1]), Math.hypot(sample.pose.matrix[2], sample.pose.matrix[3])] : []))
          const unitPad = authorLayerBlur(center, 1, layer.blurShape).pad
          const textureLimit = (this.device as GpuDevice & { limits?: Record<string, number> }).limits?.maxTextureDimension2D ?? 8192
          const limit = Math.min((textureLimit - 2 * unitPad) / Math.max(bounds.width, bounds.height), Math.sqrt(16e6 / Math.max(1, bounds.width * bounds.height)))
          const slot = `layer:${index}:${id}`
          const fullResolution = authorRasterScale(need, limit, this.liveLayers.has(slot))
          const fullPad = authorLayerBlur(center, fullResolution, layer.blurShape).pad
          const draw = (ctx: OffscreenCanvasRenderingContext2D): void => layer.draw(textContext(ctx, index), info.time)
          const recorded = record(slot, { width: Math.ceil(bounds.width * fullResolution) + fullPad * 2, height: Math.ceil(bounds.height * fullResolution) + fullPad * 2 }, [fullResolution, 0, 0, fullResolution, fullPad - x * fullResolution, fullPad - y * fullResolution], draw, layerCacheSignature(layer, width, height))
          if (recorded.video) { this.liveLayers.add(slot); statistics.video++ } else this.liveLayers.delete(slot)
          // 回放分辨率降低时栅格跟着缩小，阴影与滤镜同比换算；画法换算不了的层（直接绘制、读画布、认不出的滤镜）照原分辨率栅格。
          const shrink = scale ? Math.max(sx, sy) : 1
          const reduced = shrink < 1 && !!recorded.painted && contentOf([recorded.painted]).scalable
          const resolution = reduced ? fullResolution * shrink : fullResolution
          const { radius, pad } = authorLayerBlur(center, resolution, layer.blurShape)
          const surface = this.surface(index * 2, Math.ceil(bounds.width * resolution) + pad * 2, Math.ceil(bounds.height * resolution) + pad * 2, true)
          const canvas = surface.canvas!, region = { x: 0, y: 0, width: canvas.width, height: canvas.height }
          const setup: Matrix = [resolution, 0, 0, resolution, pad - x * resolution, pad - y * resolution]
          const content = recorded.painted && { key: `${slot}\u0000${canvas.width}x${canvas.height}\u0000${setup.join(',')}`, parts: [recorded.painted] }
          const changed = !content || !sameContent(surface.content, content)
          if (changed) {
            surface.content = undefined
            await paint(canvas, setup, [{ painted: recorded.painted, draw }], reduced ? { sx: shrink, sy: shrink } : undefined)
            surface.content = content && recorded.painted!.recording.comparable ? content : undefined
            if (recorded.painted) statistics.redrawn++; else statistics.direct++
          } else { statistics.reused++; recordVideoEditPreparation('authorRasterReused', 0) }
          const uploadStarted = performance.now()
          let picture = surface.texture
          if (radius > 0 && layer.blurShape !== 'lens') {
            // Use the original Canvas/Skia blur operator, without pixel readback
            // or a second author draw. Do not substitute a different blur kernel.
            const blurred = this.surface(index * 2 + 1, canvas.width, canvas.height, true)
            const blurContent = surface.content && { key: `${surface.content.key}\u0000blur:${radius}`, parts: surface.content.parts }
            if (changed || !blurContent || !sameContent(blurred.content, blurContent)) {
              const blurContext = blurred.canvas!.getContext('2d')
              if (!blurContext) throw new Error('Canvas2D 不可用。')
              blurContext.reset(); blurContext.filter = `blur(${radius}px)`
              blurContext.drawImage(canvas, 0, 0); blurContext.filter = 'none'
              upload(blurred.canvas!, blurred.texture, region)
              this.layers.mipmaps(blurred.texture, canvas.width, canvas.height)
              blurred.content = blurContent
            }
            picture = blurred.texture
          } else if (changed) {
            upload(canvas, surface.texture, region)
            this.layers.mipmaps(surface.texture, canvas.width, canvas.height)
          }
          recordVideoEditPreparation('authorUpload', performance.now() - uploadStarted)
          if (radius > 0 && layer.blurShape === 'lens') {
            const blurred = this.surface(index * 2 + 1, canvas.width, canvas.height, true)
            this.layers.lens(surface.texture, blurred.texture, canvas.width, canvas.height, radius)
            this.layers.mipmaps(blurred.texture, canvas.width, canvas.height)
            blurred.content = undefined
            picture = blurred.texture
          }
          const poses = samples.map(sample => {
            if (!sample.pose) return sample
            const m = sample.pose.matrix, ox = x - pad / resolution, oy = y - pad / resolution
            const matrix: CodeMatrix = [m[0] / resolution, m[1] / resolution, m[2] / resolution, m[3] / resolution, m[4] + m[0] * ox + m[2] * oy, m[5] + m[1] * ox + m[3] * oy]
            return { ...sample, pose: { ...sample.pose, matrix } }
          })
          this.layers.draw(target, outWidth, outHeight, { texture: picture, x: 0, y: 0, width: canvas.width, height: canvas.height }, poses, layer.clip, scale)
        } catch (cause) {
          if (cause instanceof AuthorAssetPending) throw cause
          throw new Error(`第 ${index + 1} 层${layer.name ? `「${layer.name}」` : ''}：${cause instanceof Error ? cause.message : String(cause)}`, { cause })
        }
      }
      this.layers.finish()
      this.history = history
      this.lastFrame = { layers: list, width, height, time: info.time, parameters: params, overrides, directText, textUncovered, textLayouts }
      // Still-group textures follow the grouping: drop the ones no group used this frame.
      this.surfaces.forEach((surface, index) => { if (surface && !surface.canvas && !used.has(index)) { this.release(surface); delete this.surfaces[index] } })
      while (this.surfaces.length > list.length * 2) {
        const surface = this.surfaces.pop()
        if (surface) this.release(surface)
      }
      return statistics
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
    this.canvasImages.clear(); this.assetChanges.clear(); this.liveLayers.clear(); this.history.clear(); this.combinedRuns.clear()
    for (const surface of this.surfaces) if (surface?.canvas) { const canvas = surface.canvas; await release(() => { canvas.width = canvas.height = 1 }) }
    this.surfaces.length = 0
    for (const canvas of this.scratchCanvases.values()) await release(() => { canvas.width = canvas.height = 1 })
    this.scratchCanvases.clear()
    await release(() => this.gl?.getExtension('WEBGL_lose_context')?.loseContext())
    if (errors.length) throw new AggregateError(errors, '代码效果资源释放失败。')
  }
}
