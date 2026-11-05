import type * as Three from 'three'
import type { AuthorLibraryVersions } from '@/core/videoEdit/codeMaterial/authorLibraries'
import type { ManagedThreeRenderer } from './videoEditAuthorThreeWebGpu'
import { loadAuthorThreeDependent, loadAuthorThreeModule } from './videoEditAuthorThreeWebGpu'
import { guardVideoEditThree } from './videoEditThreePipelineProbe'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createLogger } from '@/core/logging'
import { videoEditToneMapping } from './videoEditToneMapping'
import type { VideoEditSpaceToneMapping } from '@/core/videoEdit/document'
import { videoEditDenoiserWeightsUrl } from './videoEditDenoiserWeights'

const logger = createLogger('features.videoEdit.space')

/**
 * 统一三维渲染器的路径追踪（three-gpu-pathtracer）：与实时渲染同一个 three 场景，按帧累积采样。
 *
 * - 同一画面（宿主给的 key 与输出尺寸都不变）连续调用时接着累积，换帧、改动或改尺寸后从头开始；每次调用在时间预算内追踪，
 *   没到目标采样数时返回 refining，节目监视器据此再要一次同一帧。
 * - 宿主用补丁版追踪库（HOST_PATH_TRACER_VERSION）：贴图图集是半精度，暗部渐变与发光衰减不出台阶。
 * - 卡片画面是预乘、2.4 伽马编码的宿主纹理，追踪器的贴图图集只认普通贴图：先解码成线性、非预乘的渲染目标，
 *   作为只发光不反光的材质（透明度取覆盖率）；发光画面的覆盖率取覆盖与亮度较大者，乘回来仍是原来的发光。
 * - 环境光要逐像素有数据的等距柱状图：PMREM、立方体与贴图环境都先在 GPU 上展开再读回（按贴图版本缓存）。
 * - 景深按相机的光学参数换成光圈直径（与实时景深同一弥散公式）；路径追踪不做运动模糊。
 * - 追踪结果是线性预乘颜色，输出前与实时一样做泛光、中性色调映射与 2.4 伽马编码。
 * - 平面卡片是 matte：相机直接看不见（那里输出透明，半透明处按覆盖率穿透），但照亮周围、出现在反射与折射里；
 *   卡片本身由宿主用实时渲染画好叠上来（与实时、二维逐像素一致），见 VideoEditThreeSpace 的混合合成。
 */

interface TslNode {
  mul(value: unknown): TslNode; div(value: unknown): TslNode; add(value: unknown): TslNode; sub(value: unknown): TslNode
  greaterThan(value: unknown): TslNode; lessThan(value: unknown): TslNode; sample(uv: unknown): TslNode
  readonly x: TslNode; readonly y: TslNode; readonly xy: TslNode; readonly rgb: TslNode; readonly a: TslNode; readonly r: TslNode; readonly g: TslNode; readonly b: TslNode
}
type TslFn = (...args: unknown[]) => TslNode
interface Tsl {
  uniform: TslFn; texture: TslFn; textureLoad: TslFn; cubeTexture: TslFn; pmremTexture: TslFn; equirectUV: TslFn
  vec3: TslFn; vec4: TslFn; ivec2: TslFn; uv: TslFn; select: TslFn; pow: TslFn; max: TslFn; min: TslFn; sqrt: TslFn; float: TslFn; clamp: TslFn; cos: TslFn; sin: TslFn; neutralToneMapping: TslFn; agxToneMapping: TslFn; acesFilmicToneMapping: TslFn
  rtt: TslFn
  screenCoordinate: TslNode
}
interface NodeMaterial extends Three.Material { colorNode: unknown }
interface QuadMesh { material: NodeMaterial; render(renderer: unknown): void }
/** three 的渲染到纹理节点：width 为空时跟随渲染器画布尺寸，设了就固定。 */
interface SizedTexture { width: number | null; height: number | null; setSize(width: number, height: number): void }
interface RenderPipeline { outputNode: TslNode; outputColorTransform: boolean; render(): void; dispose(): void }
type Library = typeof Three & {
  RenderPipeline: new (renderer: unknown) => RenderPipeline
  MeshBasicNodeMaterial: new (parameters?: Record<string, unknown>) => NodeMaterial
  QuadMesh: new (material: NodeMaterial) => QuadMesh
}
interface Renderer extends ManagedThreeRenderer {
  getRenderTarget(): Three.RenderTarget | null
  readRenderTargetPixelsAsync(target: Three.RenderTarget, x: number, y: number, width: number, height: number): Promise<ArrayLike<number>>
}
interface Tracer {
  frameBudget: number; renderDelay: number; fadeDuration: number; minSamples: number; dynamicLowRes: boolean; synchronizeRenderSize: boolean
  maxBounces: number; maxSamples: number; transmissiveBackground: number; target: Three.Texture | null
  setSize(width: number, height: number): void
  setScene(scene: Three.Scene, camera: Three.Camera): void
  renderSample(): void
  getSampleCountsAsync(): Promise<{ min: number }>
  dispose(): void
}
interface PathTraceModule {
  WebGPUPathTracer: new (renderer: unknown) => Tracer
  TRANSMISSIVE_BACKGROUND_TRANSPARENT: number
  PhysicalCamera: new (fov: number, aspect: number, near: number, far: number) => Three.PerspectiveCamera & { focusDistance: number; bokehSize: number; apertureBlades: number }
}
interface DenoiseModule {
  OIDNDenoiser: new (options: { initUNetFromURL: (url: string, backend: unknown, options: unknown) => Promise<unknown>; auxWeightsUrl: string }) => Denoiser
}
/** 追踪库自带的 OIDN 降噪封装：按反照率与法线引导、分块执行，结果是线性 HDR 纹理（逐块从原图换成降噪图）。 */
interface Denoiser {
  readonly texture: Three.Texture | null
  readonly complete: boolean
  readonly running: boolean
  /** 上一次降噪失败的原因（补丁版封装提供）；失败后 running 复位为 false。 */
  readonly error: unknown
  init(renderer: unknown): void
  setScene(scene: Three.Scene, camera: Three.Camera): void
  update(color: Three.Texture): Three.Texture | null
  reset(): void
  dispose(): void
}

/** `solid`：实体卡片（受光、有厚度）按真实物体追踪——画面作底色贴图、不是 matte，参数取它的表面材质。 */
export interface PathTraceCard { mesh: Three.Mesh; texture: Three.Texture; width: number; height: number; opacity: number; light: boolean; emission: number; solid?: { roughness: number; metalness: number } }
export interface PathTraceFrame {
  /**
   * 画面身份：相同时接着累积；缺省时每次从头追踪。宿主只在这一帧的输入都是精确画面时给出，
   * 同一身份下场景内容不变（作者场景按宿主时钟确定性求值）。
   */
  key?: string
  scene: Three.Scene
  camera: Three.PerspectiveCamera
  cards: readonly PathTraceCard[]
  /** 光圈直径（世界单位）与对焦距离；直径 0 为全清晰。 */
  aperture: number
  focusDistance: number
  /** 每像素目标采样数。 */
  samples: number
  /** 本次调用最多追踪多久（毫秒）；缺省追踪到目标采样数为止。 */
  budgetMs?: number
  /** 曝光倍数（2^EV）与色调映射：与实时相同，只作用于追踪出的三维物体（卡片在追踪里不可见）。 */
  exposure: number
  toneMapping: VideoEditSpaceToneMapping
  /** 泛光（与实时同一个 three 泛光节点，在色调映射前的线性画面上）；缺省不做。 */
  glow?: { strength: number; radius: number; threshold: number }
  /** 组画面是否带发光：决定输出的编码约定（与实时渲染相同）。 */
  light: boolean
  /** 追踪结果的去处：线性预乘、半精度，与实时渲染的中间目标相同。 */
  target: Three.RenderTarget
  assertCurrent(): void
}

/**
 * 看片时第一次降噪的采样数：这时已能看清大致光影，降噪后先给一张干净的画面；到目标采样数再降噪一次。
 * 成片只在目标采样数时降噪一次。
 */
const FIRST_DENOISE_SAMPLES = 32

const HOST_PATH_TRACER_VERSION = '0.0.27-henji.1'

/** 展开环境图的分辨率：环境光按亮度做重要性采样，用不着更细。 */
const ENVIRONMENT_WIDTH = 1024
/** 每读回一次采样数之间提交的采样批数；有时间预算（看片）时每批只提交一次，一批就要几百毫秒，提交多了会占住显卡、拖慢界面。 */
const SAMPLE_BATCH = 4

export class VideoEditThreeSpacePathTrace {
  private key?: string
  private width = 0
  private height = 0
  /** 当前累积里最少的那个像素已有的采样数。 */
  private samples = 0
  private notedNodeEffects = false
  private readonly glowPipelines = new Map<string, { pipeline: RenderPipeline; strength: TslNode & { value: number }; halo: { radius: { value: number }; threshold: { value: number } }; source: SizedTexture; nodes: Array<{ dispose(): void }> }>()
  private denoiser?: Denoiser
  /** 降噪失败（权重读不到、显卡不支持、分块执行出错）：这个追踪器之后不再降噪。 */
  private denoiseFailed = false
  /** 正在降噪或已降噪的那一次对应的采样数。 */
  private denoisedSamples = 0
  private denoiseStartedAt?: number
  /** 重新降噪期间显示的上一张降噪图。 */
  private keptTarget?: Three.RenderTarget
  private kept = false
  private readonly cardTargets = new Map<Three.Mesh, { target: Three.RenderTarget; material: Three.MeshPhysicalMaterial; solid: boolean; side?: Three.MeshPhysicalMaterial }>()
  /** 展开过的环境图，按来源贴图；只留最近几张（换环境的作品很少）。 */
  private readonly environments = new Map<Three.Texture, { version: number; key?: string; texture: Three.DataTexture }>()
  private readonly decode: QuadMesh
  private readonly decodeSource: TslNode & { value: Three.Texture }
  private readonly decodeLight: TslNode & { value: number }
  /** 按色调映射各一个编码四边形（曝光是 uniform）。 */
  private readonly encodes = new Map<PathTraceFrame['toneMapping'], QuadMesh>()
  private readonly exposure: TslNode & { value: number }
  private readonly encodeSource: TslNode & { value: Three.Texture }
  private readonly encodeLight: TslNode & { value: number }
  private readonly camera: InstanceType<PathTraceModule['PhysicalCamera']>

  private constructor(private readonly library: Library, private readonly tsl: Tsl, private readonly renderer: Renderer, private readonly tracer: Tracer, module: PathTraceModule, private readonly libraries?: AuthorLibraryVersions) {
    tracer.renderDelay = 0; tracer.fadeDuration = 0; tracer.minSamples = 0; tracer.dynamicLowRes = false; tracer.synchronizeRenderSize = false
    // 三维组画面要透明地叠回二维合成：穿过半透明卡片、玻璃看到的“背景”是透明，而不是按环境光染色的不透明底。
    tracer.transmissiveBackground = module.TRANSMISSIVE_BACKGROUND_TRANSPARENT
    this.camera = new module.PhysicalCamera(45, 1, .1, 100)
    this.camera.apertureBlades = 0
    // 卡片解码：预乘 2.4 伽马 → 线性非预乘。
    this.decodeSource = tsl.texture(new library.Texture()) as TslNode & { value: Three.Texture }
    this.decodeLight = tsl.uniform(0) as TslNode & { value: number }
    const source = this.decodeSource, light = this.decodeLight.greaterThan(.5)
    // 覆盖率（追踪里挡住身后物体的程度）一律取画面自身的透明度，与实时卡片那一层一致；发光画面按预乘逐通道解码，
    // 光晕处透明度近 0、几乎不会被打中：发光卡片照亮周围、出现在反射里的只有字芯，光晕那部分光略去（除数下限免得零星打中时亮成噪点）。
    const premultiplied = tsl.pow(tsl.max(source.rgb, tsl.vec3(0)), tsl.vec3(2.4))
    const coverage = source.a
    const straight = tsl.select(light, premultiplied.div(tsl.max(source.a, .05)), tsl.pow(tsl.max(source.rgb.div(tsl.max(source.a, 1e-5)), tsl.vec3(0)), tsl.vec3(2.4)))
    const decodeMaterial = new library.MeshBasicNodeMaterial({ blending: library.NoBlending, toneMapped: false, depthTest: false, depthWrite: false })
    decodeMaterial.colorNode = tsl.vec4(tsl.select(coverage.greaterThan(1e-5), straight, tsl.vec3(0)), tsl.clamp(coverage, 0, 1))
    this.decode = new library.QuadMesh(decodeMaterial)
    // 追踪结果按行自上而下存放、是不可过滤的单精度纹理：按像素读取，与实时渲染一样做色调映射与编码（保持预乘）。
    this.encodeSource = tsl.texture(new library.Texture()) as TslNode & { value: Three.Texture }
    this.encodeLight = tsl.uniform(0) as TslNode & { value: number }
    this.exposure = tsl.uniform(1) as TslNode & { value: number }
  }

  /** 追踪结果按行自上而下存放、是不可过滤的单精度纹理：按像素读取。 */
  private encodeTexel(): TslNode {
    const { tsl } = this
    // 全透明处颜色清零：降噪会让透明背景与 matte 处带上一点颜色，编码时它会被当作加性的光叠上去。
    const texel = tsl.textureLoad(this.encodeSource, tsl.ivec2(tsl.screenCoordinate.xy))
    return tsl.select(texel.a.greaterThan(0), texel, tsl.vec4(0, 0, 0, 0))
  }

  /** 与实时渲染相同的色调映射与编码（保持预乘）：组画面带发光时按预乘逐通道，否则解预乘编码再乘回透明度。 */
  private encoded(color: TslNode, toneMapping: PathTraceFrame['toneMapping']): TslNode {
    const { tsl } = this
    const tone = videoEditToneMapping(tsl, toneMapping)
    const alpha = tsl.clamp(color.a, 0, 1)
    const covered = color.a.greaterThan(1e-5)
    const mapped = tone(tsl.select(covered, color.rgb.div(color.a), color.rgb), this.exposure)
    const encoded = tsl.pow(tsl.max(mapped, tsl.vec3(0)), tsl.vec3(1 / 2.4))
    const lightEncoded = tsl.pow(tsl.max(tone(color.rgb, this.exposure), tsl.vec3(0)), tsl.vec3(1 / 2.4))
    return tsl.vec4(tsl.select(this.encodeLight.greaterThan(.5), lightEncoded, tsl.select(covered, encoded.mul(alpha), encoded)), alpha)
  }

  private encodeQuad(toneMapping: PathTraceFrame['toneMapping']): QuadMesh {
    let quad = this.encodes.get(toneMapping)
    if (!quad) {
      const { library } = this
      const material = new library.MeshBasicNodeMaterial({ blending: library.NoBlending, toneMapped: false, depthTest: false, depthWrite: false })
      material.colorNode = this.encoded(this.encodeTexel(), toneMapping)
      quad = new library.QuadMesh(material)
      this.encodes.set(toneMapping, quad)
    }
    return quad
  }

  /** 带泛光的编码：结果先拷成可过滤的半精度图（泛光按线性过滤采样），加上泛光再编码。按色调映射各建一套，强度、半径与阈值是 uniform（可调，不随值多建）。 */
  private async glowPipeline(glow: NonNullable<PathTraceFrame['glow']>, toneMapping: PathTraceFrame['toneMapping'], width: number, height: number): Promise<RenderPipeline> {
    const key = toneMapping
    let entry = this.glowPipelines.get(key)
    if (!entry) {
      const { tsl, library } = this
      const { bloom } = await loadAuthorThreeModule<{ bloom: TslFn }>('three/addons/tsl/display/BloomNode.js', this.libraries)
      const strength = tsl.uniform(0) as TslNode & { value: number }
      // 显式渲染成纹理：按像素读取的节点本身算作纹理节点，convertToTexture 会原样返回它，泛光就会去采样不可过滤的单精度图。
      const source = tsl.rtt(this.encodeTexel(), width, height)
      const halo = bloom(source, strength, glow.radius, glow.threshold) as TslNode & { radius: { value: number }; threshold: { value: number } }
      const pipeline = new library.RenderPipeline(this.renderer)
      // 辉光落在透明处时是透明度为 0 的发光，与实时相同。
      pipeline.outputNode = this.encoded(tsl.vec4(source.rgb.add(halo.rgb), source.a), toneMapping)
      pipeline.outputColorTransform = false
      entry = { pipeline, strength, halo, source: source as unknown as SizedTexture, nodes: [source, halo] as unknown as Array<{ dispose(): void }> }
      this.glowPipelines.set(key, entry)
    }
    entry.strength.value = glow.strength
    entry.halo.radius.value = glow.radius; entry.halo.threshold.value = glow.threshold
    // 中间图固定为本帧输出尺寸：跟随渲染器画布尺寸时，与输出尺寸不同就会按屏幕坐标读错位置。
    if (entry.source.width !== width || entry.source.height !== height) { entry.source.width = width; entry.source.height = height; entry.source.setSize(width, height) }
    return entry.pipeline
  }

  static async create(library: Library, tsl: Tsl, renderer: Renderer, libraries?: AuthorLibraryVersions): Promise<VideoEditThreeSpacePathTrace> {
    // 宿主用补丁版（贴图图集半精度、matte 按覆盖率）；作者代码里固定的 0.0.27 不受影响。
    const host = { ...libraries, 'three-gpu-pathtracer': HOST_PATH_TRACER_VERSION }
    const module = await loadAuthorThreeDependent<PathTraceModule>('three-gpu-pathtracer/webgpu', host)
    return new VideoEditThreeSpacePathTrace(library, tsl, renderer, new module.WebGPUPathTracer(renderer), module, host)
  }

  /** 追踪一批采样写进 frame.target；返回是否还没到目标采样数。 */
  /** 当前画面每个像素都至少追踪过一次（采样数取全幅最少处）；之前输出里没追到的块是黑的。 */
  get covered(): boolean { return this.samples >= 1 }

  /** 当前画面追踪到了目标的几成（0–1，最后一次降噪做完才算 1）。 */
  progress(target: number): number { return Math.min(1, this.samples / Math.max(1, target)) * (this.denoiser?.running || (videoEditDenoiserWeightsUrl() && !this.denoiseFailed && this.denoisedSamples < target) ? .99 : 1) }

  /** 这一画面（同一 key 与尺寸）是否已在累积：看片换到新画面时，先交实时画面，下一次再开始追踪。 */
  accumulating(key: string | undefined, width: number, height: number): boolean { return key !== undefined && key === this.key && width === this.width && height === this.height }

  async render(frame: PathTraceFrame): Promise<boolean> {
    const { renderer, tracer } = this
    const { width, height } = frame.target
    const previous = renderer.getRenderTarget()
    const device = (renderer as unknown as { backend: { device: GpuDevice } }).backend.device
    const restores: Array<() => void> = []
    try {
      this.applyCards(frame.cards, restores)
      await this.applyEnvironment(frame.scene, frame.key, restores)
      frame.assertCurrent()
      if (frame.key === undefined || frame.key !== this.key || width !== this.width || height !== this.height) {
        this.syncCamera(frame)
        tracer.setSize(width, height)
        tracer.setScene(frame.scene, this.camera)
        this.noteNodeEffects(frame.scene)
        this.key = frame.key; this.width = width; this.height = height
        this.samples = 0
        this.denoiser?.reset(); this.denoisedSamples = 0; this.kept = false
      }
      tracer.maxSamples = frame.samples
      // 追踪器每次采样后把结果画到当前渲染目标：指向本帧目标，随后再被编码结果覆盖。
      renderer.setRenderTarget(frame.target)
      const started = performance.now(), batch = frame.budgetMs === undefined ? SAMPLE_BATCH : 1
      // 降噪分块读取当前累积结果，读完之前不再累积，否则各块取到的采样数不同。
      while (this.samples < frame.samples && !this.denoiser?.running) {
        await guardVideoEditThree(renderer, device, '路径追踪', () => { for (let i = 0; i < batch; i++) tracer.renderSample() })
        // 读回采样数要等显卡做完这一批：排队的显卡工作每次只有一小批（不会一下排进几秒的计算触发显卡超时），也能及时取消。
        // 波前追踪每次只推进一次弹射，采样数只能按追踪器自己的统计。
        this.samples = (await tracer.getSampleCountsAsync()).min
        frame.assertCurrent()
        if (frame.budgetMs !== undefined && performance.now() - started >= frame.budgetMs) break
      }
      const raw = tracer.target
      if (!raw) throw new Error('路径追踪没有输出画面。')
      const denoised = await this.denoise(frame, raw, started)
      this.encodeSource.value = denoised.texture ?? raw
      this.encodeLight.value = frame.light ? 1 : 0
      this.exposure.value = frame.exposure
      if (frame.glow) {
        const pipeline = await this.glowPipeline(frame.glow, frame.toneMapping, width, height)
        await guardVideoEditThree(renderer, device, '路径追踪', () => {
          // 泛光的中间各步画到当前渲染目标，最后一步画到输出渲染目标：两个都指向本帧目标。
          renderer.setRenderTarget(frame.target); renderer.setOutputRenderTarget(frame.target)
          try { pipeline.render() } finally { renderer.setOutputRenderTarget(null) }
        })
      } else { const encode = this.encodeQuad(frame.toneMapping); await guardVideoEditThree(renderer, device, '路径追踪', () => encode.render(renderer)) }
      return this.samples < frame.samples || denoised.pending
    } catch (error) {
      // 半途失败的累积不再可信：下次从头开始。
      this.key = undefined
      throw error
    } finally {
      renderer.setRenderTarget(previous)
      for (const restore of restores.reverse()) restore()
    }
  }

  /**
   * 降噪（OIDN，与 Blender 相同的网络）：到了降噪点（看片先在 FIRST_DENOISE_SAMPLES、再在目标采样数；成片只在目标采样数）
   * 就对当前累积结果降噪一次，之后显示降噪图，直到下一个降噪点。成片等这一次降噪做完再交画面；看片在本次时间预算内等。
   * 没有权重（还在下载或下载失败）或降噪失败时照常交原图，这个追踪器之后不再降噪。
   */
  private async denoise(frame: PathTraceFrame, raw: Three.Texture, started: number): Promise<{ texture: Three.Texture | null; pending: boolean }> {
    const url = videoEditDenoiserWeightsUrl()
    // 看片时画面其他部分还是粗略画面（没有身份）就不降噪：下次调用会从头累积，这次的降噪结果用不上。
    if (!url || this.denoiseFailed || frame.key === undefined && frame.budgetMs !== undefined) return { texture: null, pending: false }
    try {
      if (!this.denoiser) {
        const [{ initUNetFromURL }, { OIDNDenoiser }] = await Promise.all([import('oidn-web'), loadAuthorThreeDependent<DenoiseModule>('three-gpu-pathtracer/denoise', this.libraries)])
        this.denoiser = new OIDNDenoiser({ auxWeightsUrl: url, initUNetFromURL: (source, backend, options) => initUNetFromURL(source, backend as never, options as never) })
        this.denoiser.init(this.renderer)
      }
      const denoiser = this.denoiser, target = frame.samples, first = Math.min(FIRST_DENOISE_SAMPLES, target)
      const point = this.samples >= target ? target : frame.budgetMs !== undefined && this.samples >= first ? first : 0
      if (point > this.denoisedSamples && !denoiser.running) {
        // 重新降噪会释放上一张降噪图：先留一份，新的一张整张做完之前照旧显示它，不闪回噪点图。
        await this.keepDenoised(denoiser)
        denoiser.reset()
        // 反照率与法线引导图按这一帧的场景（卡片已换成追踪用的材质）与追踪相机现画。
        denoiser.setScene(frame.scene, this.camera)
        denoiser.update(raw)
        this.denoisedSamples = point
        this.denoiseStartedAt = performance.now()
      }
      // 成片等到做完；看片最多等到本次预算用完（从追踪开始算），免得节目监视器在降噪期间空转着反复合成。
      const deadline = frame.budgetMs === undefined ? Infinity : started + frame.budgetMs
      while (denoiser.running && performance.now() < deadline) { await new Promise(resolve => setTimeout(resolve, 8)); frame.assertCurrent() }
      if (denoiser.error) throw denoiser.error
      if (denoiser.complete && this.denoiseStartedAt !== undefined) {
        logger.debug('路径追踪降噪完成', { event: 'video_edit.space.denoise.completed', context: { samples: this.denoisedSamples, width: frame.target.width, height: frame.target.height, durationMs: Math.round(performance.now() - this.denoiseStartedAt) } })
        this.denoiseStartedAt = undefined
        this.kept = false
      }
      const texture = denoiser.complete ? denoiser.texture : this.kept ? this.keptTarget!.texture : null
      return { texture, pending: denoiser.running || this.denoisedSamples < target }
    } catch (error) {
      // 这一帧已经过时（取消）照常往外抛；其余失败退回原图。
      frame.assertCurrent()
      this.denoiseFailed = true
      this.denoiser?.dispose(); this.denoiser = undefined; this.kept = false
      logger.warn('渲染降噪失败，路径追踪画面不降噪', { event: 'video_edit.space.denoise.failed', error })
      return { texture: null, pending: false }
    }
  }

  /** 留一份当前已完成的降噪图（同尺寸的半精度目标里），供重新降噪期间显示。补丁版封装的结果纹理可作拷贝源。 */
  private async keepDenoised(denoiser: Denoiser): Promise<void> {
    const texture = denoiser.complete ? denoiser.texture : null
    if (!texture) { this.kept = false; return }
    const { width, height } = texture.image as { width: number; height: number }
    if (!this.keptTarget || this.keptTarget.width !== width || this.keptTarget.height !== height) {
      this.keptTarget?.dispose()
      this.keptTarget = new this.library.RenderTarget(width, height, { type: this.library.HalfFloatType, depthBuffer: false })
    }
    const kept = this.keptTarget
    await guardVideoEditThree(this.renderer, (this.renderer as unknown as { backend: { device: GpuDevice } }).backend.device, '保留降噪画面', () => this.renderer.copyTextureToTexture(texture, kept.texture))
    this.kept = true
  }

  /**
   * 追踪器只读材质的经典参数（颜色、发光强度、透射等），作者用着色节点写的颜色、发光、透明度在这里不起作用。
   * 记一次日志，便于排查“渲染模式下物体变黑、效果不见了”。
   */
  private noteNodeEffects(scene: Three.Scene): void {
    const materials = new Set<string>()
    scene.traverse(object => {
      const material = (object as Partial<Three.Mesh>).material
      for (const value of Array.isArray(material) ? material : material ? [material] : []) {
        const nodes = Object.keys(value).filter(key => key.endsWith('Node') && key !== 'mrtNode' && (value as unknown as Record<string, unknown>)[key] != null)
        if (nodes.length) materials.add(`${value.type}:${nodes.join(',')}`)
      }
    })
    if (materials.size && !this.notedNodeEffects) {
      this.notedNodeEffects = true
      logger.warn('路径追踪不执行作者的着色节点，这些材质按经典参数近似', { event: 'video_edit.space.path_trace_node_effects', context: { materials: [...materials].slice(0, 8) } })
    }
  }

  private syncCamera(frame: PathTraceFrame): void {
    const camera = this.camera, source = frame.camera
    // 追踪器每次按位置、朝向与视场重算矩阵，所以从实时相机拷这些量而不是矩阵。
    camera.position.copy(source.position); camera.quaternion.copy(source.quaternion); camera.up.copy(source.up)
    camera.fov = source.fov; camera.aspect = source.aspect; camera.near = source.near; camera.far = source.far
    camera.focusDistance = frame.focusDistance
    // 追踪器的光圈直径 = bokehSize × 1e-3（世界单位）。
    camera.bokehSize = Math.max(0, frame.aperture) * 1000
    camera.updateMatrixWorld(); camera.updateProjectionMatrix()
  }

  /** 卡片换成追踪用的发光材质；每换一张就登记还原，中途出错也能全部换回。 */
  private applyCards(cards: readonly PathTraceCard[], restores: Array<() => void>): void {
    const { library, renderer } = this
    // 已从场景里移除的卡片（宿主释放了它）不再需要解码目标。
    for (const [mesh, entry] of this.cardTargets) if (!mesh.parent) { entry.target.dispose(); entry.material.dispose(); entry.side?.dispose(); this.cardTargets.delete(mesh) }
    for (const card of cards) {
      let entry = this.cardTargets.get(card.mesh)
      if (entry && entry.solid !== !!card.solid) { entry.target.dispose(); entry.material.dispose(); entry.side?.dispose(); this.cardTargets.delete(card.mesh); entry = undefined }
      if (!entry || entry.target.width !== card.width || entry.target.height !== card.height) {
        entry?.target.dispose(); entry?.material.dispose(); entry?.side?.dispose()
        const target = new library.RenderTarget(card.width, card.height, { type: library.HalfFloatType, depthBuffer: false })
        target.texture.colorSpace = library.LinearSRGBColorSpace
        // 只发光、不反光：底色黑、无高光；覆盖率决定光线是否穿过卡片。matte：相机看不见，卡片由实时那一层叠上来。
        const material = card.solid
          ? new library.MeshPhysicalMaterial({ color: 0xffffff, map: target.texture, alphaTest: .5, emissive: 0xffffff, emissiveMap: target.texture, emissiveIntensity: 0, side: library.DoubleSide })
          : Object.assign(new library.MeshPhysicalMaterial({ color: 0x000000, roughness: 1, metalness: 0, specularIntensity: 0,
            emissive: 0xffffff, emissiveMap: target.texture, map: target.texture, transparent: true, side: library.DoubleSide }), { matte: true })
        entry = { target, material, solid: !!card.solid }
        this.cardTargets.set(card.mesh, entry)
      }
      this.decodeSource.value = card.texture
      this.decodeLight.value = card.light ? 1 : 0
      renderer.setRenderTarget(entry.target)
      this.decode.render(renderer)
      entry.material.opacity = card.opacity
      // 卡片照亮周围的光：亮度 1 时与画面颜色一致，发光强度在此之上加亮。
      entry.material.emissiveIntensity = card.solid ? card.emission : 1 + card.emission
      if (card.solid) { entry.material.roughness = card.solid.roughness; entry.material.metalness = card.solid.metalness }
      const original = card.mesh.material
      // 挤出体的侧面 uv 落在轮廓上（透明度约一半），按正面的透明度裁剪会出破洞：侧面另用一份不裁剪的同参数材质。
      if (card.solid && card.mesh.geometry.groups.length) {
        entry.side ??= entry.material.clone()
        entry.side.alphaTest = 0
        entry.side.roughness = entry.material.roughness; entry.side.metalness = entry.material.metalness; entry.side.emissiveIntensity = entry.material.emissiveIntensity
        card.mesh.material = [entry.material, entry.side]
      } else card.mesh.material = entry.material
      restores.push(() => { card.mesh.material = original })
    }
  }

  private async applyEnvironment(scene: Three.Scene, key: string | undefined, restores: Array<() => void>): Promise<void> {
    const environment = scene.environment, background = scene.background
    const converted = environment ? await this.equirect(environment, key) : null
    const backdrop = background && (background as Three.Texture).isTexture ? await this.equirect(background as Three.Texture, key) : background
    scene.environment = converted
    scene.background = backdrop
    restores.push(() => { scene.environment = environment; scene.background = background })
  }

  /**
   * 任意环境贴图 → CPU 上有数据、线性过滤的半精度等距柱状图（作者的贴图不改动，另做一份）。
   * CPU 上有数据的按贴图版本缓存；画在显卡上的（PMREM、立方体、渲染目标）内容可能每帧变而版本号不变，只在同一画面内复用。
   */
  private async equirect(texture: Three.Texture, key: string | undefined): Promise<Three.Texture> {
    const { library } = this
    const source = texture as Three.DataTexture
    const image = source.image as { data?: ArrayLike<number>; width: number; height: number } | undefined
    const onCpu = source.isDataTexture === true && !!image?.data && texture.mapping === library.EquirectangularReflectionMapping
    const cached = this.environments.get(texture)
    if (cached && cached.version === texture.version && (onCpu || key !== undefined && cached.key === key)) return cached.texture
    const result = onCpu ? this.halfFromData(source, image!) : await this.halfFromGpu(texture)
    // DataTexture 默认最近邻过滤，three 会当作不可过滤、不声明采样器，追踪器的着色器就编译不过。
    result.mapping = library.EquirectangularReflectionMapping
    result.minFilter = result.magFilter = library.LinearFilter
    result.needsUpdate = true
    cached?.texture.dispose()
    this.environments.delete(texture)
    this.environments.set(texture, { version: texture.version, key, texture: result })
    while (this.environments.size > 4) { const [oldest, entry] = this.environments.entries().next().value!; entry.texture.dispose(); this.environments.delete(oldest) }
    return result
  }

  /** 单精度在 WebGPU 里不能过滤采样，追踪器要用采样器读环境图：统一转成半精度 RGBA。8 位数据按颜色空间解码到线性。 */
  private halfFromData(texture: Three.DataTexture, image: { data?: ArrayLike<number>; width: number; height: number }): Three.DataTexture {
    const { library } = this
    const values = image.data!, pixels = image.width * image.height
    const channels = Math.round(values.length / pixels)
    const half = new Uint16Array(pixels * 4)
    const srgb = texture.colorSpace === library.SRGBColorSpace
    // 输出按 flipY = false 存放（追踪器不再看源贴图的 flipY）：源贴图要翻转的（如 HDR 加载器读出的环境图）在这里按行倒过来，
    // 否则追踪里的环境与实时上下颠倒。
    const flip = texture.flipY, width = image.width, height = image.height
    for (let pixel = 0; pixel < pixels; pixel++) for (let channel = 0; channel < 4; channel++) {
      // 单通道当灰度；双通道（红绿）缺的蓝按 0；缺透明度按不透明。
      const source = channel === 3 ? (channels === 4 ? 3 : -1) : channels === 1 ? 0 : channel < channels ? channel : -1
      let value = source < 0 ? channel === 3 ? 1 : 0 : Number(values[pixel * channels + source])
      if (texture.type === library.HalfFloatType) value = library.DataUtils.fromHalfFloat(value)
      else if (texture.type === library.UnsignedByteType) {
        value /= 255
        if (srgb && channel < 3) value = value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
      }
      const target = flip ? (height - 1 - Math.floor(pixel / width)) * width + pixel % width : pixel
      half[target * 4 + channel] = library.DataUtils.toHalfFloat(value)
    }
    return new library.DataTexture(half, image.width, image.height, library.RGBAFormat, library.HalfFloatType)
  }

  private async halfFromGpu(texture: Three.Texture): Promise<Three.DataTexture> {
    const { library, tsl, renderer } = this
    const width = ENVIRONMENT_WIDTH, height = ENVIRONMENT_WIDTH / 2
    const target = new library.RenderTarget(width, height, { type: library.FloatType, depthBuffer: false })
    const material = new library.MeshBasicNodeMaterial({ blending: library.NoBlending, toneMapped: false })
    try {
      // 与追踪器、three 的等距柱状映射一致：u 绕 y 轴一圈，v 从下到上。
      const phi = tsl.uv().x.sub(.5).mul(Math.PI * 2), theta = tsl.uv().y.sub(.5).mul(Math.PI)
      const direction = tsl.vec3(tsl.cos(theta).mul(tsl.cos(phi)), tsl.sin(theta), tsl.cos(theta).mul(tsl.sin(phi)))
      material.colorNode = (texture as Three.CubeTexture).isCubeTexture ? tsl.cubeTexture(texture, direction)
        : texture.mapping === library.CubeUVReflectionMapping ? tsl.pmremTexture(texture, direction)
          : tsl.texture(texture, tsl.equirectUV(direction))
      const previous = renderer.getRenderTarget()
      try { renderer.setRenderTarget(target); new library.QuadMesh(material).render(renderer) } finally { renderer.setRenderTarget(previous) }
      const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, width, height)
      const half = new Uint16Array(pixels.length)
      for (let i = 0; i < pixels.length; i++) half[i] = library.DataUtils.toHalfFloat(pixels[i])
      return new library.DataTexture(half, width, height, library.RGBAFormat, library.HalfFloatType)
    } finally { target.dispose(); material.dispose() }
  }

  dispose(): void {
    for (const entry of this.glowPipelines.values()) { for (const node of entry.nodes) node.dispose(); entry.pipeline.dispose() }
    this.denoiser?.dispose()
    this.keptTarget?.dispose()
    this.tracer.dispose()
    for (const entry of this.cardTargets.values()) { entry.target.dispose(); entry.material.dispose() }
    for (const entry of this.environments.values()) entry.texture.dispose()
    this.decode.material.dispose()
    for (const quad of this.encodes.values()) quad.material.dispose()
  }
}
