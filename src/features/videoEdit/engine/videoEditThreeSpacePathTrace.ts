import type * as Three from 'three'
import type { AuthorLibraryVersions } from '@/core/videoEdit/codeMaterial/authorLibraries'
import type { ManagedThreeRenderer } from './videoEditAuthorThreeWebGpu'
import { loadAuthorThreeDependent } from './videoEditAuthorThreeWebGpu'
import { guardVideoEditGpu } from './videoEditGpuErrorScope'
import type { GpuDevice } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.space')

/**
 * 统一三维渲染器的路径追踪（three-gpu-pathtracer）：与实时渲染同一个 three 场景，按帧累积采样。
 *
 * - 同一画面（宿主给的 key 与输出尺寸都不变）连续调用时接着累积，换帧、改动或改尺寸后从头开始；每次调用在时间预算内追踪，
 *   没到目标采样数时返回 refining，节目监视器据此再要一次同一帧。
 * - 追踪器的贴图图集是 8 位线性：很暗的卡片颜色只剩几级（上游限制）。
 * - 卡片画面是预乘、2.4 伽马编码的宿主纹理，追踪器的贴图图集只认普通贴图：先解码成线性、非预乘的渲染目标，
 *   作为只发光不反光的材质（透明度取覆盖率）；发光画面的覆盖率取覆盖与亮度较大者，乘回来仍是原来的发光。
 * - 环境光要逐像素有数据的等距柱状图：PMREM、立方体与贴图环境都先在 GPU 上展开再读回（按贴图版本缓存）。
 * - 景深按相机的光学参数换成光圈直径（与实时景深同一弥散公式）；路径追踪不做运动模糊。
 * - 追踪结果是线性预乘颜色，输出前与实时一样做中性色调映射与 2.4 伽马编码。追踪里分不出哪些像素是卡片，
 *   所以卡片的发光先做一遍中性色调映射的逆运算：正对着看时映射回原色（与实时、二维一致），照到别处的光略强。
 */

interface TslNode {
  mul(value: unknown): TslNode; div(value: unknown): TslNode; add(value: unknown): TslNode; sub(value: unknown): TslNode
  greaterThan(value: unknown): TslNode; lessThan(value: unknown): TslNode; sample(uv: unknown): TslNode
  readonly x: TslNode; readonly y: TslNode; readonly xy: TslNode; readonly rgb: TslNode; readonly a: TslNode; readonly r: TslNode; readonly g: TslNode; readonly b: TslNode
}
type TslFn = (...args: unknown[]) => TslNode
interface Tsl {
  uniform: TslFn; texture: TslFn; textureLoad: TslFn; cubeTexture: TslFn; pmremTexture: TslFn; equirectUV: TslFn
  vec3: TslFn; vec4: TslFn; ivec2: TslFn; uv: TslFn; select: TslFn; pow: TslFn; max: TslFn; min: TslFn; sqrt: TslFn; float: TslFn; clamp: TslFn; cos: TslFn; sin: TslFn; neutralToneMapping: TslFn
  screenCoordinate: TslNode
}
interface NodeMaterial extends Three.Material { colorNode: unknown }
interface QuadMesh { material: NodeMaterial; render(renderer: unknown): void }
type Library = typeof Three & {
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

export interface PathTraceCard { mesh: Three.Mesh; texture: Three.Texture; width: number; height: number; opacity: number; light: boolean; emission: number }
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
  /** 组画面是否带发光：决定输出的编码约定（与实时渲染相同）。 */
  light: boolean
  /** 追踪结果的去处：线性预乘、半精度，与实时渲染的中间目标相同。 */
  target: Three.RenderTarget
  assertCurrent(): void
}

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
  private readonly cardTargets = new Map<Three.Mesh, { target: Three.RenderTarget; material: Three.MeshPhysicalMaterial }>()
  /** 展开过的环境图，按来源贴图；只留最近几张（换环境的作品很少）。 */
  private readonly environments = new Map<Three.Texture, { version: number; key?: string; texture: Three.DataTexture }>()
  private readonly decode: QuadMesh
  private readonly decodeSource: TslNode & { value: Three.Texture }
  private readonly decodeLight: TslNode & { value: number }
  private readonly encode: QuadMesh
  private readonly encodeSource: TslNode & { value: Three.Texture }
  private readonly encodeLight: TslNode & { value: number }
  private readonly camera: InstanceType<PathTraceModule['PhysicalCamera']>

  private constructor(private readonly library: Library, private readonly tsl: Tsl, private readonly renderer: Renderer, private readonly tracer: Tracer, module: PathTraceModule) {
    tracer.renderDelay = 0; tracer.fadeDuration = 0; tracer.minSamples = 0; tracer.dynamicLowRes = false; tracer.synchronizeRenderSize = false
    // 三维组画面要透明地叠回二维合成：穿过半透明卡片、玻璃看到的“背景”是透明，而不是按环境光染色的不透明底。
    tracer.transmissiveBackground = module.TRANSMISSIVE_BACKGROUND_TRANSPARENT
    this.camera = new module.PhysicalCamera(45, 1, .1, 100)
    this.camera.apertureBlades = 0
    // 卡片解码：预乘 2.4 伽马 → 线性非预乘；发光画面的覆盖率取覆盖与亮度较大者。
    this.decodeSource = tsl.texture(new library.Texture()) as TslNode & { value: Three.Texture }
    this.decodeLight = tsl.uniform(0) as TslNode & { value: number }
    const source = this.decodeSource, light = this.decodeLight.greaterThan(.5)
    // 普通画面先解预乘再解码；发光画面按预乘逐通道解码，覆盖率取覆盖与亮度较大者，再按它解预乘。
    const premultiplied = tsl.pow(tsl.max(source.rgb, tsl.vec3(0)), tsl.vec3(2.4))
    const glow = tsl.max(source.a, tsl.max(premultiplied.r, tsl.max(premultiplied.g, premultiplied.b)))
    const coverage = tsl.select(light, glow, source.a)
    const straight = tsl.select(light, premultiplied.div(tsl.max(glow, 1e-5)), tsl.pow(tsl.max(source.rgb.div(tsl.max(source.a, 1e-5)), tsl.vec3(0)), tsl.vec3(2.4)))
    const decodeMaterial = new library.MeshBasicNodeMaterial({ blending: library.NoBlending, toneMapped: false, depthTest: false, depthWrite: false })
    decodeMaterial.colorNode = tsl.vec4(tsl.select(coverage.greaterThan(1e-5), this.inverseNeutral(straight), tsl.vec3(0)), tsl.clamp(coverage, 0, 1))
    this.decode = new library.QuadMesh(decodeMaterial)
    // 追踪结果按行自上而下存放、是不可过滤的单精度纹理：按像素读取，与实时渲染一样做色调映射与编码（保持预乘）。
    this.encodeSource = tsl.texture(new library.Texture()) as TslNode & { value: Three.Texture }
    const texel = tsl.textureLoad(this.encodeSource, tsl.ivec2(tsl.screenCoordinate.xy))
    const alpha = tsl.clamp(texel.a, 0, 1)
    const covered = texel.a.greaterThan(1e-5)
    // 编码约定与实时渲染相同：组画面带发光时按预乘逐通道，否则解预乘编码再乘回透明度。
    const mapped = tsl.neutralToneMapping(tsl.select(covered, texel.rgb.div(texel.a), texel.rgb), 1)
    const encoded = tsl.pow(tsl.max(mapped, tsl.vec3(0)), tsl.vec3(1 / 2.4))
    const lightEncoded = tsl.pow(tsl.max(tsl.neutralToneMapping(texel.rgb, 1), tsl.vec3(0)), tsl.vec3(1 / 2.4))
    this.encodeLight = tsl.uniform(0) as TslNode & { value: number }
    const encodeMaterial = new library.MeshBasicNodeMaterial({ blending: library.NoBlending, toneMapped: false, depthTest: false, depthWrite: false })
    encodeMaterial.colorNode = tsl.vec4(tsl.select(this.encodeLight.greaterThan(.5), lightEncoded, tsl.select(covered, encoded.mul(alpha), encoded)), alpha)
    this.encode = new library.QuadMesh(encodeMaterial)
  }

  /**
   * three 的中性色调映射（Khronos PBR Neutral）的逆：先还原高光压缩（忽略压缩区很小的去饱和），再加回暗部偏移。
   * 偏移按输入最小分量 x 取：x < 0.08 时 x − 6.25x²，否则 0.04；输出最小分量 m = x − 偏移，于是 m < 0.04 时 x = √m / 2.5。
   */
  private inverseNeutral(color: TslNode): TslNode {
    const { tsl } = this
    const start = .76, d = 1 - start
    const peak = tsl.max(color.r, tsl.max(color.g, color.b))
    // 压缩区接近 1 时逆运算发散：发光画面最多还原到约 3.4 倍。
    const compressed = tsl.min(peak, .98)
    const unpeak = tsl.select(peak.lessThan(start), peak, tsl.float(d * d).div(tsl.float(1).sub(compressed)).sub(d).add(start))
    const expanded = color.mul(unpeak.div(tsl.max(peak, 1e-6)))
    const low = tsl.max(tsl.min(expanded.r, tsl.min(expanded.g, expanded.b)), 0)
    const offset = tsl.select(low.lessThan(.04), tsl.sqrt(low).div(2.5).sub(low), .04)
    return expanded.add(offset)
  }

  static async create(library: Library, tsl: Tsl, renderer: Renderer, libraries?: AuthorLibraryVersions): Promise<VideoEditThreeSpacePathTrace> {
    const module = await loadAuthorThreeDependent<PathTraceModule>('three-gpu-pathtracer/webgpu', libraries)
    return new VideoEditThreeSpacePathTrace(library, tsl, renderer, new module.WebGPUPathTracer(renderer), module)
  }

  /** 追踪一批采样写进 frame.target；返回是否还没到目标采样数。 */
  /** 当前画面每个像素都至少追踪过一次（采样数取全幅最少处）；之前输出里没追到的块是黑的。 */
  get covered(): boolean { return this.samples >= 1 }

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
      }
      tracer.maxSamples = frame.samples
      // 追踪器每次采样后把结果画到当前渲染目标：指向本帧目标，随后再被编码结果覆盖。
      renderer.setRenderTarget(frame.target)
      const started = performance.now(), batch = frame.budgetMs === undefined ? SAMPLE_BATCH : 1
      while (this.samples < frame.samples) {
        await guardVideoEditGpu(device, '路径追踪', () => { for (let i = 0; i < batch; i++) tracer.renderSample() })
        // 读回采样数要等显卡做完这一批：排队的显卡工作每次只有一小批（不会一下排进几秒的计算触发显卡超时），也能及时取消。
        // 波前追踪每次只推进一次弹射，采样数只能按追踪器自己的统计。
        this.samples = (await tracer.getSampleCountsAsync()).min
        frame.assertCurrent()
        if (frame.budgetMs !== undefined && performance.now() - started >= frame.budgetMs) break
      }
      const result = tracer.target
      if (!result) throw new Error('路径追踪没有输出画面。')
      this.encodeSource.value = result
      this.encodeLight.value = frame.light ? 1 : 0
      await guardVideoEditGpu(device, '路径追踪', () => this.encode.render(renderer))
      return this.samples < frame.samples
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
    for (const [mesh, entry] of this.cardTargets) if (!mesh.parent) { entry.target.dispose(); entry.material.dispose(); this.cardTargets.delete(mesh) }
    for (const card of cards) {
      let entry = this.cardTargets.get(card.mesh)
      if (!entry || entry.target.width !== card.width || entry.target.height !== card.height) {
        entry?.target.dispose(); entry?.material.dispose()
        const target = new library.RenderTarget(card.width, card.height, { type: library.HalfFloatType, depthBuffer: false })
        target.texture.colorSpace = library.LinearSRGBColorSpace
        // 只发光、不反光：底色黑、无高光；覆盖率决定光线是否穿过卡片。
        const material = new library.MeshPhysicalMaterial({ color: 0x000000, roughness: 1, metalness: 0, specularIntensity: 0,
          emissive: 0xffffff, emissiveMap: target.texture, map: target.texture, transparent: true, side: library.DoubleSide })
        entry = { target, material }
        this.cardTargets.set(card.mesh, entry)
      }
      this.decodeSource.value = card.texture
      this.decodeLight.value = card.light ? 1 : 0
      renderer.setRenderTarget(entry.target)
      this.decode.render(renderer)
      entry.material.opacity = card.opacity
      // 卡片在追踪里本就是发光面（亮度 1 时颜色与画面一致）；发光强度在此之上加亮，照亮周围、出现在反射与折射里。
      entry.material.emissiveIntensity = 1 + card.emission
      const original = card.mesh.material
      card.mesh.material = entry.material
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
    for (let pixel = 0; pixel < pixels; pixel++) for (let channel = 0; channel < 4; channel++) {
      // 单通道当灰度；双通道（红绿）缺的蓝按 0；缺透明度按不透明。
      const source = channel === 3 ? (channels === 4 ? 3 : -1) : channels === 1 ? 0 : channel < channels ? channel : -1
      let value = source < 0 ? channel === 3 ? 1 : 0 : Number(values[pixel * channels + source])
      if (texture.type === library.HalfFloatType) value = library.DataUtils.fromHalfFloat(value)
      else if (texture.type === library.UnsignedByteType) {
        value /= 255
        if (srgb && channel < 3) value = value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4
      }
      half[pixel * 4 + channel] = library.DataUtils.toHalfFloat(value)
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
    this.tracer.dispose()
    for (const entry of this.cardTargets.values()) { entry.target.dispose(); entry.material.dispose() }
    for (const entry of this.environments.values()) entry.texture.dispose()
    this.decode.material.dispose()
    this.encode.material.dispose()
  }
}
