import type * as Three from 'three'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { AuthorLibraryVersions } from '@/core/videoEdit/codeMaterial/authorLibraries'
import type { SpatialCardGeometry, SpatialFrame } from '@/core/videoEdit/spatialTypes'
import type { VideoEditSpaceRenderDisplay } from '@/core/videoEdit/spaceDisplay'
import { loadAuthorThreeLibrary, loadAuthorThreeModule, type AuthorThreeLibrary } from './videoEditAuthorThreeWebGpu'
import { VideoEditAuthorThreeClock } from './videoEditAuthorThreeClock'
import type { VideoEditThreeSpacePathTrace } from './videoEditThreeSpacePathTrace'
import { runVideoEditGpuSection } from './videoEditGpuRootQueue'
import { guardVideoEditGpu } from './videoEditGpuErrorScope'

/**
 * 统一三维渲染器：一组空间卡片与作者 three 场景在同一个 three 场景里一次绘制，景深、运动模糊按整幅画面做后处理。
 *
 * - 卡片是贴着剪辑画面（宿主纹理，经 ExternalTexture 零拷贝借用）的平面，几何直接取空间求值的 uvToWorld，与读回同一几何；
 *   默认不受光，没有后处理时颜色与二维合成一致。
 * - 宿主纹理是预乘、按 2.4 伽马编码的 Rec.709 显示空间：卡片在着色器里解码到线性参与绘制，输出前再编码回去。
 *   作者物体按中性色调映射输出（与作者场景单独渲染时一致），卡片像素不做，颜色才不变。
 * - 半透明卡片按中心视深与作者物体一起由 three 从远到近排序；卡片写深度，挡住其后的作者物体。
 * - 景深：卡片由宿主按自身视深整张虚化后才交来（细笔画的文字在整幅景深里会被周围空白稀释）；整幅景深只作用于作者物体，
 *   卡片像素与没画到东西的像素都按对焦处理。
 * - 运动模糊：速度 = 本帧位置 − 快门开始时的位置（卡片用快门开始时的空间帧，作者物体用宿主在快门开始时刻更新场景后记下的矩阵），
 *   不依赖上一次绘制，任意帧单独渲染都可复现。
 * - 作者场景的着色器时钟：一组只有一个作者场景时用它的源时间（与单独渲染一致），多个时共用第一个的源时间。
 * - 显示方式：实体、线框只在本次渲染期间把作者的网格换成统一的灰色明暗或线框材质、不做后处理，结束后还原；
 *   粒子、精灵等靠节点算顶点位置的物体保持原材质（换掉会塌成一点）；卡片照常显示画面。
 * - 渲染（路径追踪）见 videoEditThreeSpacePathTrace：同一场景按帧累积采样，没收敛时告诉宿主再要一次同一帧。
 */

export interface ThreeSpaceCard {
  clipId: string
  texture: GpuTexture
  width: number
  height: number
  geometry: SpatialCardGeometry
  opacity: number
  /** 画面带透明度为 0 的发光（预乘下 rgb 可大于 alpha），不能按覆盖率丢弃或解预乘。 */
  light: boolean
  /** 发光强度（片段的 spaceEmission 本帧值）：画面自身发出的光，线性倍数，0 为不发光。 */
  emission: number
}
export interface ThreeSpaceScene {
  clipId: string
  root: Three.Group
  time: number
  opacity: number
  /** 快门开始时刻场景里各物体的世界矩阵（宿主先按那一刻更新场景记下）；缺省按静止处理。 */
  previous?: ReadonlyMap<Three.Object3D, Three.Matrix4>
}
export interface ThreeSpaceEffects {
  display: VideoEditSpaceRenderDisplay
  /** 序列开了运动模糊（整份作品不变，管线不随帧重建）。 */
  motionBlur: boolean
  /** 序列相机用到景深（整份作品不变）。 */
  depthOfField: boolean
  /** 对焦距离（世界单位，即显示高度）。 */
  focusDistance: number
  /** 弥散圆系数 K（输出像素）：视深 z 处的弥散半径 = K·|z − 对焦距离| / z，与空间求值的光学公式相同；0 为没有景深。 */
  cocScale: number
  /** 本帧画面里最大的弥散半径（输出像素）：虚化尺度按它取，最虚的那层才完全虚掉。 */
  cocMax: number
  /**
   * 拖影补偿：快门开始帧取的是最早的曝光样本，它离中心只有 (1 − 1/样本数) 个半快门；乘上 样本数 /(样本数 − 1) 才是整段快门，
   * 预览与导出的样本数不同时拖影长度也一致。
   */
  shutterScale: number
  /** 泛光、环境光遮蔽、屏幕空间反射的强度（序列三维效果设置，0 为不开）；只作用于实时显示与成片的实时渲染。 */
  bloom: number
  ambientOcclusion: number
  reflections: number
  /** 序列里有片段发光（整段任意时刻）：管线多一个发光附件，发光不依赖序列泛光开关也会扩成光晕。 */
  emission: boolean
}
export interface ThreeSpaceFrame {
  frame: SpatialFrame
  /** 快门开始时刻的空间帧；缺省没有运动模糊。 */
  shutterOpen?: SpatialFrame
  cards: readonly ThreeSpaceCard[]
  scenes: readonly ThreeSpaceScene[]
  effects: ThreeSpaceEffects
  target: { texture: GpuTexture; width: number; height: number }
  /** 组画面是否带发光（有作者场景或发光卡片时为是）：宿主按它选择解码约定，输出编码与之一致。 */
  light: boolean
  /** 显示方式为“渲染”时的路径追踪安排；缺省按 TRACE_SAMPLES 一次追踪到底。 */
  trace?: ThreeSpaceTrace
  assertCurrent(): void
}
export interface ThreeSpaceTrace {
  /** 一帧里的哪个空间组：每组各用一个追踪器，同一帧的几组才能各自接着累积。 */
  group: string
  /** 画面身份（剪辑、版本与帧，只在这一帧的输入都精确时给出）：相同时接着累积采样；缺省每次从头追踪。 */
  key?: string
  /** 每像素目标采样数。 */
  samples: number
  /** 本次调用最多追踪多久（毫秒）；缺省追踪到目标采样数为止。 */
  budgetMs?: number
}
const TRACE_SAMPLES = 256
/** 一帧里同时累积的空间组上限：每个追踪器都占着全分辨率的累积目标与加速结构。 */
const TRACE_GROUPS = 8
/** 后处理管线按最近使用保留的套数：每套都占着全分辨率的多重采样目标（4K 下近 1GB），同一份作品只用到实时与一种简化组合。 */
const PIPELINE_SETS = 2

/** 作者版 three 的 TSL 节点。类型声明跟着应用自带的 three 版本，这里只描述用到的部分。 */
interface TslNode {
  mul(value: TslInput): TslNode; div(value: TslInput): TslNode; add(value: TslInput): TslNode; sub(value: TslInput): TslNode
  greaterThan(value: TslInput): TslNode; negate(): TslNode; abs(): TslNode
  readonly r: TslNode; readonly g: TslNode; readonly b: TslNode; readonly rgb: TslNode; readonly a: TslNode; readonly xy: TslNode; readonly w: TslNode
  sample(coord: TslNode): TslNode
}
type TslInput = TslNode | number | Three.Matrix4 | Three.Texture | Three.Camera
type TslFn = (...args: TslInput[]) => TslNode
interface TslUniform<T> extends TslNode { value: T; onObjectUpdate(update: (frame: { object: Three.Object3D }) => T): TslUniform<T> }
interface TslPass extends TslNode { setMRT(mrt: TslNode): void; getTexture(name: string): Three.Texture; getTextureNode(name: string): TslNode; getViewZNode(): TslNode; dispose(): void }
interface Tsl {
  uniform: { (value: number): TslUniform<number>; (value: Three.Matrix4): TslUniform<Three.Matrix4> }
  texture(value: Three.Texture): TslUniform<Three.Texture>
  select: TslFn; vec2: TslFn; vec3: TslFn; vec4: TslFn; pow: TslFn; max: TslFn; clamp: TslFn; mix: TslFn; convertToTexture: TslFn
  sin: TslFn; asin: TslFn; sign: TslFn; float: TslFn; neutralToneMapping: TslFn
  packNormalToRGB: TslFn; unpackRGBToNormal: TslFn; sample(fn: (coord: TslNode) => TslNode): TslNode
  normalView: TslNode; metalness: TslNode; roughness: TslNode
  mrt(outputs: Record<string, TslNode>): TslNode
  pass(scene: Three.Scene, camera: Three.Camera, options?: Record<string, unknown>): TslPass
  output: TslNode; positionLocal: TslNode; modelViewMatrix: TslNode; cameraProjectionMatrix: TslNode
}
interface PostNodes { dof: TslFn; motionBlur: TslFn; bloom: TslFn; ao: TslFn; ssr: TslFn; fxaa: TslFn }
interface NodeMaterial extends Three.Material { colorNode: TslNode | null; mrtNode: TslNode | null; maskNode: TslNode | null }
interface RenderPipeline { outputNode: TslNode; outputColorTransform: boolean; render(): void; dispose(): void }
type Library = AuthorThreeLibrary & {
  MeshBasicNodeMaterial: new (parameters: Record<string, unknown>) => NodeMaterial
  MeshMatcapNodeMaterial: new (parameters: Record<string, unknown>) => NodeMaterial
  RenderPipeline: new (renderer: unknown) => RenderPipeline
  BlendMode: new (blending: number) => unknown
}
interface CardEntry {
  mesh: Three.Mesh
  material: NodeMaterial
  light: boolean
  source?: GpuTexture
  external?: Three.Texture
  map: TslUniform<Three.Texture>
  opacity: TslUniform<number>
  emission: TslUniform<number>
  /** 两份多目标输出：管线有发光附件时卡片要写它，没有时不能写（未声明的输出会让管线校验失败）。 */
  outputs: { plain: TslNode; emission: TslNode }
  /** 最后一次用到它的渲染序号：一帧有多个空间组时其他组的卡片只隐藏，久不用才释放。 */
  used: number
}
/** 久未使用的卡片网格在这么多次渲染后释放（多组同帧时每组渲染都会隐藏别组的卡片）。 */
const CARD_IDLE_RENDERS = 120
const SCENE_SETTINGS = ['environment', 'environmentIntensity', 'environmentRotation', 'background', 'backgroundIntensity', 'backgroundBlurriness', 'backgroundRotation', 'fog'] as const

export class VideoEditThreeSpace {
  private readonly scene: Three.Scene
  private readonly camera: Three.PerspectiveCamera
  private readonly cards = new Map<string, CardEntry>()
  private readonly attached = new Set<Three.Object3D>()
  private readonly quad: Three.BufferGeometry
  private readonly center: Three.Matrix4
  /** 快门开始时各物体的世界矩阵；每次渲染重建，速度节点按物体读取，没有的按静止处理（不沿用更早某帧的矩阵）。 */
  private previousWorld = new WeakMap<Three.Object3D, Three.Matrix4>()
  private target?: Three.RenderTarget
  private output?: { source: GpuTexture; external: Three.Texture }
  /**
   * 按后处理组合缓存的管线：实时与实体、线框来回切时不重建（否则换档那一下的卡顿又会触发下一次换档）。
   * 释放时一并释放各自的节点：RenderPipeline.dispose 只释放全屏四边形的材质，场景与景深节点的渲染目标要单独释放。
   */
  private readonly pipelines = new Map<string, { pipeline: RenderPipeline; nodes: Array<{ dispose(): void }>; primed: boolean; emission: boolean }>()
  private renders = 0
  private overrides?: Record<'solid' | 'wireframe', Three.Material>
  private readonly focus: TslUniform<number>
  private readonly cocScale: TslUniform<number>
  private readonly cocMax: TslUniform<number>
  /** 景深在全屏四边形上计算，那里的相机节点是四边形自己的正交相机，场景的远裁剪面要单独传。 */
  private readonly far: TslUniform<number>
  private readonly previousViewProjection: TslUniform<Three.Matrix4>
  private readonly shutterScale: TslUniform<number>
  private readonly bloom: TslUniform<number>
  private readonly ambientOcclusion: TslUniform<number>
  private readonly reflections: TslUniform<number>
  /** 这一组画面是否带发光（宿主按预乘逐通道解码）；决定输出的编码约定。 */
  private readonly lightOutput: TslUniform<number>
  private readonly velocity: TslNode
  private failure?: Error
  private closed = false
  /** 各空间组的追踪器；切到其他显示方式时全部释放（它们的累积目标与加速结构很占显存）。 */
  /** 看片时已先交过实时画面、下一次要开始追踪的画面（每组一项）。 */
  private readonly traceRequested = new Set<string>()
  private readonly pathTraces = new Map<string, Promise<VideoEditThreeSpacePathTrace>>()
  private get device(): GpuDevice { return (this.renderer as unknown as { backend: { device: GpuDevice } }).backend.device }

  private constructor(private readonly library: Library, private readonly tsl: Tsl, private readonly post: PostNodes,
    private readonly renderer: InstanceType<AuthorThreeLibrary['WebGPURenderer']>, private readonly clock: VideoEditAuthorThreeClock,
    private readonly libraries?: AuthorLibraryVersions) {
    this.scene = new library.Scene()
    this.camera = new library.PerspectiveCamera()
    this.camera.matrixAutoUpdate = false
    this.camera.matrixWorldAutoUpdate = false
    this.camera.coordinateSystem = library.WebGPUCoordinateSystem
    // 单位方片，中心在原点：配合 uvToWorld × 平移(0.5,0.5) 使网格原点落在卡片中心，three 按它排序透明物体。
    const quad = new library.BufferGeometry()
    quad.setAttribute('position', new library.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3))
    quad.setAttribute('uv', new library.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2))
    quad.setIndex([0, 1, 2, 0, 2, 3])
    this.quad = quad
    this.center = new library.Matrix4().makeTranslation(.5, .5, 0)
    this.focus = tsl.uniform(1)
    this.cocScale = tsl.uniform(0)
    this.cocMax = tsl.uniform(1)
    this.far = tsl.uniform(1)
    this.previousViewProjection = tsl.uniform(new library.Matrix4())
    this.shutterScale = tsl.uniform(1)
    this.bloom = tsl.uniform(0)
    this.ambientOcclusion = tsl.uniform(0)
    this.reflections = tsl.uniform(0)
    this.lightOutput = tsl.uniform(0)
    // 速度：本帧与快门开始时的裁剪坐标差（与 three 的 VelocityNode 同一定义），所有物体共用；任一时刻在相机平面后方时记为静止，不爆出长拖影。
    // 只按物体的世界矩阵：实例矩阵、骨骼与形变在快门内的位移不计。
    const previousModel = tsl.uniform(new library.Matrix4()).onObjectUpdate(({ object }) => this.previousWorld.get(object) ?? object.matrixWorld)
    const point = tsl.vec4(tsl.positionLocal, 1)
    const current = tsl.cameraProjectionMatrix.mul(tsl.modelViewMatrix).mul(point)
    const before = this.previousViewProjection.mul(previousModel).mul(point)
    const visible = tsl.select(current.w.greaterThan(1e-4), before.w.greaterThan(1e-4), 0)
    this.velocity = tsl.select(visible, current.xy.div(current.w).sub(before.xy.div(before.w)), tsl.vec2(0))
    renderer.onDeviceLost = () => { this.failure = new Error('统一三维渲染设备已丢失。') }
  }

  static async create(device: GpuDevice, libraries?: AuthorLibraryVersions): Promise<VideoEditThreeSpace> {
    const [library, tsl, dofModule, blurModule, bloomModule, aoModule, ssrModule, fxaaModule] = await Promise.all([
      loadAuthorThreeLibrary(libraries) as Promise<Library>,
      loadAuthorThreeModule<Tsl>('three/tsl', libraries),
      loadAuthorThreeModule<{ dof: TslFn }>('three/addons/tsl/display/DepthOfFieldNode.js', libraries),
      loadAuthorThreeModule<{ motionBlur: TslFn }>('three/addons/tsl/display/MotionBlur.js', libraries),
      loadAuthorThreeModule<{ bloom: TslFn }>('three/addons/tsl/display/BloomNode.js', libraries),
      loadAuthorThreeModule<{ ao: TslFn }>('three/addons/tsl/display/GTAONode.js', libraries),
      loadAuthorThreeModule<{ ssr: TslFn }>('three/addons/tsl/display/SSRNode.js', libraries),
      loadAuthorThreeModule<{ fxaa: TslFn }>('three/addons/tsl/display/FXAANode.js', libraries),
    ])
    const renderer = new library.WebGPURenderer({ canvas: new OffscreenCanvas(1, 1), alpha: true, antialias: false, device })
    await runVideoEditGpuSection(device, async () => {
      // r186 初始化会赋值 onuncapturederror；宿主保有错误处理器的所有权，区段结束前恢复。
      const errors = device as GpuDevice & { onuncapturederror?: unknown }
      const previous = errors.onuncapturederror
      try { await renderer.init() } finally { errors.onuncapturederror = previous }
    })
    renderer.setClearColor(0, 0)
    // 作者灯光的 castShadow 要生效得先打开阴影；没有投影灯时不花额外的时间。
    const shadows = (renderer as unknown as { shadowMap: { enabled: boolean; type: number } }).shadowMap
    shadows.enabled = true
    shadows.type = library.PCFSoftShadowMap
    renderer.toneMapping = library.NoToneMapping
    renderer.outputColorSpace = library.LinearSRGBColorSpace
    return new VideoEditThreeSpace(library, tsl, { dof: dofModule.dof, motionBlur: blurModule.motionBlur, bloom: bloomModule.bloom, ao: aoModule.ao, ssr: ssrModule.ssr, fxaa: fxaaModule.fxaa }, renderer, new VideoEditAuthorThreeClock(renderer, library.REVISION), libraries)
  }

  /** 返回路径追踪是否还没收敛（其他显示方式恒为 false）。 */
  async render(input: ThreeSpaceFrame): Promise<{ refining: boolean }> {
    if (this.closed || this.failure) throw this.failure ?? new Error('统一三维渲染器已关闭。')
    input.assertCurrent()
    this.renders++
    this.previousWorld = new WeakMap()
    this.ensureTargets(input.target)
    this.syncCamera(input.frame, input.shutterOpen)
    this.syncCards(input)
    this.syncScenes(input.scenes)
    if (input.effects.display === 'render') {
      // 看片（有时间预算）换到新画面：追踪一批要上秒，先交实时画面，节目监视器随后再要这一帧时才开始追踪。
      const plan = input.trace, pending = plan?.key === undefined ? undefined : JSON.stringify([plan.group, plan.key])
      if (plan?.budgetMs !== undefined && pending !== undefined && !this.traceRequested.has(pending) && !(await this.tracer(plan.group)).accumulating(plan.key, input.target.width, input.target.height)) {
        this.traceRequested.add(pending)
        while (this.traceRequested.size > TRACE_GROUPS) this.traceRequested.delete(this.traceRequested.values().next().value!)
        await this.raster(input, { ...input.effects, display: 'realtime' })
        return { refining: true }
      }
      if (pending !== undefined) this.traceRequested.delete(pending)
      const traced = await this.trace(input)
      // 追踪器按块推进，第一遍没铺满整幅之前，没追到的地方是黑的：这时先交实时画面，继续追踪。
      if (traced.covered) return { refining: traced.refining }
      await this.raster(input, { ...input.effects, display: 'realtime' })
      return { refining: true }
    }
    if (this.pathTraces.size) await this.disposePathTraces()
    const display = input.effects.display
    await this.raster(input, { ...input.effects, display })
    return { refining: false }
  }

  private async raster(input: ThreeSpaceFrame, effects: ThreeSpaceFrame['effects'] & { display: 'realtime' | 'solid' | 'wireframe' }): Promise<void> {
    const entry = this.ensurePipeline(effects), pipeline = entry.pipeline
    for (const card of this.cards.values()) {
      if (!card.mesh.visible) continue
      const outputs = entry.emission ? card.outputs.emission : card.outputs.plain
      if (card.material.mrtNode !== outputs) { card.material.mrtNode = outputs; card.material.needsUpdate = true }
    }
    this.focus.value = effects.focusDistance
    this.cocScale.value = effects.cocScale
    this.cocMax.value = Math.max(1, effects.cocMax)
    this.shutterScale.value = effects.shutterScale
    this.bloom.value = effects.bloom
    this.ambientOcclusion.value = effects.ambientOcclusion
    this.reflections.value = effects.reflections
    this.lightOutput.value = input.light ? 1 : 0
    const target = this.target!, output = this.output!
    const restore = effects.display === 'realtime' ? this.applySceneOpacity(input.scenes) : this.applyDisplay(input.scenes, effects.display)
    try {
      if (!entry.primed) {
        // three 在第一次绘制时才搭节点图，那一帧里场景通道还没登记逐帧更新、什么也不画，同一帧号内也不会再更新：
        // 新建的管线先在单独一帧里空画一次，正式这一帧才有内容（否则导出、选帧的第一帧是空的）。
        await this.clock.run(input.scenes[0]?.time ?? input.frame.sequenceTime, () => guardVideoEditGpu(this.device, '三维渲染', () => {
          this.renderer.setRenderTarget(target); this.renderer.setOutputRenderTarget(target)
          try { pipeline.render() } finally { this.renderer.setOutputRenderTarget(null); this.renderer.setRenderTarget(null) }
        }))
        entry.primed = true
      }
      // 渲染失败（如提交里用到已销毁的资源）要让这一帧失败，而不是当成画好了交出去。
      await this.clock.run(input.scenes[0]?.time ?? input.frame.sequenceTime, () => guardVideoEditGpu(this.device, '三维渲染', () => {
        // 后处理的最后一步画到“输出渲染目标”，中间各步画到“当前渲染目标”：两个都指向本帧目标，否则最后一步会落到看不见的画布上。
        this.renderer.setRenderTarget(target)
        this.renderer.setOutputRenderTarget(target)
        try {
          pipeline.render()
          input.assertCurrent()
          this.renderer.copyTextureToTexture(target.texture, output.external)
        } finally { this.renderer.setOutputRenderTarget(null); this.renderer.setRenderTarget(null) }
      }))
    } finally { restore() }
  }

  private tracer(group: string): Promise<VideoEditThreeSpacePathTrace> {
    let tracer = this.pathTraces.get(group)
    if (tracer) { this.pathTraces.delete(group); this.pathTraces.set(group, tracer); return tracer }
    tracer = import('./videoEditThreeSpacePathTrace').then(module => module.VideoEditThreeSpacePathTrace.create(
      this.library as unknown as Parameters<typeof module.VideoEditThreeSpacePathTrace.create>[0], this.tsl as unknown as Parameters<typeof module.VideoEditThreeSpacePathTrace.create>[1],
      this.renderer as unknown as Parameters<typeof module.VideoEditThreeSpacePathTrace.create>[2], this.libraries))
    // 创建失败不留在表里，下次重新尝试。
    tracer.catch(() => { if (this.pathTraces.get(group) === tracer) this.pathTraces.delete(group) })
    this.pathTraces.set(group, tracer)
    while (this.pathTraces.size > TRACE_GROUPS) {
      const [oldest, entry] = this.pathTraces.entries().next().value!
      this.pathTraces.delete(oldest)
      void entry.then(value => value.dispose(), () => undefined)
    }
    return tracer
  }

  private async disposePathTraces(): Promise<void> {
    const tracers = [...this.pathTraces.values()]
    this.pathTraces.clear()
    await Promise.all(tracers.map(tracer => tracer.then(value => value.dispose(), () => undefined)))
  }

  private async trace(input: ThreeSpaceFrame): Promise<{ refining: boolean; covered: boolean }> {
    const plan = input.trace ?? { group: '', samples: TRACE_SAMPLES }
    const tracer = await this.tracer(plan.group)
    input.assertCurrent()
    const target = this.target!, output = this.output!, camera = this.camera, effects = input.effects
    // 光圈直径：实时景深的弥散半径 K·|z − S| / z（输出像素）对应薄透镜在对焦平面上的弥散直径 A·|z − S| / z，
    // 一个世界单位在对焦平面上占 宽 /(2·S·tan(水平视场 / 2)) 像素，所以 A = 4·K·S·tan(水平视场 / 2) / 宽。
    const halfWidth = Math.tan(camera.fov * Math.PI / 360) * camera.aspect
    const aperture = effects.depthOfField ? 4 * effects.cocScale * effects.focusDistance * halfWidth / input.target.width : 0
    const cards = input.cards.flatMap(card => {
      const entry = this.cards.get(card.clipId)
      return entry?.external && entry.mesh.visible ? [{ mesh: entry.mesh, texture: entry.external, width: card.width, height: card.height, opacity: card.opacity, light: card.light, emission: card.emission }] : []
    })
    const restore = this.applySceneOpacity(input.scenes)
    let refining = false
    try {
      await this.clock.run(input.scenes[0]?.time ?? input.frame.sequenceTime, async () => {
        refining = await tracer.render({ ...(plan.key === undefined ? {} : { key: plan.key }), scene: this.scene, camera, cards, aperture, focusDistance: effects.focusDistance,
          samples: plan.samples, ...(plan.budgetMs === undefined ? {} : { budgetMs: plan.budgetMs }), target, light: input.light, assertCurrent: input.assertCurrent })
        input.assertCurrent()
        try { await guardVideoEditGpu(this.device, '路径追踪', () => this.renderer.copyTextureToTexture(target.texture, output.external)) }
        finally { this.renderer.setRenderTarget(null) }
      })
    } finally { restore() }
    return { refining, covered: tracer.covered }
  }

  private ensureTargets(target: ThreeSpaceFrame['target']): void {
    const { library } = this
    if (!this.target || this.target.width !== target.width || this.target.height !== target.height) {
      this.target?.dispose()
      this.target = new library.RenderTarget(target.width, target.height, { type: library.HalfFloatType, depthBuffer: false })
      this.renderer.setSize(target.width, target.height, false)
    }
    if (this.output?.source !== target.texture) {
      this.output?.external.dispose()
      this.output = { source: target.texture, external: this.external(target.texture, target.width, target.height, true) }
    }
  }

  private external(texture: GpuTexture, width: number, height: number, half: boolean): Three.Texture {
    const { library } = this
    const external = new library.ExternalTexture(texture)
    external.image = { width, height }
    external.colorSpace = library.LinearSRGBColorSpace
    if (half) external.type = library.HalfFloatType
    external.generateMipmaps = false
    external.minFilter = library.LinearFilter
    return external
  }

  private syncCamera(frame: SpatialFrame, shutterOpen?: SpatialFrame): void {
    const camera = this.camera, view = frame.camera
    camera.matrixWorldInverse.fromArray(view.view as unknown as number[])
    camera.matrixWorld.copy(camera.matrixWorldInverse).invert()
    camera.matrix.copy(camera.matrixWorld)
    camera.matrix.decompose(camera.position, camera.quaternion, camera.scale)
    camera.up.fromArray(view.up as unknown as number[])
    camera.projectionMatrix.fromArray(view.projectionWebGpu as unknown as number[])
    camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert()
    camera.near = view.near; camera.far = view.far
    camera.fov = view.fovYRadians * 180 / Math.PI
    camera.aspect = frame.output.displayWidth / frame.output.displayHeight
    this.far.value = view.far
    // 快门开始时的相机：投影沿用本帧（远近面按本帧场景扩展），视角取那一刻的。
    const open = shutterOpen?.camera ?? view
    this.previousViewProjection.value.fromArray(view.projectionWebGpu as unknown as number[]).multiply(new this.library.Matrix4().fromArray(open.view as unknown as number[]))
  }

  private cardMatrix(geometry: SpatialCardGeometry): Three.Matrix4 {
    return new this.library.Matrix4().fromArray(geometry.uvToWorld as unknown as number[]).multiply(this.center)
  }

  private syncCards(input: ThreeSpaceFrame): void {
    const opened = new Map((input.shutterOpen?.cards ?? []).map(card => [card.clipId, card]))
    const shown = new Set<CardEntry>()
    for (const card of input.cards) {
      let entry = this.cards.get(card.clipId)
      if (entry && entry.light !== card.light) { this.dropCard(card.clipId, entry); entry = undefined }
      entry ??= this.createCard(card.clipId, card.light)
      if (entry.source !== card.texture) {
        entry.external?.dispose()
        entry.external = this.external(card.texture, card.width, card.height, false)
        entry.source = card.texture
        entry.map.value = entry.external
      }
      entry.used = this.renders
      entry.opacity.value = card.opacity
      entry.emission.value = card.emission
      entry.mesh.matrix.copy(this.cardMatrix(card.geometry))
      entry.mesh.matrixWorld.copy(entry.mesh.matrix)
      this.previousWorld.set(entry.mesh, this.cardMatrix(opened.get(card.clipId) ?? card.geometry))
      entry.mesh.visible = card.opacity > 0 && !card.geometry.behindCamera
      shown.add(entry)
    }
    for (const [clipId, entry] of this.cards) {
      if (shown.has(entry)) continue
      entry.mesh.visible = false
      if (this.renders - entry.used > CARD_IDLE_RENDERS) this.dropCard(clipId, entry)
    }
  }

  private dropCard(clipId: string, entry: CardEntry): void {
    this.scene.remove(entry.mesh); entry.material.dispose(); entry.external?.dispose(); this.cards.delete(clipId)
  }

  private createCard(clipId: string, light: boolean): CardEntry {
    const { library, tsl } = this
    const map = tsl.texture(new library.Texture())
    const opacity = tsl.uniform(1)
    const material = new library.MeshBasicNodeMaterial({ transparent: true, side: library.DoubleSide, depthWrite: true, toneMapped: false,
      premultipliedAlpha: true, blending: library.CustomBlending, blendSrc: library.OneFactor, blendDst: library.OneMinusSrcAlphaFactor,
      blendSrcAlpha: library.OneFactor, blendDstAlpha: library.OneMinusSrcAlphaFactor, alphaTest: light ? 0 : 1 / 512 })
    // 宿主纹理预乘且按 2.4 伽马编码：解预乘、解码到线性，再按预乘输出（混合 ONE / ONE_MINUS_SRC_ALPHA）。
    // 发光画面的 rgb 可大于 alpha（透明处也发光），按预乘逐通道解码，不解预乘也不丢弃。
    const alpha = map.a.mul(opacity)
    const emission = tsl.uniform(0)
    const base = light
      ? tsl.pow(tsl.max(map.rgb, tsl.vec3(0)), tsl.vec3(2.4)).mul(opacity)
      : tsl.pow(tsl.max(tsl.select(map.a.greaterThan(0), map.rgb.div(map.a), tsl.vec3(0)), tsl.vec3(0)), tsl.vec3(2.4)).mul(alpha)
    // 发光：画面原样不动（平面卡片不做色调映射），另加一层“额外光” = 画面线性色 × 发光强度，经色调映射后叠上去；
    // 发光强度 0 时与不发光逐像素相同，随强度连续变亮。额外光同时写进发光附件，单独扩成光晕。
    const extra = base.mul(emission)
    // 按直通色做色调映射再乘回覆盖率，半透明边缘随覆盖率线性变化；透明处带发光的画面按预乘逐通道（同上面的解码约定）。
    const mapped = light ? tsl.neutralToneMapping(extra, 1) : tsl.neutralToneMapping(extra.div(tsl.max(alpha, 1e-4)), 1).mul(alpha)
    material.colorNode = tsl.vec4(base.add(mapped), alpha)
    // 发光画面整块覆盖四边形：只在真有覆盖或发光的片元写深度、后处理属性与速度，背后的作者物体照常景深与色调映射。
    if (light) material.maskNode = map.a.add(map.rgb.r).add(map.rgb.g).add(map.rgb.b).greaterThan(1 / 512)
    // 平面卡片：跳过色调映射（r）与整幅景深、FXAA、遮蔽、反射（g）；按覆盖率混合（a），发光处整片算卡片。
    // 有没有发光附件随管线而定（序列里有片段发光时才有），两份多目标输出按当前管线切换（attachMrt）。
    const attr = tsl.vec4(1, 1, 0, light ? 1 : alpha)
    const outputs = { plain: tsl.mrt({ attr }), emission: tsl.mrt({ attr, emission: tsl.vec4(extra, alpha) }) }
    material.mrtNode = outputs.plain
    const mesh = new library.Mesh(this.quad, material)
    mesh.matrixAutoUpdate = false
    mesh.frustumCulled = false
    mesh.name = `card:${clipId}`
    this.scene.add(mesh)
    const entry: CardEntry = { mesh, material, light, map, opacity, emission, outputs, used: this.renders }
    this.cards.set(clipId, entry)
    return entry
  }

  private syncScenes(scenes: readonly ThreeSpaceScene[]): void {
    const next = new Set<Three.Object3D>(scenes.map(scene => scene.root))
    for (const root of this.attached) if (!next.has(root)) { this.scene.remove(root); this.attached.delete(root) }
    for (const root of next) if (!this.attached.has(root)) { this.scene.add(root); this.attached.add(root) }
    for (const scene of scenes) for (const [object, matrix] of scene.previous ?? []) this.previousWorld.set(object, matrix)
    // three 只读传给 render 的顶层场景的环境、背景与雾：从第一个设置了它们的作者场景同步过来。
    const authors = scenes.flatMap(scene => scene.root.children.filter(child => (child as Three.Scene).isScene)) as unknown as Array<Record<string, unknown>>
    const settings = this.scene as unknown as Record<string, unknown>
    for (const key of SCENE_SETTINGS) {
      const source = authors.find(scene => scene[key] !== null && scene[key] !== undefined)
      if (key.endsWith('Rotation')) { (settings[key] as Three.Euler).copy(source ? source[key] as Three.Euler : new this.library.Euler()); continue }
      settings[key] = source ? source[key] : key.endsWith('Intensity') ? 1 : key === 'backgroundBlurriness' ? 0 : null
    }
  }

  /** 世界场景片段的透明度与淡化：本次渲染期间乘到场景材质上，结束后还原（作者的材质对象不被持久改动）。 */
  private applySceneOpacity(scenes: readonly ThreeSpaceScene[]): () => void {
    const saved = new Map<Three.Material, { opacity: number; transparent: boolean; depthWrite: boolean }>()
    for (const scene of scenes) {
      if (scene.opacity >= 1) continue
      scene.root.traverse(object => {
        const material = (object as Three.Mesh).material
        for (const item of material ? Array.isArray(material) ? material : [material] : []) {
          if (saved.has(item)) continue
          saved.set(item, { opacity: item.opacity, transparent: item.transparent, depthWrite: item.depthWrite })
          item.opacity *= scene.opacity
          item.transparent = true
          // 淡化中的场景不写深度：否则透明到几乎看不见时仍挡住身后的卡片与物体。
          item.depthWrite = false
        }
      })
    }
    return () => { for (const [material, value] of saved) { material.opacity = value.opacity; material.transparent = value.transparent; material.depthWrite = value.depthWrite } }
  }

  /** 实体、线框：本次渲染期间把作者网格换成统一材质，结束后换回。 */
  private applyDisplay(scenes: readonly ThreeSpaceScene[], display: 'solid' | 'wireframe'): () => void {
    const { library } = this
    if (!this.overrides) {
      // 灰色材质捕捉贴图：左上方来光的球面明暗，不依赖场景灯光。
      const size = 64, pixels = new Uint8Array(size * size * 4)
      const light = [-.45, .55, .7], norm = Math.hypot(...light)
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const nx = (x + .5) / size * 2 - 1, ny = 1 - (y + .5) / size * 2, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny))
        const shade = Math.round(255 * Math.min(1, .28 + .62 * Math.max(0, (nx * light[0] + ny * light[1] + nz * light[2]) / norm)))
        pixels.set([shade, shade, shade, 255], (y * size + x) * 4)
      }
      const matcap = new library.DataTexture(pixels, size, size)
      matcap.colorSpace = library.SRGBColorSpace; matcap.needsUpdate = true
      this.overrides = {
        solid: new library.MeshMatcapNodeMaterial({ matcap, side: library.DoubleSide }),
        wireframe: new library.MeshBasicNodeMaterial({ color: 0xb8b8b8, wireframe: true }),
      }
    }
    const override = this.overrides[display]
    const saved = new Map<Three.Mesh, Three.Mesh['material']>()
    // 统一材质不带透明度：淡出过半的场景直接不画，免得透明场景显示成不透明灰体、挡住身后的卡片。
    const hidden = scenes.filter(scene => scene.opacity < .5 && scene.root.visible)
    for (const scene of hidden) scene.root.visible = false
    for (const scene of scenes) if (!hidden.includes(scene)) scene.root.traverse(object => {
      const mesh = object as Three.Mesh
      if (!mesh.isMesh || (mesh as unknown as { isSprite?: boolean }).isSprite) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (materials.some(material => (material as unknown as { positionNode?: unknown }).positionNode)) return
      saved.set(mesh, mesh.material); mesh.material = override
    })
    return () => {
      for (const [mesh, material] of saved) mesh.material = material
      for (const scene of hidden) scene.root.visible = true
    }
  }

  private ensurePipeline(effects: ThreeSpaceEffects): { pipeline: RenderPipeline; primed: boolean; emission: boolean } {
    if (effects.display !== 'realtime') effects = { ...effects, motionBlur: false, depthOfField: false, bloom: 0, ambientOcclusion: 0, reflections: 0, emission: false }
    // 强度是每帧更新的均匀量，管线只按开关组合缓存。
    const key = JSON.stringify([effects.motionBlur, effects.depthOfField, effects.bloom > 0, effects.ambientOcclusion > 0, effects.reflections > 0, effects.emission])
    const cached = this.pipelines.get(key)
    if (cached) { this.pipelines.delete(key); this.pipelines.set(key, cached); return cached }
    // 按最近使用只淘汰最久没用的那套，不整表释放：换显示方式时仍在用的那套不必重建、重新编译着色器。
    if (this.pipelines.size >= PIPELINE_SETS) {
      const [oldest, entry] = this.pipelines.entries().next().value!
      this.pipelines.delete(oldest)
      this.disposePipeline(entry)
    }
    const nodes: Array<{ dispose(): void }> = []
    const { tsl, library } = this
    const scenePass = tsl.pass(this.scene, this.camera, { samples: 4 })
    nodes.push(scenePass)
    // 只声明后处理会读的输出：three 只给被读取的输出建纹理，声明了却没读会让绘制管线校验失败。
    const surfaces = effects.ambientOcclusion > 0 || effects.reflections > 0
    // 后处理属性 attr：r = 跳过色调映射，g = 跳过整幅景深、FXAA、遮蔽与反射（平面卡片两样都跳过）。
    // three 的多目标输出里 output 以外的附件缺省不混合（最后写入者赢），半透明文字边缘会让后面的作者物体整像素被当成卡片；
    // attr 改为按覆盖率普通混合：rgb 累积卡片的覆盖率，a 累积总覆盖率（普通混合的 alpha 正是叠加后的覆盖率），
    // 两者相除才是“这个像素的颜色里卡片占多少”——半透明卡片叠在空白处时仍完全按卡片处理，叠在物体上时按比例。作者物体写 0。
    const attributes = tsl.mrt({ output: tsl.output, attr: tsl.vec4(0, 0, 0, tsl.output.a), ...effects.motionBlur ? { velocity: this.velocity } : {},
      // 发光附件：卡片写“额外光”（预乘），作者物体写 0 与自身覆盖率，挡在发光字前面的物体会遮住它的光晕。
      ...effects.emission ? { emission: tsl.vec4(0, 0, 0, tsl.output.a) } : {} }) as TslNode & { setBlendMode(name: string, mode: unknown): void; setClearColor(name: string, color: number, alpha: number): void }
    attributes.setBlendMode('attr', new library.BlendMode(library.NormalBlending))
    // 清成全透明：总覆盖率从 0 开始累积（缺省清屏透明度是 1）。
    attributes.setClearColor('attr', 0, 0)
    if (effects.emission) {
      const over = new library.BlendMode(library.NormalBlending) as { premultiplyAlpha: boolean; premultipliedAlpha?: boolean }
      // 预乘叠加；three 的混合换算读的是 premultipliedAlpha，BlendMode 自己的字段叫 premultiplyAlpha，两个都设上。
      over.premultiplyAlpha = over.premultipliedAlpha = true
      attributes.setBlendMode('emission', over)
      attributes.setClearColor('emission', 0, 0)
    }
    scenePass.setMRT(attributes)
    // 8 位就够（多目标输出每样本字节数有上限，rgba8 也按 8 字节计）。
    scenePass.getTexture('attr').type = library.UnsignedByteType
    const attr = scenePass.getTextureNode('attr'), total = tsl.max(attr.a, 1e-4), flat = attr.r.div(total), still = attr.g.div(total)
    let color = scenePass.getTextureNode('output')
    // 环境光遮蔽与反射只加在作者物体上：卡片是已经画好的画面，不该被压暗或叠上反射。
    const objects = tsl.float(1).sub(still)
    if (surfaces) {
      // 遮蔽与反射要读不带多重采样的深度与法线：另画一遍只出法线（与金属度粗糙度）的预通道，主通道照旧多重采样抗锯齿。
      const prePass = tsl.pass(this.scene, this.camera) as TslPass & { transparent: boolean }
      // 只画不透明物体：发光粒子、光晕这类透明面若写进法线，会被当成实体压出一块黑影。
      prePass.transparent = false
      nodes.push(prePass)
      prePass.setMRT(tsl.mrt({ output: tsl.packNormalToRGB(tsl.normalView), ...effects.reflections > 0 ? { metalrough: tsl.vec2(tsl.metalness, tsl.roughness) } : {} }))
      prePass.getTexture('output').type = library.UnsignedByteType
      if (effects.reflections > 0) prePass.getTexture('metalrough').type = library.UnsignedByteType
      const depth = prePass.getTextureNode('depth'), normalTexture = prePass.getTextureNode('output')
      const normal = tsl.sample(coord => tsl.unpackRGBToNormal(normalTexture.sample(coord)))
      if (effects.ambientOcclusion > 0) {
        const occlusion = this.post.ao(depth, normal, this.camera) as TslNode & { resolutionScale: number; getTextureNode(): TslNode }
        // 半分辨率算遮蔽：软阴影本身就低频，省一半以上的时间。
        occlusion.resolutionScale = .5
        nodes.push(occlusion as unknown as { dispose(): void })
        color = tsl.vec4(color.rgb.mul(tsl.mix(tsl.float(1), occlusion.getTextureNode().r, this.ambientOcclusion.mul(objects))), color.a)
      }
      if (effects.reflections > 0) {
        const metalrough = prePass.getTextureNode('metalrough')
        const reflected = this.post.ssr(scenePass.getTextureNode('output'), depth, normal, { metalnessNode: metalrough.r, roughnessNode: metalrough.g, camera: this.camera } as unknown as TslNode) as TslNode & { resolutionScale: number }
        reflected.resolutionScale = .5
        nodes.push(reflected as unknown as { dispose(): void })
        color = tsl.vec4(color.rgb.add(reflected.rgb.mul(reflected.a).mul(this.reflections).mul(objects)), color.a)
      }
    }
    if (effects.depthOfField) {
      // 景深看深度归谁，不看颜色占比：卡片写深度，像素里只要有卡片覆盖，深度就是那张已由宿主预虚化的卡片的，
      // 按占比混合会用卡片的弥散半径把它身后的物体连同卡片再虚化一遍（失焦标题的光晕边缘出硬圈）。
      const viewZ = this.opticalViewZ(scenePass.getViewZNode(), attr.g.greaterThan(.5 / 255))
      // 景深节点把弥散半径存在 alpha 里、输出 alpha 恒为 1：预乘颜色与覆盖率各做一遍同样的景深再合起来，透明处才不变黑。
      const blurred = this.post.dof(tsl.vec4(color.rgb, 1), viewZ, this.focus, 1, this.cocMax)
      const coverage = this.post.dof(tsl.vec4(tsl.vec3(color.a), 1), viewZ, this.focus, 1, this.cocMax)
      nodes.push(blurred as unknown as { dispose(): void }, coverage as unknown as { dispose(): void })
      color = tsl.vec4(blurred.rgb, coverage.r)
    }
    if (effects.motionBlur) {
      // 速度是本帧与快门开始的标准化设备坐标差，即半个快门的位移（跨度 2、y 向上）；整段快门 = 两倍，换到画面坐标再乘 0.5 并翻转 y。
      const source = tsl.convertToTexture(color)
      nodes.push(source as unknown as { dispose(): void })
      color = this.post.motionBlur(source, scenePass.getTextureNode('velocity').xy.mul(tsl.vec2(this.shutterScale, this.shutterScale.negate())))
    }
    if (effects.bloom > 0) {
      // 泛光在景深与运动模糊之后：模糊掉的高光一样发光；亮度超过阈值的部分才扩散，暗处不变。辉光落在透明处时是透明度为 0 的发光。
      const glow = this.post.bloom(color, this.bloom, .45, .75)
      nodes.push(glow as unknown as { dispose(): void })
      color = tsl.vec4(color.rgb.add(glow.rgb), color.a)
    }
    if (effects.emission) {
      // 片段发光自带光晕，不依赖序列泛光：发光附件只含“额外光”，阈值 0（发光的部分全部是光），强度由发光强度本身决定。
      const glow = this.post.bloom(scenePass.getTextureNode('emission'), .5, .3, 0)
      nodes.push(glow as unknown as { dispose(): void })
      color = tsl.vec4(color.rgb.add(glow.rgb), color.a)
    }
    // 输出回宿主工作空间：作者物体做中性色调映射，卡片不做；线性 → 2.4 伽马编码。编码约定跟随组画面是否“带发光”（宿主按它解码）：
    // 带发光的画面宿主按预乘逐通道解码，就按预乘逐通道映射与编码（半透明的光晕、辉光处若先解预乘再编码，解码后会变暗一圈）；
    // 不带发光的按“解预乘 → 编码 → 乘回透明度”。不透明与全透明像素两种约定结果相同。
    const alpha = tsl.clamp(color.a, 0, 1)
    const covered = color.a.greaterThan(1e-5)
    const straight = tsl.select(covered, color.rgb.div(color.a), color.rgb)
    const mapped = tsl.mix(tsl.neutralToneMapping(straight, 1), straight, flat)
    const encoded = tsl.pow(tsl.max(mapped, tsl.vec3(0)), tsl.vec3(1 / 2.4))
    const lightEncoded = tsl.pow(tsl.max(tsl.mix(tsl.neutralToneMapping(color.rgb, 1), color.rgb, flat), tsl.vec3(0)), tsl.vec3(1 / 2.4))
    const pipeline = new library.RenderPipeline(this.renderer)
    const output = tsl.convertToTexture(tsl.vec4(tsl.select(this.lightOutput.greaterThan(.5), lightEncoded, tsl.select(covered, encoded.mul(alpha), encoded)), alpha))
    nodes.push(output as unknown as { dispose(): void })
    // 多重采样只抹平几何轮廓，而且是在色调映射前按线性亮度平均：强高光贴着暗处时平均完仍过亮、边缘照样硬；
    // 细高光这类着色锯齿它也管不到。所以在编码后的画面上再做一遍 FXAA（SMAA 要在 Worker 里加载图片，用不了）。
    // 卡片是已经画好、抗过锯齿的画面，不再处理，免得文字被抹软。
    pipeline.outputNode = tsl.mix(this.post.fxaa(output), output, still)
    pipeline.outputColorTransform = false
    const entry = { pipeline, nodes, primed: false, emission: effects.emission }
    this.pipelines.set(key, entry)
    return entry
  }

  private disposePipeline({ pipeline, nodes }: { pipeline: RenderPipeline; nodes: Array<{ dispose(): void }> }): void {
    for (const node of nodes) if (typeof node?.dispose === 'function') node.dispose()
    pipeline.dispose()
  }

  private disposePipelines(): void {
    for (const entry of this.pipelines.values()) this.disposePipeline(entry)
    this.pipelines.clear()
  }

  /**
   * three 的景深节点按 smoothstep(0, 范围, |距离 − 焦距|) 算虚化程度、乘虚化尺度得到像素半径；真实镜头的弥散半径是 K·|z − S| / z。
   * 交给节点一个等效视深：先按光学公式求像素半径、除以上限得到虚化程度，再用 smoothstep 的反函数换成离焦距离（范围取 1），
   * 节点算出的半径就与光学公式一致。
   */
  private opticalViewZ(viewZ: TslNode, card: TslNode): TslNode {
    const { tsl } = this
    const depth = viewZ.negate()
    // 没画到东西的像素深度停在远裁剪面、卡片已整张虚化过：都按对焦处理，远景虚化才不会把卡片颜色吸进空白处。
    const empty = tsl.select(depth.greaterThan(this.far.mul(.999)), 1, card)
    const signed = tsl.select(empty, 0, depth.sub(this.focus).div(tsl.max(depth, 1e-4)).mul(this.cocScale))
    const amount = tsl.clamp(signed.abs().div(this.cocMax), 0, 1)
    // smoothstep 的反函数：y = 3x² − 2x³ ⇒ x = 0.5 − sin(asin(1 − 2y) / 3)。
    const offset = tsl.float(.5).sub(tsl.sin(tsl.asin(tsl.float(1).sub(amount.mul(2))).div(3)))
    return this.focus.add(tsl.sign(signed).mul(offset)).negate()
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.clock.stop()
    for (const root of this.attached) this.scene.remove(root)
    this.attached.clear()
    for (const [clipId, entry] of this.cards) this.dropCard(clipId, entry)
    this.quad.dispose()
    this.disposePipelines()
    await this.disposePathTraces()
    if (this.overrides) for (const material of Object.values(this.overrides)) { (material as unknown as { matcap?: Three.Texture }).matcap?.dispose(); material.dispose() }
    this.target?.dispose()
    this.output?.external.dispose()
    await this.renderer.dispose()
  }
}
