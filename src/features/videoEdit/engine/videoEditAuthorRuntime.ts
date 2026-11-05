import { videoEditSourceSeconds } from '@/core/videoEdit/time'
import { VIDEO_EDIT_RENDER_ENGINE_VERSION } from 'virtual:video-edit-render-engine'
import { withTextFontSession } from '@/core/imaging/vectorContent/shaping/fontContext'
import { prepareAuthorTextParameters } from './videoEditAuthorTextResources'
import { CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import { assertCodeElementOverrideAllowed } from '@/core/videoEdit/codeElementOverrides'
import { videoEditEffectNeedsFloat } from './videoEditRenderPrecision'
import { VideoEditAuthorThree } from './videoEditAuthorThree'
import type { AuthorLibraryVersions } from '@/core/videoEdit/codeMaterial/authorLibraries'
import type { EffectQuality } from '@/core/imaging/effects/descriptor'
import { resolveAuthorEffects, resolveAuthorElementEffects, authorEffectBleed, type AuthorEffectEnvironment, type ResolvedAuthorEffect } from '@/core/videoEdit/authorEffects'
import { gaussianSupport, type LayerEffectReference } from '@/core/videoEdit/layerEffectGeometry'
import { BLUR_AMOUNT_MAX, blurAmountForSigma } from '@/core/videoEdit/blur'
import { VideoEditAuthorEffects } from './videoEditAuthorEffects'
import type { VideoEditBuiltinScratchAllocator } from './videoEditBuiltinEffectsGpu'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { CodeMotionSample } from '@/core/videoEdit/codeMaterial/motionSampling'
import type { CodeMatrix } from '@/core/videoEdit/codeMaterial/contract'
import type { CodeLayerStatistics } from '@/core/videoEdit/codeMaterial/performance'
import { VideoEditAuthorGpu } from './videoEditAuthorGpu'
import { codeSimulationIdentity, type CodeSimulationInput } from '@/core/videoEdit/codeSimulation'
import { VideoEditAuthorSimulation } from './videoEditAuthorSimulation'
import { AUTHOR_MOTION_HISTORY, authorDrawExposure, authorDrawSampleCount, authorLayerMotionBlur, authorOverrideMovesLayer, authorShiftedFrameInfo, authorDrawSampleOffset, authorFrameExposure, authorLayerBlur, authorLayerSamples, authorPoseMatrix, authorRasterScale, authorStillCrop, authorStillGroups, authorStillRaster, authorStillSurfaceSize } from './videoEditAuthorLayers'
import { authorCanvasContent, type AuthorCanvasBox } from './videoEditAuthorCanvasBounds'
import { AUTHOR_WHOLE_EFFECT_ID, authorLayerId, authorOverrideMatrix, observeAuthorElement, type AuthorElementObservation, type AuthorElementOverrides } from './videoEditAuthorElements'
import type { AuthorAssets, AuthorFrameInfo, AuthorGpuInputs, AuthorLayer, AuthorModule, AuthorParameters, AuthorWebGL, AuthorWebGPU } from './videoEditAuthorModule'
import { isAuthorAnalyticLayer } from './videoEditAuthorFill'
import { authorFramePosition, isAuthorAdjustment } from './videoEditAuthorModule'
import type { AuthorSourceLocations } from './videoEditAuthorBundle'
import { authorEffectMetadata, authorParameterValues, type AuthorEffectMetadata } from './videoEditAuthorParameters'
import { recordVideoEditPreparation } from './videoEditPreparationTiming'
import { authorMotionRuns, authorPaintMotion, authorRecordingMeasurable, authorSampleRecording, type AuthorPaintMotion } from './videoEditAuthorMotionOps'
import { VideoEditAuthorExposureGpu } from './videoEditAuthorExposureGpu'
import { AuthorCanvasAsset, AuthorCanvasUnrecordable, authorCanvasContext, authorCanvasTextContext, trackAuthorCanvasText, recordAuthorCanvas, replayAuthorCanvas, sameAuthorCanvasRecording, type AuthorCanvasRecording } from './videoEditAuthorCanvasRecorder'
import type { AuthorReplayFilter } from './videoEditAuthorCanvasRecorder'
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
interface Part { painted?: Painted; filter?: AuthorReplayFilter; draw(ctx: OffscreenCanvasRenderingContext2D): void }
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
const MAX_EXPOSURE_RUNS = 6
const EXPOSURE_MEMO_FRAMES = 4
const AUTHOR_PAINT_OPS = new Set(['fill', 'stroke', 'fillRect', 'strokeRect', 'fillText', 'strokeText', 'drawImage', 'textAppearance'])
/** 一组静止层这一帧怎么曝光：按速度图收集，或累加取样。`pad`：拖影可能超出内容范围多远（画布像素）。 */
/** 参与运动比较的一层。`raster`：带位姿的层有自己的栅格尺寸和变换。 */
interface ExposureMember { position: number; layer: AuthorLayer; painted: Painted; slot: string; raster?: { size: { width: number; height: number }; setup: Matrix } }
interface StillExposure { pad: number; gather?: { motions: Array<AuthorPaintMotion | undefined>; longest: number; runs: Array<{ moving: boolean; paints: Map<number, Set<number>> }> }; samples?: Part[][] }
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
  private layerEffects?: VideoEditAuthorEffects
  private readonly sourceVersions = new Map<string, number>()
  private layerGpu?: VideoEditAuthorGpu
  private get layers(): VideoEditAuthorGpu { return this.layerGpu ??= new VideoEditAuthorGpu(this.device) }
  private gl?: WebGL2RenderingContext
  private webgl?: AuthorWebGL
  private webgpu?: AuthorWebGPU
  private three?: VideoEditAuthorThree
  get worldBounds(): import('@/core/videoEdit/spatialTypes').SpatialBounds | null { return this.three?.worldBounds ?? null }
  get threeBytes(): number { return this.three?.allocationBytes ?? 0 }
  private nativeOverrideTarget?: { texture: GpuTexture; width: number; height: number }
  private promotedTarget?: { texture: GpuTexture; width: number; height: number }
  private renderedTarget?: GpuTexture
  get outputTexture(): GpuTexture | undefined { return this.renderedTarget }
  private closed = false
  private simulation?: VideoEditAuthorSimulation
  readonly parameterMetadata: AuthorEffectMetadata
  private lastFrame?: { carriesLight?: boolean; effects?: Map<number, ResolvedAuthorEffect[]>; effectStates?: Map<number, import('@/core/videoEdit/authorEffects').AuthorElementEffectState[]>; layers: AuthorLayer[]; width: number; height: number; time: number; parameters: AuthorParameters; overrides?: AuthorElementOverrides; directText?: Map<number, TextDrawObservation[]>; textUncovered?: Map<number, string[]>; textLayouts?: Map<string, number | undefined> }
  get carriesLight(): boolean { return this.lastFrame?.carriesLight === true }
  private readonly effectAllocator: VideoEditBuiltinScratchAllocator
  constructor(private readonly device: GpuDevice, private readonly effect: AuthorModule, private readonly locations?: AuthorSourceLocations, private readonly ownsModule = true, private readonly apiVersion?: number, private readonly effectEnvironment: () => AuthorEffectEnvironment = () => ({}), private readonly allocator?: VideoEditBuiltinScratchAllocator, private readonly libraries?: AuthorLibraryVersions) {
    this.parameterMetadata = authorEffectMetadata(effect, this.apiVersion)
    this.effectAllocator = allocator ?? {
      allocate: (width, height, format, mipLevelCount = 1) => this.texture(width, height, mipLevelCount > 1, format),
      release: texture => { texture.destroy(); this.textures.delete(texture) },
    }
  }
  private texture(width: number, height: number, mips: boolean, format = 'rgba8unorm', storage = false): GpuTexture {
    const mipLevelCount = mips ? 1 + Math.floor(Math.log2(Math.max(width, height))) : 1
    const texture = this.allocator ? this.allocator.allocate(width, height, format, mipLevelCount, storage) : this.device.createTexture({ size: [width, height], mipLevelCount, format, usage: 0x01 | 0x02 | 0x04 | 0x10 | (storage ? 0x08 : 0) })
    this.textures.add(texture)
    return texture
  }
  get canvasBytes(): number {
    return ([...this.scratchCanvases.values(), ...this.surfaces.flatMap(surface => surface?.canvas ? [surface.canvas] : [])]).reduce((bytes, canvas) => bytes + canvas.width * canvas.height * 4, 0) + (this.exposureTarget ? this.exposureTarget.width * this.exposureTarget.height * 8 : 0)
  }
  private releaseTexture(texture: GpuTexture): void {
    if (this.allocator) this.allocator.release(texture)
    else texture.destroy()
    this.textures.delete(texture)
  }
  private release(surface: Surface): void {
    this.releaseTexture(surface.texture)
    if (surface.canvas) surface.canvas.width = surface.canvas.height = 1
  }
  /**
   * `canvas`: a motion layer's own raster canvas with a mipmapped texture; otherwise a texture for a still group.
   * `mips`: a still group rastered larger than it is drawn (full canvas pixels into a reduced target) samples mip levels.
   */
  private surface(index: number, width: number, height: number, canvas: boolean, mips = canvas): Surface {
    const previous = this.surfaces[index]
    if (previous && previous.width === width && previous.height === height && !!previous.canvas === canvas && !!previous.mips === mips) return previous
    const surface: Surface = { ...(canvas ? { canvas: new OffscreenCanvas(width, height) } : {}), texture: this.texture(width, height, mips), width, height, mips }
    if (previous) this.release(previous)
    this.surfaces[index] = surface
    return surface
  }
  private exposureTarget?: OffscreenCanvas
  private exposureGpu?: VideoEditAuthorExposureGpu
  /** 每个图层最近几帧的录制；连续播放时运动比较全靠它，不用重跑作者代码。 */
  private exposureMemo = new Map<string, Array<{ time: number; painted: Painted; params: string }>>()
  private exposureMemoKey = ''
  private exposureTextures = new Map<string, GpuTexture>()
  /** 只增不减：内容范围逐帧变化时不用反复建高精度画布。 */
  private exposureCanvas(width: number, height: number): OffscreenCanvas {
    if (!this.exposureTarget || this.exposureTarget.width < width || this.exposureTarget.height < height) {
      this.exposureTarget = new OffscreenCanvas(Math.max(width, this.exposureTarget?.width ?? 0), Math.max(height, this.exposureTarget?.height ?? 0))
      this.exposureTarget.getContext('2d', { colorType: 'float16' } as CanvasRenderingContext2DSettings)
    }
    return this.exposureTarget
  }
  /** 曝光用的中间纹理按名字留到下一帧复用，这一帧没用到的在帧尾还掉。 */
  private exposureTexture(key: string, width: number, height: number, format: string, mips: boolean, used: Set<string>): GpuTexture {
    const name = `${key}:${width}x${height}:${format}:${mips}`
    used.add(name)
    let texture = this.exposureTextures.get(name)
    if (!texture) { texture = this.texture(width, height, mips, format); this.exposureTextures.set(name, texture) }
    return texture
  }
  private settleExposureTextures(used: ReadonlySet<string>): void {
    for (const [name, texture] of this.exposureTextures) if (!used.has(name)) { this.releaseTexture(texture); this.exposureTextures.delete(name) }
    this.exposureGpu?.release()
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
    return frame.layers.flatMap((layer, index): AuthorElementObservation[] => {
      const pose = layer.pose ? layer.pose(frame.time) : {}
      const id = authorLayerId(layer, index), override = frame.overrides && Object.hasOwn(frame.overrides, id) ? frame.overrides[id] : undefined
      if (!pose || override?.hidden || (pose.opacity ?? 1) * (override?.opacity ?? 1) <= 0) return []
      if (isAuthorAdjustment(layer, this.apiVersion ?? CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION)) {
        const sourceSpan = layer.sourceSpan ?? this.locations?.layers[id] ?? this.locations?.fallback
        return [{ kind: 'adjust', ...(layer.clip ? { clip: [...layer.clip] as [number, number, number, number] } : {}), id, name: layer.name ?? id, matrix: [...IDENTITY] as Matrix, corners: [],
          ...(sourceSpan ? { sourceSpan } : {}), parameterKeys: (this.effect.params ?? []).filter(parameter => parameter.layer === id).map(parameter => parameter.key), textParameterKeys: [],
          effects: frame.effects?.get(index) ?? [], effectStates: frame.effectStates?.get(index) ?? [], effectsTime: frame.time, baseOpacity: pose.opacity ?? 1, opacity: (pose.opacity ?? 1) * (override?.opacity ?? 1) }]
      }
      const bounds = layer.bounds ?? [0, 0, frame.width, frame.height]
      const matrix = authorPoseMatrix(pose)
      const posed = !!layer.pose || (this.apiVersion ?? CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION) >= CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION && !!layer.effects || !!override
      const recording = this.history.get(`${posed ? 'layer' : 'still'}:${index}:${id}`)?.painted?.recording
      const combined = [...this.history.entries()].find(([key]) => { const match = /^flat:(\d+):(\d+)$/.exec(key); return match && index >= Number(match[1]) && index < Number(match[2]) })?.[1].painted?.recording
      const observed = combined ?? recording
      const textDraws = frame.directText?.get(index) ?? observed?.textDraws.filter(draw => draw.layerIndex === undefined || draw.layerIndex === index)
      const canvasReview = observed?.canvasReview?.filter(fact => (fact.layerIndex === undefined || fact.layerIndex === index) && (posed || fact.kind !== 'shadow_outside_source'))
      const textLayouts = [...frame.textLayouts ?? []].filter(([, owner]) => owner === index).map(([id]) => id)
      const unassignedTextLayouts = attachedUnassigned ? [] : [...frame.textLayouts ?? []].filter(([, owner]) => owner === undefined).map(([id]) => id)
      attachedUnassigned = true
      const sourceSpan = layer.sourceSpan ?? this.locations?.layers[id] ?? (layer.factory && this.locations?.factories?.[layer.factory.file]?.[layer.factory.name]) ?? this.locations?.fallback
      return [{ ...observeAuthorElement(this.effect, sourceSpan ? { ...layer, sourceSpan } : layer, index, bounds, override ? authorOverrideMatrix(matrix, bounds, override) : matrix, frame.parameters), effects: frame.effects?.get(index) ?? [], effectStates: frame.effectStates?.get(index) ?? [], effectsTime: frame.time, baseMatrix: matrix, baseOpacity: pose.opacity ?? 1, opacity: (pose.opacity ?? 1) * (override?.opacity ?? 1),
        ...(textDraws ? { textDraws: structuredClone(textDraws).map(draw => ({ ...draw,
          // 运动层的 GPU scissor 在作者画幅坐标裁切；内部 Canvas clip 已由录制保存。
          ...(posed && layer.clip ? { stageClip: [...layer.clip] as [number, number, number, number] } : {}),
        })) } : {}), ...(canvasReview ? { canvasReview: structuredClone(canvasReview) } : {}), textLayouts, unassignedTextLayouts, textUncovered: [...(observed?.textUncoveredByLayer?.[index] ?? []), ...(frame.textUncovered?.get(index) ?? [])] }]
    })
  }
  private renders: Promise<unknown> = Promise.resolve()
  /**
   * 按本帧更新 three 场景并交出根节点，由统一三维渲染器挂进同一场景绘制（不经作者自带的渲染桥）。
   * 根节点是活对象：调用方须在同一实例的下一次更新之前用完。
   */
  stageThree(width: number, height: number, params: AuthorParameters, assets: AuthorAssets, info: AuthorFrameInfo): Promise<{ root: import('three').Group; worldBounds: import('@/core/videoEdit/spatialTypes').SpatialBounds | null; time: number }> {
    const result = this.renders.then(async () => {
      if (this.closed) throw new Error('代码效果会话已关闭。')
      if (!this.effect.createThree || !info.space) throw new Error('三维场景需要 createThree 与空间上下文。')
      this.three ??= await VideoEditAuthorThree.create(this.device, this.effect.createThree, width, height, this.libraries, undefined, this.apiVersion)
      const worldBounds = this.three.update(authorParameterValues(this.parameterMetadata, params), assets, { ...info, space: info.space })
      return { root: this.three.root, worldBounds, time: info.time }
    })
    this.renders = result.catch(() => undefined)
    return result
  }
  /** One frame at a time per instance: a warm-up ahead of the playhead and a visible frame never share surfaces. */
  /**
   * `motionBlur`：序列的运动模糊总开关，管带位姿图层的快门取样。返回 Canvas 图层这一帧的沿用与上传统计（原生 GPU 入口没有）。
   * `output`：`target` 的像素尺寸，缺省等于画布尺寸 `width`×`height`。回放分辨率降低时比画布小：Canvas 图层的作者坐标仍是
   * 画布像素，由宿主按比例缩小栅格与合成；WebGPU / WebGL 入口拿到的 target 与 width/height 是缩小后的像素尺寸。
   */
  render(target: GpuTexture | (() => GpuTexture), width: number, height: number, params: AuthorParameters, assets: AuthorAssets, info: AuthorFrameInfo, overrides?: AuthorElementOverrides, inputs?: AuthorGpuInputs, motionBlur = true, output?: { width: number; height: number }, environment: AuthorEffectEnvironment = this.effectEnvironment(), quality: EffectQuality = 'interactive', beforeCommit: () => void = () => {}, promote?: () => GpuTexture, simulationInput?: CodeSimulationInput): Promise<CodeLayerStatistics | undefined> {
    const result = this.renders.then(() => this.renderFrame(target, width, height, params, assets, info, overrides, inputs, motionBlur, output, environment, quality, beforeCommit, promote, simulationInput))
    this.renders = result.catch(() => undefined)
    return result
  }
  private async renderFrame(initialTarget: GpuTexture | (() => GpuTexture), width: number, height: number, params: AuthorParameters, assets: AuthorAssets, info: AuthorFrameInfo, overrides?: AuthorElementOverrides, inputs?: AuthorGpuInputs, motionBlur = true, output?: { width: number; height: number }, environment: AuthorEffectEnvironment = this.effectEnvironment(), quality: EffectQuality = 'interactive', beforeCommit: () => void = () => {}, promote?: () => GpuTexture, simulationInput?: CodeSimulationInput): Promise<CodeLayerStatistics | undefined> {
    if (this.closed) throw new Error('代码效果会话已关闭。')
    this.renderedTarget = undefined
    const resolveInitialTarget = (): GpuTexture => typeof initialTarget === 'function' ? initialTarget() : initialTarget
    const frameImages: ImageBitmap[] = []
    // 画布像素到 target 像素的比例：完整分辨率与导出为 1，所有路径与原来逐条相同。
    const outWidth = output?.width ?? width, outHeight = output?.height ?? height
    if (![outWidth, outHeight].every(value => Number.isInteger(value) && value >= 1)) throw new Error('输出尺寸无效。')
    const sx = outWidth / width, sy = outHeight / height
    const scale = sx !== 1 || sy !== 1 ? [sx, sy] as const : undefined
    const changedSurfaces = new Set<Surface>()
    try {
      params = authorParameterValues(this.parameterMetadata, params)
      const preparing = prepareAuthorTextParameters(this.effect, params)
      const text = preparing && await preparing
      if (!Number.isFinite(info.time) || !(info.frameDuration > 0) || !Number.isFinite(info.clip?.time) || !(info.clip.duration > 0)) throw new Error('效果需要有效的帧时间和片段时间。')
      if (this.parameterMetadata.simulation) {
        const input = simulationInput ?? { identity: codeSimulationIdentity(this.locations, params, { width, height }, this.parameterMetadata.simulation), parametersAt: () => params }
        const identity = codeSimulationIdentity([VIDEO_EDIT_RENDER_ENGINE_VERSION, input.identity], this.parameterMetadata.parameters, { width, height }, this.parameterMetadata.simulation)
        if (this.simulation?.identity !== identity) {
          await this.simulation?.dispose()
          this.simulation = new VideoEditAuthorSimulation(this.effect.createSimulation!.bind(this.effect), this.parameterMetadata.simulation, { width, height }, identity, this.effect.durationSeconds)
        }
        const exposure = authorFrameExposure(this.effect, info, motionBlur, this.apiVersion)
        const relative = (time: number) => input.sourceOrigin ? (time - videoEditSourceSeconds(input.sourceOrigin)) * (input.sourceDirection ?? 1) : time
        const simulation = await this.simulation.prepare({ start: Math.min(relative(exposure.start), relative(exposure.end)), end: Math.max(relative(exposure.start), relative(exposure.end)), center: relative(info.time), input: { ...input, identity, parametersAt: (step, rate) => authorParameterValues(this.parameterMetadata, input.parametersAt(step, rate)), assertCurrent: () => { beforeCommit(); input.assertCurrent?.() } } })
        info = { ...info, simulation: input.sourceOrigin ? { at: time => simulation.at(relative(time)) } : simulation }
      }
      const whole: AuthorLayer = { id: AUTHOR_WHOLE_EFFECT_ID, name: this.effect.name, bounds: [0, 0, width, height], draw() {} }
      if (!this.effect.space && !this.effect.createThree && info.space) { const { space: _space, ...plain } = info; info = plain }
      if ((this.effect.space || this.effect.createThree) && !info.space) throw new Error('空间作者需要宿主提供当前样本的空间上下文。')
      if (this.effect.createThree) {
        this.three ??= await VideoEditAuthorThree.create(this.device, this.effect.createThree, width, height, this.libraries, undefined, this.apiVersion)
        beforeCommit()
        const target = resolveInitialTarget()
        await this.three.render(target, outWidth, outHeight, params, assets, { ...info, space: info.space! }, beforeCommit)
        beforeCommit()
        this.renderedTarget = target
        // 节点材质可输出零 alpha 光贡献，宿主不能仅凭包围几何证明它不存在。
        this.lastFrame = { layers: [whole], width, height, time: info.time, parameters: params, carriesLight: true }
        return undefined
      }
      if ((this.effect.createWebGPU || this.effect.createWebGL) && overrides && Object.hasOwn(overrides, AUTHOR_WHOLE_EFFECT_ID)) {
        if (!this.nativeOverrideTarget || this.nativeOverrideTarget.width !== outWidth || this.nativeOverrideTarget.height !== outHeight) {
          const texture = this.texture(outWidth, outHeight, false, 'rgba8unorm', !!this.effect.createWebGPU)
          if (this.nativeOverrideTarget) this.releaseTexture(this.nativeOverrideTarget.texture)
          this.textures.add(texture); this.nativeOverrideTarget = { texture, width: outWidth, height: outHeight }
        }
        const picture = this.nativeOverrideTarget.texture
        const statistics = await this.renderFrame(picture, width, height, params, assets, info, undefined, inputs, motionBlur, output, environment, quality, beforeCommit, promote, simulationInput)
        const target = resolveInitialTarget()
        await this.layers.begin(target)
        const samples = authorLayerSamples(whole, this.effect, info, { x: 0, y: 0, width, height }, overrides[AUTHOR_WHOLE_EFFECT_ID], motionBlur, this.apiVersion ?? 0)
        // 整幅画面按画布像素取样（纹理坐标与纹理尺寸无关），覆盖矩阵仍是画布像素，外面再叠输出比例。
        this.layers.draw(target, outWidth, outHeight, { texture: picture, x: 0, y: 0, width, height }, samples, undefined, scale)
        this.layers.finish()
        this.lastFrame = { layers: [whole], width, height, time: info.time, parameters: params, overrides }
        return statistics
      }
      if (this.effect.createWebGPU) {
        this.webgpu ??= await withTextFontSession(text?.fonts, () => this.effect.createWebGPU!(this.device))
        await withTextFontSession(text?.fonts, () => this.webgpu!.draw(resolveInitialTarget(), info.time, params, outWidth, outHeight, assets, info, inputs))
        this.lastFrame = { layers: [whole], width, height, time: info.time, parameters: params }
        return undefined
      }
      if (this.effect.createWebGL) {
        // Preserve the context when dimensions change; recreate only the upload texture.
        if (!this.gl) {
          const canvas = new OffscreenCanvas(width, height)
          this.gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true }) ?? undefined
          if (!this.gl) throw new Error('WebGL2 不可用。')
          this.webgl = withTextFontSession(text?.fonts, () => this.effect.createWebGL!(this.gl!))
        }
        const gl = this.gl, canvas = gl.canvas as OffscreenCanvas
        if (canvas.width !== outWidth) canvas.width = outWidth
        if (canvas.height !== outHeight) canvas.height = outHeight
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, outWidth, outHeight)
        gl.disable(gl.SCISSOR_TEST); gl.colorMask(true, true, true, true); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT)
        withTextFontSession(text?.fonts, () => this.webgl!.draw(info.time, params, outWidth, outHeight, assets, info))
        this.device.queue.copyExternalImageToTexture({ source: canvas }, { texture: resolveInitialTarget(), premultipliedAlpha: true }, [outWidth, outHeight])
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
        const authorCall = <T>(run: () => T): T => observeTextLayouts(id => { textLayouts.set(id, textLayer); recordedLayouts?.set(id, textLayer) }, () => withTextFontSession(text?.fonts, () => trackAuthorCanvasText(run)))
        const textContext = (ctx: OffscreenCanvasRenderingContext2D, index: number): OffscreenCanvasRenderingContext2D => {
          textLayer = index
          if ((ctx as TextDrawObserverContext)[TEXT_DRAW_OBSERVER]) { (ctx as TextDrawObserverContext)[TEXT_LAYER_CONTEXT]?.(index); return ctx }
          const facts: TextDrawObservation[] = []; directText.set(index, facts)
          return authorCanvasTextContext(ctx, fact => facts.push(fact), reason => { const reasons = textUncovered.get(index) ?? []; if (!reasons.includes(reason)) reasons.push(reason); textUncovered.set(index, reasons) })
        }
        let target: GpuTexture | undefined
        let hasContent = false
        const stackTarget = (): GpuTexture => {
          if (!target) { target = resolveInitialTarget(); this.layers.clear(target) }
          return target
        }
        const promoteStack = async (): Promise<void> => {
          if (target?.format === 'rgba16float') return
          await this.layers.prepareFormat('rgba16float')
          let upgraded: GpuTexture
          if (promote) upgraded = promote()
          else if (typeof initialTarget !== 'function' && initialTarget.format === 'rgba16float') upgraded = initialTarget
          else {
            if (!this.promotedTarget || this.promotedTarget.width !== outWidth || this.promotedTarget.height !== outHeight) {
              const texture = this.effectAllocator.allocate(outWidth, outHeight, 'rgba16float')
              if (this.promotedTarget) this.effectAllocator.release(this.promotedTarget.texture)
              this.promotedTarget = { texture, width: outWidth, height: outHeight }
            }
            upgraded = this.promotedTarget.texture
          }
          if (hasContent) this.layers.copy(target!, upgraded, outWidth, outHeight)
          else this.layers.clear(upgraded)
          target = upgraded
        }
        const used = new Set<number>(), usedExposure = new Set<string>()
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
              const drawStarted = performance.now()
              const recorded = authorCall(() => recordAuthorCanvas(size, measure, setup, draw))
              recordVideoEditPreparation('authorDraw', performance.now() - drawStarted)
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
            if (part.painted) replayAuthorCanvas(part.painted.recording, ctx, key => fresh.get(key)!, setup, effects, part.filter)
            else authorCall(() => part.draw(authorCanvasContext(ctx, setup)))
          }
          recordVideoEditPreparation('authorRaster', performance.now() - rasterStarted)
        }
        /** 各次取样在高精度画布上相加求平均，最后只上传一次；8 位画布累加 1/N 会把静止的内容算淡。 */
        const accumulate = async (canvas: OffscreenCanvas, rasterWidth: number, rasterHeight: number, setup: Matrix, samples: readonly Part[][], effects?: { sx: number; sy: number }): Promise<OffscreenCanvas> => {
          const sum = this.exposureCanvas(rasterWidth, rasterHeight), target = sum.getContext('2d') as OffscreenCanvasRenderingContext2D
          target.reset()
          target.globalCompositeOperation = 'lighter'; target.globalAlpha = 1 / samples.length
          for (const sample of samples) { await paint(canvas, setup, sample, effects); target.drawImage(canvas, 0, 0) }
          return sum
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
        /** `exposure`：这一组有运动时怎么曝光；有它时不走相邻帧的纹理沿用。 */
        const stillGroup = async (slot: string, surfaceIndex: number, parts: Part[], crop: { x: number; y: number; width: number; height: number }, layers: number, video: number, exposure?: StillExposure): Promise<void> => {
          const recorded = parts.every(part => part.painted) ? parts.map(part => part.painted!) : undefined
          const analysed = recorded ? contentOf(recorded) : { bounds: undefined, scalable: false }
          if (exposure && analysed.bounds) analysed.bounds = [analysed.bounds[0] - exposure.pad, analysed.bounds[1] - exposure.pad, analysed.bounds[2] + exposure.pad, analysed.bounds[3] + exposure.pad]
          const rx = analysed.scalable ? sx : 1, ry = analysed.scalable ? sy : 1
          const exact = analysed.bounds === null ? null : authorStillRaster(crop, analysed.bounds, rx, ry, rx === 1 ? width : outWidth, ry === 1 ? height : outHeight)
          // 什么也没画（或全在裁剪外）：不占纹理、不画。
          if (!exact) { statistics.reused += layers; statistics.video += video; return }
          const mips = !!scale && rx === 1 && ry === 1
          const raster = { ...exact, width: authorStillSurfaceSize(exact.width, rx === 1 ? width : outWidth), height: authorStillSurfaceSize(exact.height, ry === 1 ? height : outHeight) }
          const placed: CodeMotionSample[] = [{ offset: { numerator: 0, denominator: 1 }, weight: 1, pose: { matrix: [1 / rx, 0, 0, 1 / ry, raster.x / rx, raster.y / ry], opacity: 1 } }]
          if (exposure?.gather) {
            // 按绘制顺序分段：静止段直接上屏，运动段再按速度图收集，运动的字不会带走压在下面的内容。
            const setup: Matrix = [rx, 0, 0, ry, 0 - raster.x, 0 - raster.y], effects = rx !== 1 || ry !== 1 ? { sx: rx, sy: ry } : undefined
            const canvas = this.scratch(raster.width, raster.height, 2 * Math.max(width * height, outWidth * outHeight))
            const range = exposure.gather.longest * Math.max(rx, ry) * 2 + 4
            for (const [runIndex, run] of exposure.gather.runs.entries()) {
              const only = (partIndex: number): ReadonlySet<number> => run.paints.get(partIndex) ?? new Set()
              await paint(canvas, setup, parts.map((part, partIndex) => ({ ...part, filter: { only: only(partIndex) } })), effects)
              const color = this.exposureTexture(`${slot}:${runIndex}:color`, raster.width, raster.height, 'rgba8unorm', mips && !run.moving, usedExposure)
              upload(canvas, color, { x: 0, y: 0, width: raster.width, height: raster.height })
              let picture = color
              if (run.moving) {
                const encode = (value: number): string => (value / range + .5).toFixed(5)
                const sum = this.exposureCanvas(raster.width, raster.height)
                await paint(sum, setup, parts.map((part, partIndex) => ({ ...part, filter: { only: only(partIndex), velocity: (op: number): string => {
                  const move = exposure.gather!.motions[partIndex]?.moves.get(op)
                  return `color(srgb ${encode((move?.[0] ?? 0) * rx)} ${encode((move?.[1] ?? 0) * ry)} 0)`
                } } })), effects)
                const velocity = this.exposureTexture(`${slot}:${runIndex}:velocity`, raster.width, raster.height, 'rgba16float', false, usedExposure)
                upload(sum, velocity, { x: 0, y: 0, width: raster.width, height: raster.height })
                picture = this.exposureTexture(`${slot}:${runIndex}:out`, raster.width, raster.height, 'rgba8unorm', mips, usedExposure)
                recordVideoEditPreparation('authorExposureRuns', 1)
                this.exposureGpu ??= new VideoEditAuthorExposureGpu(this.device, this.effectAllocator)
                await this.exposureGpu.encode(this.layers.commandEncoder(), color, velocity, picture, raster, range, exposure.gather.longest * Math.max(rx, ry), quality === 'final' ? 63 : 25, quality === 'final' ? 1 : 2)
              }
              if (mips) this.layers.mipmaps(picture, raster.width, raster.height)
              hasContent = this.layers.draw(stackTarget, outWidth, outHeight, { texture: picture, x: 0, y: 0, width: raster.width, height: raster.height }, placed, undefined, scale) || hasContent
            }
            statistics.redrawn += layers; statistics.video += video
            return
          }
          const surface = this.surface(surfaceIndex, raster.width, raster.height, false, mips)
          used.add(surfaceIndex)
          const content = recorded && !exposure && { key: `${slot}\u0000${width}x${height}\u0000${raster.x},${raster.y}\u0000${rx},${ry}`, parts: recorded }
          if (content && sameContent(surface.content, content)) { statistics.reused += layers; recordVideoEditPreparation('authorRasterReused', 0) }
          else {
            changedSurfaces.add(surface)
            surface.content = undefined
            const canvas = this.scratch(raster.width, raster.height, 2 * Math.max(width * height, outWidth * outHeight))
            const setup: Matrix = [rx, 0, 0, ry, 0 - raster.x, 0 - raster.y], effects = rx !== 1 || ry !== 1 ? { sx: rx, sy: ry } : undefined
            let finished: OffscreenCanvas = canvas
            if (exposure?.samples) {
              finished = await accumulate(canvas, raster.width, raster.height, setup, exposure.samples, effects)
            } else await paint(canvas, setup, parts, effects)
            const uploadStarted = performance.now()
            upload(finished, surface.texture, { x: 0, y: 0, width: raster.width, height: raster.height })
            if (mips) this.layers.mipmaps(surface.texture, raster.width, raster.height)
            recordVideoEditPreparation('authorUpload', performance.now() - uploadStarted)
            surface.content = content && recorded!.every(part => part.recording.comparable) ? content : undefined
            if (recorded) statistics.redrawn += layers; else statistics.direct += layers
          }
          statistics.video += video
          // 栅格像素 → 画布像素；输出比例由 scale 叠在外面（完整分辨率时就是 [1,0,0,1,x,y]）。
          hasContent = this.layers.draw(stackTarget, outWidth, outHeight, { texture: surface.texture, x: 0, y: 0, width: raster.width, height: raster.height }, placed, undefined, scale) || hasContent
        }
        try {
      const listStarted = performance.now()
      const list = this.effect.layers ? authorCall(() => this.effect.layers!(params, width, height, assets, info)) : [{ ...whole, draw: (ctx: OffscreenCanvasRenderingContext2D, time: number): void => this.effect.draw!(ctx, time, params, width, height, assets, info) }]
      recordVideoEditPreparation('authorLayerList', performance.now() - listStarted)
      if (!Array.isArray(list)) throw new Error('layers() 必须返回图层数组。')
      for (const layer of list) isAuthorAdjustment(layer, this.apiVersion ?? CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION)
      const evaluated = new Map<number, ResolvedAuthorEffect[]>()
      const effectStates = new Map<number, import('@/core/videoEdit/authorEffects').AuthorElementEffectState[]>()
      let carriesLight = false
      const drawExposure = authorDrawExposure(this.effect, this.apiVersion ?? 0)
      if (drawExposure) {
        const exposureKey = JSON.stringify([width, height, info.clip.duration])
        if (exposureKey !== this.exposureMemoKey) { this.exposureMemo.clear(); this.exposureMemoKey = exposureKey }
      }
      const drawStill = (ctx: OffscreenCanvasRenderingContext2D, still: AuthorLayer, position: number, time = info.time): void => {
        ctx.save()
        try {
          if (still.clip) { const [x0, y0, x1, y1] = still.clip; ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip() }
          still.draw!(textContext(ctx, position), time)
        } catch (cause) { throw cause instanceof AuthorCanvasUnrecordable || cause instanceof AuthorAssetPending || cause instanceof TypeError ? cause : new Error(`静态层 ${position + 1}：${cause instanceof Error ? cause.message : String(cause)}`, { cause }) }
        finally { ctx.restore() }
      }
      /**
       * Adjacent untransformed layers [start, end). Each is recorded on its own; layers that changed recently (QUIET_FRAMES)
       * are split from the still ones (see authorStillGroups), so a pulse or a video redraws without the static part.
       */
      const probes = new Map<number, AuthorLayer[] | undefined>()
      const frameParams = drawExposure ? JSON.stringify(params) : '', touched = new Set<string>()
      const probeCall = <T>(run: () => T): T => withTextFontSession(text?.fonts, () => trackAuthorCanvasText(run))
        /** 另一时刻的图层表。不进文字观察：那一帧的排版不属于这一帧。 */
        const probeLayers = (frames: number): AuthorLayer[] | undefined => {
          if (probes.has(frames)) return probes.get(frames)
          const earlier = authorShiftedFrameInfo(info, frames)
          let layers: AuthorLayer[] | undefined
          try {
            layers = this.effect.layers ? probeCall(() => this.effect.layers!(params, width, height, assets, earlier)) : [{ ...whole, draw: (ctx: OffscreenCanvasRenderingContext2D, time: number): void => this.effect.draw!(ctx, time, params, width, height, assets, earlier) }]
          } catch (error) {
            if (error instanceof AuthorAssetPending) throw error
          }
          probes.set(frames, Array.isArray(layers) ? layers : undefined)
          return probes.get(frames)
        }
        /** 在另一时刻录一遍这一层；那一刻没有这一层或者画不了，就当它刚出现。 */
        const recordAt = (member: ExposureMember, frames: number): Painted | undefined => {
          const earlier = probeLayers(frames)?.[member.position]
          if (!measure || !earlier || typeof earlier.draw !== 'function' || authorLayerId(earlier, member.position) !== authorLayerId(member.layer, member.position)) return undefined
          // 作者声明这一层内容没变，不用为了比较再画一遍。
          const signature = layerCacheSignature(earlier, width, height)
          if (signature !== undefined && signature === layerCacheSignature(member.layer, width, height)) return member.painted
          recording = true
          try {
            const time = info.time + frames * info.frameDuration
            const recorded = probeCall(() => member.raster
              ? recordAuthorCanvas(member.raster.size, measure, member.raster.setup, ctx => earlier.draw!(textContext(ctx, member.position), time))
              : recordAuthorCanvas({ width, height }, measure, IDENTITY, ctx => drawStill(ctx, earlier, member.position, time)))
            return recorded.balanced ? { recording: recorded, assets: assetSignature(recorded.assets) } : undefined
          } catch (error) {
            if (error instanceof AuthorAssetPending) throw error
            return undefined
          } finally { recording = false; textLayer = undefined }
        }
        const remembered = (member: ExposureMember, slot: string, frames: number): Painted | undefined => {
          const time = info.time + frames * info.frameDuration, tolerance = info.frameDuration * 1e-3
          const list = this.exposureMemo.get(slot) ?? []
          const held = list.find(entry => Math.abs(entry.time - time) < tolerance)
          if (held) return held.painted
          const painted = frames === 0 ? member.painted : recordAt(member, frames)
          if (painted) { list.push({ time, painted, params: frameParams }); if (list.length > EXPOSURE_MEMO_FRAMES) list.shift(); this.exposureMemo.set(slot, list) }
          return painted
        }
        /**
         * 拿哪两帧比。预览时手边有最近录过的就用，隔几帧、倒放都按帧数折算：已经跟不上的时候再多跑作者代码，只会掉更多帧，
         * 下一帧又缺前一帧，播放就再也追不上了。导出和没有邻近帧时（跳帧）按严格的前两帧。
         */
        const historyOf = (member: ExposureMember, slot: string): { previous?: Painted; gap: number; older(): Painted | undefined; olderGap: number } => {
          const near = quality === 'final' ? [] : (this.exposureMemo.get(slot) ?? []).map(entry => ({ painted: entry.painted, gap: (info.time - entry.time) / info.frameDuration }))
            .filter(entry => Math.abs(entry.gap) > 1e-3 && Math.abs(entry.gap) <= EXPOSURE_MEMO_FRAMES).sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))
          if (near[0]) {
            const further = near.find(entry => entry !== near[0] && Math.sign(entry.gap) === Math.sign(near[0].gap))
            return { previous: near[0].painted, gap: near[0].gap, older: () => further?.painted, olderGap: further?.gap ?? near[0].gap * 2 }
          }
          return { previous: remembered(member, slot, AUTHOR_MOTION_HISTORY[0]), gap: 1, older: () => remembered(member, slot, AUTHOR_MOTION_HISTORY[1]), olderGap: 2 }
        }
        /**
         * 比前一帧和这一帧的指令得出每个绘制动作的位移。都是整块平移时按速度图收集，耗时与速度无关；有形状在变形、
         * 动的内容被裁剪，或者混合方式不是普通叠加时，按录制插值出快门内的时刻再累加。
         */
        const exposureFor = (members: readonly ExposureMember[], samplesOnly = false): StillExposure | undefined => {
          if (!drawExposure) return undefined
          const motionStarted = performance.now()
          const reachFrames = Math.max(1, (Math.abs(drawExposure.phase) + drawExposure.shutter) / 360)
          const motions: Array<AuthorPaintMotion | undefined> = [], before: Array<{ painted: Painted; gap: number } | undefined> = []
          let longest = 0, span = 0, pad = 0, deforming = false
          // 按段重放时每段画在空白画布上；组里只要有一层靠前面的内容混合（遮罩、擦除），都得整组一起累加。
          const plain = drawExposure.trailing && members.every(member => member.painted.recording.isolated)
          for (const member of members) {
            const slot = member.slot, policy = authorLayerMotionBlur(member.layer, overrides?.[authorLayerId(member.layer, member.position)], motionBlur, this.apiVersion ?? 0)
            if (!policy.on && !member.painted.recording.textRuns?.some(run => run.motionBlur)) { motions.push(undefined); before.push(undefined); continue }
            touched.add(slot)
            // 参数带关键帧时每帧本来就不同，录制留着才拖得出影；同一时刻参数却变了，是用户改了，之前的录制都作废。
            if (this.exposureMemo.get(slot)?.some(entry => Math.abs(entry.time - info.time) < info.frameDuration * 1e-3 && entry.params !== frameParams)) this.exposureMemo.delete(slot)
            remembered(member, slot, 0)
            const recording = member.painted.recording
            const history = !authorRecordingMeasurable(recording) ? undefined : historyOf(member, slot)
            const previous = history?.previous
            if (!history || !previous || previous === member.painted || sameAuthorCanvasRecording(previous.recording, recording)) { motions.push(undefined); before.push(undefined); continue }
            const motion = authorPaintMotion(recording, previous.recording, history.older()?.recording, drawExposure.fraction, history.gap, history.olderGap, policy)
            if (!motion.moves.size && !motion.deforming) { motions.push(undefined); before.push(undefined); continue }
            motions.push(motion); before.push({ painted: previous, gap: history.gap })
            longest = Math.max(longest, motion.longest); span = Math.max(span, motion.span); pad = Math.max(pad, motion.reach); deforming ||= motion.deforming
          }
          recordVideoEditPreparation('authorMotion', performance.now() - motionStarted)
          if (!before.some(Boolean)) return undefined
          if (deforming || !plain || samplesOnly) {
            const sample = (member: ExposureMember, memberIndex: number, offset: number): Painted | undefined => {
              const previous = before[memberIndex]
              if (!previous) return member.painted
              const recording = authorSampleRecording(previous.painted.recording, member.painted.recording, motions[memberIndex]!, offset, previous.gap)
              return recording ? { recording, assets: member.painted.assets } : undefined
            }
            const matched = members.every((member, memberIndex) => sample(member, memberIndex, 0))
            const cap = quality === 'final' ? drawExposure.max : Math.min(drawExposure.max, matched ? 8 : 4)
            const count = authorDrawSampleCount(Math.max(span, 15), cap)
            recordVideoEditPreparation('authorExposureSamples', count)
            return { pad: pad * reachFrames, samples: Array.from({ length: count }, (_, index) => members.map((member, memberIndex) => {
              const offset = authorDrawSampleOffset(drawExposure, index, count)
              // 前后指令对不上时重跑作者代码。有限长或跳变的动作就不能这样，它们会按完整位移走。
              return { painted: sample(member, memberIndex, offset) ?? (motions[memberIndex]?.scales.size ? member.painted : recordAt(member, offset) ?? member.painted), draw: (ctx: OffscreenCanvasRenderingContext2D) => drawStill(ctx, member.layer, member.position) }
            })) }
          }
          if (longest < 1) return undefined
          // 段落跨多层时按层顺序连起来切段；每段记着每层要画哪些动作。
          const STEP = 1e7, all = { moves: new Map<number, readonly [number, number]>(), paints: [] as number[] }
          members.forEach((member, memberIndex) => {
            for (const [index, op] of member.painted.recording.ops.entries()) if (AUTHOR_PAINT_OPS.has(op[0] as string)) {
              const id = memberIndex * STEP + index, move = motions[memberIndex]?.moves.get(index)
              all.paints.push(id)
              if (move) all.moves.set(id, move)
            }
          })
          const runs = authorMotionRuns(all, MAX_EXPOSURE_RUNS).map(run => {
            const paints = new Map<number, Set<number>>()
            for (const id of run.paints) { const part = Math.floor(id / STEP); let set = paints.get(part); if (!set) paints.set(part, set = new Set()); set.add(id - part * STEP) }
            return { moving: run.moving, paints }
          })
          return { pad: pad * reachFrames, gather: { motions, longest, runs } }
        }
      const stillRun = async (start: number, end: number): Promise<void> => {
        const run = `flat:${start}:${end}`, frame = { width, height }, full = { x: 0, y: 0, width, height }
        const stills: Array<ExposureMember & { volatile: boolean; video: boolean }> = []
        if (!this.combinedRuns.has(run)) {
          for (let position = start; position < end; position++) {
            const still = list[position]
            const recorded = record(`still:${position}:${authorLayerId(still, position)}`, frame, IDENTITY, ctx => drawStill(ctx, still, position), layerCacheSignature(still, width, height))
            const painted = recorded.painted
            // 录制不了，或 save/restore 不成对（状态与裁剪会漏给后面的层）：这一段整组画在一张画布上。
            if (!painted?.recording.balanced) { this.combinedRuns.add(run); break }
            stills.push({ position, layer: still, painted, slot: `still:${position}:${authorLayerId(still, position)}`, volatile: recorded.volatile, video: recorded.video })
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
          await stillGroup(`flat:${members[0].position}:${members.at(-1)!.position + 1}`, members[0].position * 2, members.map(member => ({ painted: member.painted, draw: ctx => drawStill(ctx, member.layer, member.position) })), crop, members.length, video, exposureFor(members))
        }
      }
      await this.layers.begin(undefined, typeof initialTarget === 'function' ? inputs?.current?.format : initialTarget.format)
      this.layerEffects?.begin(this.layers.commandEncoder())
      for (let index = 0; index < list.length; index++) {
        const id = authorLayerId(list[index], index), override = overrides && Object.hasOwn(overrides, id) ? overrides[id] : undefined
        const hasEffects = (this.apiVersion ?? CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION) >= CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION && list[index].effects !== undefined
        const layer = (authorOverrideMovesLayer(override, this.apiVersion ?? 0) || hasEffects) && !list[index].pose ? { ...list[index], bounds: list[index].bounds ?? [0, 0, width, height] as [number, number, number, number], pose: () => ({}) } : list[index]
        try {
          if (isAuthorAdjustment(layer, this.apiVersion ?? CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION)) {
            assertCodeElementOverrideAllowed('adjust', override)
            const resolved = resolveAuthorElementEffects(authorCall(() => layer.adjust!(info.time)), override, environment, info.clip.time / info.frameDuration, id, 'frame', this.apiVersion)
            const effects = resolved.effects; effectStates.set(index, resolved.states)
            evaluated.set(index, effects)
            const pose: import('./videoEditAuthorModule').AuthorPose | null = layer.pose ? authorCall(() => layer.pose!(info.time)) : {}
            const opacity = Math.max(0, Math.min(1, (pose?.opacity ?? 1) * (override?.opacity ?? 1)))
            if (!Number.isFinite(opacity)) throw new Error('调整层 opacity 必须是有限数值。')
            if (!pose || override?.hidden || opacity <= 0 || !effects.length) continue
            const rect = layer.clip ?? [0, 0, width, height]
            if (rect.length !== 4 || !rect.every(Number.isFinite) || rect[2] < rect[0] || rect[3] < rect[1]) throw new Error('调整层 clip 范围无效。')
            const clip: [number, number, number, number] = [Math.max(0, Math.ceil(rect[0] * sx - .5)), Math.max(0, Math.ceil(rect[1] * sy - .5)), Math.min(outWidth, Math.floor(rect[2] * sx - .5) + 1), Math.min(outHeight, Math.floor(rect[3] * sy - .5) + 1)]
            if (clip[2] <= clip[0] || clip[3] <= clip[1]) continue
            const needsFloat = effects.some(effect => videoEditEffectNeedsFloat(effect, { width: outWidth, height: outHeight, referenceSize: { width, height }, renderScale: sx }))
            if (needsFloat) await promoteStack()
            const input = stackTarget()
            if (!this.layerEffects) { this.layerEffects = new VideoEditAuthorEffects(this.device, this.effectAllocator); this.layerEffects.begin(this.layers.commandEncoder()) }
            const result = await this.layerEffects.encode(`adjust:${index}:${id}`, input, outWidth, outHeight, effects,
              { referenceSize: { width, height }, contentBounds: { x: 0, y: 0, width, height }, rasterScale: sx, rasterOrigin: [0, 0], quality }, environment,
              undefined, { radius: 0, lens: false }, () => {}, authorFramePosition(this.effect, info), info.frameDuration, needsFloat, { opacity })
            this.layers.copy(result.picture, input, outWidth, outHeight, clip)
            carriesLight ||= result.carriesLight
            hasContent = true
            continue
          }
          if (typeof layer.draw !== 'function') throw new Error('缺少 draw(ctx,t)。')
          // Frameflow batches adjacent untransformed layers onto one canvas.
          // This also preserves Canvas compositing between those layers.
          if (!layer.pose) {
            let end = index
            while (end < list.length && !isAuthorAdjustment(list[end], this.apiVersion ?? CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION) && !list[end].pose && ((this.apiVersion ?? CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION) < CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION || list[end].effects === undefined) && !(overrides && Object.hasOwn(overrides, authorLayerId(list[end], end)) && authorOverrideMovesLayer(overrides[authorLayerId(list[end], end)], this.apiVersion ?? 0))) end++
            await stillRun(index, end)
            index = end - 1
            continue
          }
          if (!layer.bounds) throw new Error('运动层需要 bounds:[x0,y0,x1,y1]。')
          const [x, y, right, bottom] = layer.bounds ?? [0, 0, width, height]
          if (![x, y, right, bottom].every(Number.isFinite) || right <= x || bottom <= y) throw new Error('图层范围无效。')
          const bounds = { x, y, width: right - x, height: bottom - y }
          const samples = authorLayerSamples(layer, this.effect, info, bounds, override, motionBlur, this.apiVersion ?? 0)
          if (!samples.some(sample => sample.pose)) continue
          const center = layer.pose?.(info.time) ?? samples.map(sample => layer.pose?.(info.time + sample.offset.numerator / sample.offset.denominator * info.frameDuration)).find(Boolean)
          const need = Math.max(1, ...samples.flatMap(sample => sample.pose ? [Math.hypot(sample.pose.matrix[0], sample.pose.matrix[1]), Math.hypot(sample.pose.matrix[2], sample.pose.matrix[3])] : []))
          if (hasEffects && typeof layer.effects !== 'function') throw new Error('effects 必须是函数。')
          const resolved = resolveAuthorElementEffects(hasEffects ? authorCall(() => layer.effects!(info.time)) : [], override, environment, info.clip.time / info.frameDuration, id, 'layer', this.apiVersion ?? CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION)
          const effects = resolved.effects; effectStates.set(index, resolved.states)
          evaluated.set(index, effects)
          const reference = (rasterScale: number, pad = 0): LayerEffectReference => ({ referenceSize: { width, height }, contentBounds: bounds, rasterScale, rasterOrigin: [pad, pad], quality })
          const paddingByScale = new Map<number, number>()
          const padding = (rasterScale: number): number => {
            const cached = paddingByScale.get(rasterScale)
            if (cached !== undefined) return cached
            const blur = authorLayerBlur(center, rasterScale, layer.blurShape)
            if (!effects.length && blur.radius === 0) return hasEffects ? Math.max(16, blur.pad) : blur.pad
            const bleed = authorEffectBleed(effects, reference(rasterScale)) * height * rasterScale
            const defocusPad = blur.radius > 0 ? layer.blurShape === 'lens' ? blur.radius * 1.5 : gaussianSupport(blur.radius, Math.ceil(bounds.width * rasterScale), Math.ceil(bounds.height * rasterScale), 'final') : 0
            const required = bleed + Math.max(blur.pad, defocusPad) + 2
            const pad = effects.length || hasEffects ? required <= 16 ? 16 : Math.ceil(required / 64) * 64 : Math.max(blur.pad, 2 ** Math.ceil(Math.log2(Math.max(1, defocusPad + 2))))
            paddingByScale.set(rasterScale, pad)
            return pad
          }
          const textureLimit = (this.device as GpuDevice & { limits?: Record<string, number> }).limits?.maxTextureDimension2D ?? 8192
          const limit = Math.min(textureLimit / Math.max(bounds.width, bounds.height), Math.sqrt(16e6 / Math.max(1, bounds.width * bounds.height)))
          const slot = `layer:${index}:${id}`
          let fullResolution = authorRasterScale(need, limit, this.liveLayers.has(slot) || isAuthorAnalyticLayer(layer))
          while (Math.ceil(Math.max(bounds.width, bounds.height) * fullResolution) + 2 * padding(fullResolution) > textureLimit) {
            fullResolution /= 2
            if (!(fullResolution > 0) || !Number.isFinite(padding(fullResolution))) throw new Error('图层效果外扩超出设备纹理尺寸。')
          }
          const fullPad = padding(fullResolution)
          const draw = (ctx: OffscreenCanvasRenderingContext2D): void => layer.draw!(textContext(ctx, index), info.time)
          const recorded = record(slot, { width: Math.ceil(bounds.width * fullResolution) + fullPad * 2, height: Math.ceil(bounds.height * fullResolution) + fullPad * 2 }, [fullResolution, 0, 0, fullResolution, fullPad - x * fullResolution, fullPad - y * fullResolution], draw, layerCacheSignature(layer, width, height))
          if (recorded.video) { this.liveLayers.add(slot); statistics.video++ } else this.liveLayers.delete(slot)
          // 回放分辨率降低时栅格跟着缩小，阴影与滤镜同比换算；画法换算不了的层（直接绘制、读画布、认不出的滤镜）照原分辨率栅格。
          const shrink = scale ? Math.max(sx, sy) : 1
          const reduced = shrink < 1 && !!recorded.painted && contentOf([recorded.painted]).scalable
          const resolution = reduced ? fullResolution * shrink : fullResolution
          const { radius } = authorLayerBlur(center, resolution, layer.blurShape)
          const needsFloat = authorLayerBlur(center, 1, layer.blurShape).radius > 0 || effects.some(effect => videoEditEffectNeedsFloat(effect, { width, height, referenceSize: { width, height }, renderScale: 1, layer: reference(1) }))
          const pad = padding(resolution)
          // 报给助手的是“模糊”效果的等效参数：均匀方式的标准差就是 pose.blur 的像素值，镜头方式的圆盘半径是它的两倍标准差。
          if (radius > 0) evaluated.set(index, [...effects, ...resolveAuthorEffects([{ id: 'blur', params: { mode: layer.blurShape === 'lens' ? 'lens' : 'uniform', repeat_edges: false, amount: Math.min(BLUR_AMOUNT_MAX, blurAmountForSigma(radius / resolution / height / (layer.blurShape === 'lens' ? 2 : 1))) } }]).map(effect => ({ ...effect, source: 'pose.blur' as const }))])
          const surface = this.surface(index * 2, Math.ceil(bounds.width * resolution) + pad * 2, Math.ceil(bounds.height * resolution) + pad * 2, true)
          const canvas = surface.canvas!, region = { x: 0, y: 0, width: canvas.width, height: canvas.height }
          const setup: Matrix = [resolution, 0, 0, resolution, pad - x * resolution, pad - y * resolution]
          const content = recorded.painted && { key: `${slot}\u0000${canvas.width}x${canvas.height}\u0000${setup.join(',')}`, parts: [recorded.painted] }
          // 带位姿、效果或覆盖的层里 draw 自己也可能在动：位姿的模糊管不到这部分，按录制累加。
          const inner = drawExposure && recorded.painted ? exposureFor([{ position: index, layer: list[index], painted: recorded.painted, slot, raster: { size: { width: Math.ceil(bounds.width * fullResolution) + fullPad * 2, height: Math.ceil(bounds.height * fullResolution) + fullPad * 2 }, setup: [fullResolution, 0, 0, fullResolution, fullPad - x * fullResolution, fullPad - y * fullResolution] } }], true) : undefined
          const changed = !!inner || !content || !sameContent(surface.content, content)
          let finished: OffscreenCanvas = canvas
          if (changed) {
            changedSurfaces.add(surface)
            surface.content = undefined
            if (inner?.samples) finished = await accumulate(canvas, canvas.width, canvas.height, setup, inner.samples, reduced ? { sx: shrink, sy: shrink } : undefined)
            else await paint(canvas, setup, [{ painted: recorded.painted, draw }], reduced ? { sx: shrink, sy: shrink } : undefined)
            surface.content = content && !inner && recorded.painted!.recording.comparable ? content : undefined
            if (recorded.painted) statistics.redrawn++; else statistics.direct++
          } else { statistics.reused++; recordVideoEditPreparation('authorRasterReused', 0) }
          const uploadStarted = performance.now()
          if (changed) {
            upload(finished, surface.texture, region)
            this.layers.mipmaps(surface.texture, canvas.width, canvas.height)
            this.sourceVersions.set(slot, (this.sourceVersions.get(slot) ?? 0) + 1)
          }
          recordVideoEditPreparation('authorUpload', performance.now() - uploadStarted)
          if (samples.some(sample => sample.pose && sample.pose.opacity > 0) && target?.format !== 'rgba16float' &&
            needsFloat) {
            await promoteStack()
          }
          let result = { picture: surface.texture, carriesLight: false }
          if (effects.length || radius > 0) {
            if (!this.layerEffects) { this.layerEffects = new VideoEditAuthorEffects(this.device, this.effectAllocator); this.layerEffects.begin(this.layers.commandEncoder()) }
            result = await this.layerEffects.encode(slot, surface.texture, canvas.width, canvas.height, effects, reference(resolution, pad), environment,
              surface.content ? `${this.sourceVersions.get(slot)}:${surface.content.key}` : undefined, { radius, lens: layer.blurShape === 'lens' }, texture => this.layers.mipmaps(texture, canvas.width, canvas.height), authorFramePosition(this.effect, info), info.frameDuration, needsFloat)
          }
          const poses = samples.map(sample => {
            if (!sample.pose) return sample
            const m = sample.pose.matrix, ox = x - pad / resolution, oy = y - pad / resolution
            const matrix: CodeMatrix = [m[0] / resolution, m[1] / resolution, m[2] / resolution, m[3] / resolution, m[4] + m[0] * ox + m[2] * oy, m[5] + m[1] * ox + m[3] * oy]
            return { ...sample, pose: { ...sample.pose, matrix } }
          })
          hasContent = this.layers.draw(stackTarget, outWidth, outHeight, { texture: result.picture, x: 0, y: 0, width: canvas.width, height: canvas.height }, poses, layer.clip, scale) || hasContent
          carriesLight ||= (this.apiVersion ?? CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION) >= CODE_AUTHOR_LAYER_EFFECTS_MIN_API_VERSION && result.carriesLight
        } catch (cause) {
          if (cause instanceof AuthorAssetPending || cause instanceof Error && cause.name === 'AbortError') throw cause
          throw new Error(`第 ${index + 1} 层${layer.name ? `「${layer.name}」` : ''}：${cause instanceof Error ? cause.message : String(cause)}`, { cause })
        }
      }
      stackTarget()
      beforeCommit()
      this.layers.finish()
      this.layerEffects?.commit()
      this.settleExposureTextures(usedExposure)
      if (drawExposure) for (const slot of this.exposureMemo.keys()) if (!touched.has(slot)) this.exposureMemo.delete(slot)
      this.renderedTarget = target
      this.history = history
      this.lastFrame = { carriesLight, effects: evaluated, effectStates, layers: list, width, height, time: info.time, parameters: params, overrides, directText, textUncovered, textLayouts }
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
          this.layers.abandon(); this.layerEffects?.abandon()
          // 上传直接进入队列，mip 随本批编码器丢弃；重试必须重建这些表面的完整内容。
          for (const surface of changedSurfaces) surface.content = undefined
          changedSurfaces.clear()
        }
      }
    } catch (cause) {
      this.layers.abandon(); this.layerEffects?.abandon()
      // 上传已执行，但 mip 工序可能随弃帧丢弃；仅这些纹理需要重新上传。
      for (const surface of changedSurfaces) surface.content = undefined
      if (cause instanceof Error && cause.name === 'AbortError') throw cause
      throw new Error(`代码效果「${this.effect.name}」在 ${info.time} 秒执行失败：${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    } finally {
      frameImages.forEach(image => image.close())
    }
  }
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.renders
    this.lastFrame = undefined
    const errors: unknown[] = []
    await this.renders
    this.exposureGpu?.dispose(); this.exposureGpu = undefined
    this.exposureMemo.clear(); this.exposureTextures.clear()
    if (this.exposureTarget) this.exposureTarget.width = this.exposureTarget.height = 1
    await this.simulation?.dispose().catch(error => { errors.push(error) })
    this.simulation = undefined
    this.lastFrame = undefined
    const release = async (action: () => unknown): Promise<void> => {
      try { await action() } catch (error) { errors.push(error) }
    }
    await release(() => this.webgl?.dispose?.())
    await release(() => this.webgpu?.dispose?.())
    await release(() => this.three?.dispose())
    if (this.ownsModule) await release(() => this.effect.dispose?.())
    await release(() => this.layerGpu?.dispose())
    await release(() => this.layerEffects?.dispose())
    if (this.promotedTarget) await release(() => this.effectAllocator.release(this.promotedTarget!.texture))
    this.promotedTarget = undefined; this.renderedTarget = undefined
    for (const texture of this.textures) await release(() => this.releaseTexture(texture))
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
