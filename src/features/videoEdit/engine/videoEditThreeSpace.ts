import type * as Three from 'three'
import { videoEditToneMapping } from './videoEditToneMapping'
import { videoEditSpaceEnvironment } from './videoEditSpaceEnvironment'
import { VideoEditSolidCards, type SolidSurface } from './videoEditThreeSpaceSolid'
import { isSpaceGlassMaterial, markSpaceSharedTexture, spaceGlassShared, spacePathTraceReplacement, type SpaceGlassShared } from './videoEditSpaceMaterials'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { AuthorLibraryVersions } from '@/core/videoEdit/codeMaterial/authorLibraries'
import type { SpatialCardGeometry, SpatialFrame } from '@/core/videoEdit/spatialTypes'
import type { VideoEditSpaceRenderDisplay } from '@/core/videoEdit/spaceDisplay'
import { loadAuthorThreeLibrary, loadAuthorThreeModule, type AuthorThreeLibrary } from './videoEditAuthorThreeWebGpu'
import { VideoEditAuthorThreeClock } from './videoEditAuthorThreeClock'
import type { VideoEditThreeSpacePathTrace } from './videoEditThreeSpacePathTrace'
import { runVideoEditGpuSection } from './videoEditGpuRootQueue'
import { guardVideoEditThree, observeThreePipelines } from './videoEditThreePipelineProbe'

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
  /** 实体卡片（受光、非画面材质或有厚度）的表面设置；缺省为平面画面卡片。 */
  surface?: SolidSurface
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
  /** 泛光阈值与范围（序列三维设置，缺省 0.75 与 0.45）。 */
  bloomThreshold: number
  bloomRadius: number
  ambientOcclusion: number
  reflections: number
  /** 屏幕空间全局光照强度（序列三维设置，0 为不开）：画面里看得到的亮面把自身颜色反弹到周围物体上（色溢、暗部补光）。 */
  globalIllumination: number
  /** 序列里有片段发光（整段任意时刻）：管线多一个发光附件，发光不依赖序列泛光开关也会扩成光晕。 */
  emission: boolean
  /** 三维物体的曝光（EV）与色调映射（序列三维设置）；卡片不做色调映射，不受影响。 */
  exposure: number
  toneMapping: import('@/core/videoEdit/document').VideoEditSpaceToneMapping
  /** 序列三维环境光预设、强度与水平旋转（度）；作者场景自己设了环境时以作者为准。 */
  environment: import('@/core/videoEdit/document').VideoEditSpaceEnvironment
  environmentIntensity: number
  environmentRotation: number
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
  /**
   * 组下方已经合成好的画面（宿主纹理，预乘、2.4 伽马，与目标同尺寸）：组里有透射材质（玻璃）时才给，玻璃透过去看到它。
   * `light` 与卡片同义（rgb 可大于 alpha）。输出里会扣掉它，宿主照常把组画面叠在下方画面上。
   */
  below?: { texture: GpuTexture; width: number; height: number; light: boolean }
  /** 成片（导出、选帧）：实体卡片的轮廓要等读回完成再画；看片时先按平面画、读回后再精确。 */
  exact?: boolean
  /** 时间线灯光片段（含缺省布光的主光）：照亮本组受光的三维内容，路径追踪读同一批灯。 */
  lights?: readonly import('@/core/videoEdit/spatialLights').SpatialLight[]
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
/** 追踪器闲置多久后释放（毫秒）。 */
const TRACE_IDLE_RELEASE_MS = 30_000
/** 后处理管线按最近使用保留的套数：每套都占着全分辨率的多重采样目标（4K 下近 1GB），同一份作品只用到实时与一种简化组合。 */
const PIPELINE_SETS = 2
/**
 * 发光卡片照亮周围（实时）用的面光源槽数：固定数量、不用时强度为 0，灯数不变就不会重编译着色器。
 * 选型：屏幕空间全局光照要靠多帧时间累积去噪，成片逐帧确定不了；面光源确定、便宜，代价是只有矩形、最多这么多张、不投影。
 */
const AREA_LIGHT_SLOTS = 8
/**
 * 屏幕空间全局光照的采样与内部分辨率：4K 下 2 个方向 × 8 步、半分辨率求值，整条实时管线仍在 60 帧以内（实测见 docs/task/三维画质）。
 * 反弹光本身低频，半分辨率经保边降噪后与全分辨率看不出差别。
 */
const SSGI_SLICES = 4
const SSGI_STEPS = 12
/** 降噪的采样半径（像素）与深度容差（沿法线的视空间距离，世界单位约为画面高度）：只在同一表面上平均，不把颜色抹过物体边缘。 */
const SSGI_DENOISE_RADIUS = 12
const SSGI_DENOISE_DEPTH = .1
const SSGI_SCALE = .5

/**
 * three 的降噪节点用 SimplexNoise（Math.random 打乱排列表）生成旋转采样的噪声图，每次新建都不同：换成固定种子的同尺寸噪声，
 * 同一帧在预览、导出与下一次打开时降噪结果一致。
 */
function deterministicDenoiseNoise(node: object): void {
  const texture = (node as { _noiseTexture?: { image: { data: Uint8Array }; needsUpdate: boolean } })._noiseTexture
  if (!texture) return
  let seed = 0x9e3779b9
  const data = texture.image.data
  for (let index = 0; index < data.length; index++) {
    // mulberry32
    seed = (seed + 0x6d2b79f5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), seed | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    data[index] = ((value ^ (value >>> 14)) >>> 0) & 0xff
  }
  texture.needsUpdate = true
}

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
  sin: TslFn; asin: TslFn; sign: TslFn; float: TslFn; neutralToneMapping: TslFn; agxToneMapping: TslFn; acesFilmicToneMapping: TslFn; textureLoad: TslFn; ivec2: TslFn
  diffuseColor: TslNode
  viewportOpaqueMipTexture(): TslNode & { referenceNode: unknown }
  screenCoordinate: TslNode; screenUV: TslNode; floor: TslFn; min: TslFn
  packNormalToRGB: TslFn; unpackRGBToNormal: TslFn; sample(fn: (coord: TslNode) => TslNode): TslNode
  normalView: TslNode; metalness: TslNode; roughness: TslNode
  mrt(outputs: Record<string, TslNode>): TslNode
  pass(scene: Three.Scene, camera: Three.Camera, options?: Record<string, unknown>): TslPass
  output: TslNode; positionLocal: TslNode; modelViewMatrix: TslNode; cameraProjectionMatrix: TslNode; positionGeometry: TslNode
}
interface SsgiNode extends TslNode {
  sliceCount: { value: number }; stepCount: { value: number }; giIntensity: { value: number }; radius: { value: number }; thickness: { value: number }
  useTemporalFiltering: boolean; getGINode(): TslNode; setSize(width: number, height: number): void; dispose(): void
  updateBefore(frame: { renderer: { setClearColor(color: number, alpha: number): void } }): unknown
}
type SsgiClass = new (beauty: TslNode, depth: TslNode, normal: TslNode, camera: Three.Camera) => SsgiNode
interface PostNodes { dof: TslFn; motionBlur: TslFn; bloom: TslFn; ao: TslFn; ssr: TslFn; fxaa: TslFn; ssgi: SsgiClass; denoise: TslFn }
interface NodeMaterial extends Three.Material { colorNode: TslNode | null; mrtNode: TslNode | null; maskNode: TslNode | null; vertexNode?: TslNode | null }
interface RenderPipeline { outputNode: TslNode; outputColorTransform: boolean; render(): void; dispose(): void }
type Library = AuthorThreeLibrary & {
  MeshBasicNodeMaterial: new (parameters: Record<string, unknown>) => NodeMaterial
  MeshMatcapNodeMaterial: new (parameters: Record<string, unknown>) => NodeMaterial
  RenderPipeline: new (renderer: unknown) => RenderPipeline
  BlendMode: new (blending: number) => unknown
  QuadMesh: new (material: NodeMaterial) => { render(renderer: unknown): void }
  ViewportTextureNode: { prototype: { getUpdateBeforeType(this: { referenceNode?: unknown }, frame: unknown): string } }
  NodeUpdateType: { OBJECT: string }
}
interface AreaLightSlot {
  light: Three.RectAreaLight
  target: Three.RenderTarget
  source: TslUniform<Three.Texture>
  glow: TslUniform<number>
  strength: TslUniform<number>
  quad: { render(renderer: unknown): void }
  material: Three.Material
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
  private readonly pipelines = new Map<string, { pipeline: RenderPipeline; nodes: Array<{ dispose(): void }>; primed: boolean; emission: boolean; bloom?: { threshold: { value: number }; radius: { value: number } } }>()
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
  /** 曝光倍数 2^EV。 */
  private readonly exposure: TslUniform<number>
  private readonly ambientOcclusion: TslUniform<number>
  private readonly reflections: TslUniform<number>
  private readonly globalIllumination: TslUniform<number>
  /** 这一组画面是否带发光（宿主按预乘逐通道解码）；决定输出的编码约定。 */
  private readonly lightOutput: TslUniform<number>
  private readonly velocity: TslNode
  private failure?: Error
  private closed = false
  /** 各空间组的追踪器；切到其他显示方式时全部释放（它们的累积目标与加速结构很占显存）。 */
  /** 卡片那一层里透明材质的只写深度副本（按作者材质，随它释放）。 */
  private readonly depthOnlyCopies = new WeakMap<Three.Material, { copy: Three.Material; version: number }>()
  /** three 正面透射采样的那张帧缓冲拷贝（单例节点）。 */
  private transmissionBackdrop?: unknown
  /** 渲染方式混合合成时暂存的路径追踪那一层。 */
  private traceLayerTarget?: Three.RenderTarget
  private underlay?: { source: TslNode & { value: Three.Texture }; quad: { render(renderer: unknown): void } }
  /**
   * 下方画面：铺满画面、在最远处的背景面（rgb = 下方画面的线性预乘色、alpha = 0），透射材质透过去看到它；
   * 场景通道一出来就按 内容 = C − (1 − A)·B 扣掉，组画面仍只含组自己的内容。路径追踪里它是一张 matte 发光背板。
   */
  private readonly belowMap: TslUniform<Three.Texture>
  private readonly belowLight: TslUniform<number>
  private readonly belowOn: TslUniform<number>
  private readonly belowSize: TslNode & { value: Three.Vector2 }
  private readonly belowPlaceholder: Three.Texture
  /** 实体卡片（受光、材质、厚度）的材质、挤出体与轮廓缓存。 */
  private readonly solid: VideoEditSolidCards
  private belowEntry?: { mesh: Three.Mesh; source?: GpuTexture; external?: Three.Texture; backplate: Three.Mesh }
  /**
   * 发光卡片的面光源：颜色 = 卡片画面的平均线性预乘色（每帧在显卡上归约到 1×1，不读回）× 发光强度，
   * 尺寸与朝向取卡片本身，朝场景物体那一侧发光。只照亮作者物体（卡片自己不受光）；路径追踪里卡片本身就是发光面，这些灯关掉。
   */
  private areaLights?: Promise<AreaLightSlot[]>
  /** 灯光片段对应的 three 灯（按片段，种类变了就换一盏）。灯数变化会让受光材质重编译一次，灯光片段通常不频繁增减。 */
  private readonly timelineLights = new Map<string, { kind: string; light: Three.Light; target?: Three.Object3D }>()
  private ltcReady?: Promise<void>
  /** 实心玻璃的背面通道：玻璃网格单独画一遍背面，记下视空间法线与视深，正面折射时读它求出穿过的距离与出射法线。 */
  private glassBack?: { target: Three.RenderTarget; camera: Three.PerspectiveCamera; material: Three.Material; shared: SpaceGlassShared }

  private traceLayer(width: number, height: number): Three.RenderTarget {
    if (!this.traceLayerTarget || this.traceLayerTarget.width !== width || this.traceLayerTarget.height !== height) {
      this.traceLayerTarget?.dispose()
      this.traceLayerTarget = new this.library.RenderTarget(width, height, { type: this.library.HalfFloatType, depthBuffer: false })
    }
    return this.traceLayerTarget
  }

  /** 看片时已先交过实时画面、下一次要开始追踪的画面（每组一项）。 */
  private readonly traceRequested = new Set<string>()
  private lastTraceAt = -Infinity
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
    this.exposure = tsl.uniform(1)
    this.ambientOcclusion = tsl.uniform(0)
    this.reflections = tsl.uniform(0)
    this.globalIllumination = tsl.uniform(0)
    this.lightOutput = tsl.uniform(0)
    this.solid = new VideoEditSolidCards(library as never, tsl as never, renderer as never, this.quad)
    this.belowPlaceholder = new library.Texture()
    this.belowMap = tsl.texture(this.belowPlaceholder)
    this.belowSize = (tsl as unknown as { uniform(value: Three.Vector2): TslNode & { value: Three.Vector2 } }).uniform(new library.Vector2(1, 1))
    this.belowLight = tsl.uniform(0)
    this.belowOn = tsl.uniform(0)
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
    const [library, tsl, dofModule, blurModule, bloomModule, aoModule, ssrModule, fxaaModule, ssgiModule, denoiseModule] = await Promise.all([
      loadAuthorThreeLibrary(libraries) as Promise<Library>,
      loadAuthorThreeModule<Tsl>('three/tsl', libraries),
      loadAuthorThreeModule<{ dof: TslFn }>('three/addons/tsl/display/DepthOfFieldNode.js', libraries),
      loadAuthorThreeModule<{ motionBlur: TslFn }>('three/addons/tsl/display/MotionBlur.js', libraries),
      loadAuthorThreeModule<{ bloom: TslFn }>('three/addons/tsl/display/BloomNode.js', libraries),
      loadAuthorThreeModule<{ ao: TslFn }>('three/addons/tsl/display/GTAONode.js', libraries),
      loadAuthorThreeModule<{ ssr: TslFn }>('three/addons/tsl/display/SSRNode.js', libraries),
      loadAuthorThreeModule<{ fxaa: TslFn }>('three/addons/tsl/display/FXAANode.js', libraries),
      loadAuthorThreeModule<{ default: SsgiClass }>('three/addons/tsl/display/SSGINode.js', libraries),
      loadAuthorThreeModule<{ denoise: TslFn }>('three/addons/tsl/display/DenoiseNode.js', libraries),
    ])
    const renderer = new library.WebGPURenderer({ canvas: new OffscreenCanvas(1, 1), alpha: true, antialias: false, device })
    await runVideoEditGpuSection(device, async () => {
      // r186 初始化会赋值 onuncapturederror；宿主保有错误处理器的所有权，区段结束前恢复。
      const errors = device as GpuDevice & { onuncapturederror?: unknown }
      const previous = errors.onuncapturederror
      try { await renderer.init() } finally { errors.onuncapturederror = previous }
    })
    observeThreePipelines(renderer)
    renderer.setClearColor(0, 0)
    // 作者灯光的 castShadow 要生效得先打开阴影；没有投影灯时不花额外的时间。
    const shadows = (renderer as unknown as { shadowMap: { enabled: boolean; type: number } }).shadowMap
    shadows.enabled = true
    shadows.type = library.PCFSoftShadowMap
    renderer.toneMapping = library.NoToneMapping
    renderer.outputColorSpace = library.LinearSRGBColorSpace
    return new VideoEditThreeSpace(library, tsl, { dof: dofModule.dof, motionBlur: blurModule.motionBlur, bloom: bloomModule.bloom, ao: aoModule.ao, ssr: ssrModule.ssr, fxaa: fxaaModule.fxaa,
      ssgi: ssgiModule.default, denoise: denoiseModule.denoise }, renderer, new VideoEditAuthorThreeClock(renderer, library.REVISION), libraries)
  }

  /** 返回路径追踪是否还没收敛（其他显示方式恒为 false）。 */
  /** `progress`：渲染显示方式下路径追踪的进度（0–1），没在追踪时缺省。 */
  async render(input: ThreeSpaceFrame): Promise<{ refining: boolean; progress?: number }> {
    if (this.closed || this.failure) throw this.failure ?? new Error('统一三维渲染器已关闭。')
    input.assertCurrent()
    this.renders++
    this.previousWorld = new WeakMap()
    this.ensureTargets(input.target)
    this.syncCamera(input.frame, input.shutterOpen)
    const approximate = await this.syncCards(input)
    this.syncScenes(input.scenes, input.effects)
    await this.syncTimelineLights(input.lights ?? [])
    if (input.effects.display === 'render') {
      this.lastTraceAt = performance.now()
      // 看片（有时间预算）换到新画面：追踪一批要上秒，先交实时画面，节目监视器随后再要这一帧时才开始追踪。
      const plan = input.trace, pending = plan?.key === undefined ? undefined : JSON.stringify([plan.group, plan.key])
      if (plan?.budgetMs !== undefined && pending !== undefined && !this.traceRequested.has(pending) && !(await this.tracer(plan.group)).accumulating(plan.key, input.target.width, input.target.height)) {
        this.traceRequested.add(pending)
        while (this.traceRequested.size > TRACE_GROUPS) this.traceRequested.delete(this.traceRequested.values().next().value!)
        await this.raster(input, { ...input.effects, display: 'realtime' })
        return { refining: true, progress: 0 }
      }
      if (pending !== undefined) this.traceRequested.delete(pending)
      const traced = await this.trace(input)
      // 追踪器按块推进，第一遍没铺满整幅之前，没追到的地方是黑的：这时先交实时画面，继续追踪。
      if (traced.covered) return { refining: traced.refining, progress: traced.progress }
      await this.raster(input, { ...input.effects, display: 'realtime' })
      return { refining: true, progress: 0 }
    }
    // 渲染显示方式下拖动、播放时交实时画面，停稳又接着追踪：追踪器（加速结构、贴图图集、降噪网络）留着复用，闲置一阵才释放显存。
    if (this.pathTraces.size && performance.now() - this.lastTraceAt > TRACE_IDLE_RELEASE_MS) await this.disposePathTraces()
    const display = input.effects.display
    await this.raster(input, { ...input.effects, display })
    // 实体卡片的轮廓还没读回（先按平面画了）：告诉宿主再要一次这一帧。
    return { refining: approximate }
  }

  /**
   * `cardsOnly`：只画卡片（作者物体只写深度、照样遮挡卡片），再把 `underlay`（路径追踪的结果，卡片处透明）相加叠上，
   * 即渲染方式的混合合成：卡片与实时、二维逐像素一致，物体是路径追踪的光影。
   */
  private async raster(input: ThreeSpaceFrame, effects: ThreeSpaceFrame['effects'] & { display: 'realtime' | 'solid' | 'wireframe' }, options: { cardsOnly?: boolean; underlay?: Three.Texture } = {}): Promise<void> {
    const entry = this.ensurePipeline(effects), pipeline = entry.pipeline
    for (const card of this.cards.values()) {
      if (!card.mesh.visible) continue
      const outputs = entry.emission ? card.outputs.emission : card.outputs.plain
      if (card.material.mrtNode !== outputs) { card.material.mrtNode = outputs; card.material.needsUpdate = true }
    }
    // 在平面卡片换好本管线的那一份输出之后：未受光实体的副本跟着原件走。
    this.solid.syncOutputs(entry.emission)
    this.focus.value = effects.focusDistance
    this.cocScale.value = effects.cocScale
    this.cocMax.value = Math.max(1, effects.cocMax)
    this.shutterScale.value = effects.shutterScale
    this.bloom.value = effects.bloom
    if (entry.bloom) { entry.bloom.threshold.value = effects.bloomThreshold; entry.bloom.radius.value = effects.bloomRadius }
    // 实体、线框是看结构用的统一明暗，不受曝光与色调映射影响。
    this.exposure.value = effects.display === 'realtime' ? 2 ** effects.exposure : 1
    this.ambientOcclusion.value = effects.ambientOcclusion
    this.reflections.value = effects.reflections
    this.globalIllumination.value = effects.globalIllumination
    this.lightOutput.value = input.light ? 1 : 0
    const target = this.target!, output = this.output!
    const restoreOpacity = effects.display === 'realtime' ? this.applySceneOpacity(input.scenes) : this.applyDisplay(input.scenes, effects.display)
    const restoreDepth = options.cardsOnly ? this.applyDepthOnly([...input.scenes, ...this.solidScenes()]) : undefined
    const restore = (): void => { restoreDepth?.(); restoreOpacity() }
    const underlay = options.underlay ? this.underlayQuad(options.underlay) : undefined
    try {
      // 卡片那一层（渲染方式混合合成）不要下方画面：玻璃透过去的画面已在路径追踪那一层里。作者场景自带背景时背景挡住一切，也不用。
      this.syncBelow(!options.cardsOnly && effects.display === 'realtime' && !this.scene.background ? input.below : undefined, entry.emission, effects.motionBlur)
      if (effects.emission || this.areaLights) await this.syncAreaLights(input, effects.display === 'realtime' && effects.emission && !options.cardsOnly)
      await this.renderGlassBack(input, effects.display === 'realtime' && !options.cardsOnly)
      if (!entry.primed) {
        // three 在第一次绘制时才搭节点图，那一帧里场景通道还没登记逐帧更新、什么也不画，同一帧号内也不会再更新：
        // 新建的管线先在单独一帧里空画一次，正式这一帧才有内容（否则导出、选帧的第一帧是空的）。
        await this.clock.run(input.scenes[0]?.time ?? input.frame.sequenceTime, () => guardVideoEditThree(this.renderer, this.device, '三维渲染', () => {
          this.renderer.setRenderTarget(target); this.renderer.setOutputRenderTarget(target)
          try { this.withLayeredTransmission(!options.cardsOnly, () => pipeline.render()) } finally { this.renderer.setOutputRenderTarget(null); this.renderer.setRenderTarget(null) }
        }))
        entry.primed = true
      }
      // 渲染失败（如提交里用到已销毁的资源）要让这一帧失败，而不是当成画好了交出去。
      await this.clock.run(input.scenes[0]?.time ?? input.frame.sequenceTime, () => guardVideoEditThree(this.renderer, this.device, '三维渲染', () => {
        // 后处理的最后一步画到“输出渲染目标”，中间各步画到“当前渲染目标”：两个都指向本帧目标，否则最后一步会落到看不见的画布上。
        this.renderer.setRenderTarget(target)
        this.renderer.setOutputRenderTarget(target)
        try {
          this.withLayeredTransmission(!options.cardsOnly, () => pipeline.render())
          input.assertCurrent()
          if (underlay) {
            // 叠加不能先清屏（渲染器缺省每次绘制前清空目标），否则刚画好的卡片那一层被抹掉。
            const renderer = this.renderer as unknown as { autoClear: boolean }, autoClear = renderer.autoClear
            renderer.autoClear = false
            try { this.renderer.setRenderTarget(target); underlay.render(this.renderer) } finally { renderer.autoClear = autoClear }
          }
          this.renderer.copyTextureToTexture(target.texture, output.external)
        } finally { this.renderer.setOutputRenderTarget(null); this.renderer.setRenderTarget(null) }
      }))
    } finally {
      restore()
      // 背面纹理只在本渲染器这一次绘制里有效：作者场景单独渲染成一层时按固定厚度近似。
      if (this.glassBack) this.glassBack.shared.on.value = 0
    }
  }

  /**
   * 透射材质（玻璃）透出去看到的是一张帧缓冲拷贝。three 缺省每次绘制只在第一个透射物体前拷一次、只含不透明物体，
   * 叠着的几块玻璃互相看不见、玻璃后面的卡片（透明物体）也看不见。透明物体从后往前画，这里让那张拷贝在每个用到它的物体前都重拷，
   * 每块玻璃就透出它身后已经画好的一切（其他玻璃、卡片）。只在本渲染器绘制期间改，作者自己的 three 渲染不受影响。
   */
  private withLayeredTransmission(enabled: boolean, draw: () => void): void {
    // 卡片那一层里作者物体不出颜色，拷了也用不上。
    if (!enabled) { draw(); return }
    const { library } = this
    const prototype = library.ViewportTextureNode.prototype, original = prototype.getUpdateBeforeType
    const backdrop = this.transmissionBackdrop ??= this.tsl.viewportOpaqueMipTexture().referenceNode, everyObject = library.NodeUpdateType.OBJECT
    prototype.getUpdateBeforeType = function (frame) { return this === backdrop || this.referenceNode === backdrop ? everyObject : original.call(this, frame) }
    try { draw() } finally { prototype.getUpdateBeforeType = original }
  }

  /**
   * 卡片那一层里作者物体只写深度：挡在卡片前的物体让那里不画卡片，路径追踪那一层在那里给出物体，或透过它看到的卡片。
   * - 半透明物体、玻璃与卡片同在透明列表里、按远近排序，物体在卡片前时会晚于卡片画、挡不住它：这一层让作者物体全部先画。
   * - 透明材质的全透明像素不能挡（追踪器求交时跳过全透明纹素，镜头光线直接打到卡片）：换成一份 alphaTest 为 1/255 的只写深度副本。
   *   就地改 alphaTest 不会让 three 重建着色器，所以用副本，每种材质只编译一次；不透明材质就地只关颜色写入。
   * - 作者场景的背景这一层不画，否则会加两遍。
   */
  private applyDepthOnly(scenes: readonly ThreeSpaceScene[]): () => void {
    const opaque = new Map<Three.Material, { colorWrite: boolean; depthWrite: boolean }>()
    const meshes = new Map<Three.Mesh, Three.Material | Three.Material[]>()
    const orders = new Map<Three.Object3D, number>()
    const depthOnly = (material: Three.Material): Three.Material => {
      if (!material.transparent) {
        if (!opaque.has(material)) { opaque.set(material, { colorWrite: material.colorWrite, depthWrite: material.depthWrite }); material.colorWrite = false; material.depthWrite = true }
        return material
      }
      let entry = this.depthOnlyCopies.get(material)
      // 作者改了材质结构（换节点、贴图从无到有、alphaTest 等，three 以 version 记）时重做副本；作者释放材质时一并释放。
      if (entry && entry.version !== material.version) { entry.copy.dispose(); entry = undefined }
      if (!entry) {
        const copy = material.clone()
        copy.colorWrite = false; copy.depthWrite = true; copy.transparent = false; copy.alphaTest = Math.max(material.alphaTest, 1 / 255)
        if (!this.depthOnlyCopies.has(material)) material.addEventListener('dispose', () => { this.depthOnlyCopies.get(material)?.copy.dispose(); this.depthOnlyCopies.delete(material) })
        entry = { copy, version: material.version }
        this.depthOnlyCopies.set(material, entry)
      }
      const copy = entry.copy
      // 作者每帧可能改透明度与贴图：只跟这几项（决定哪些像素挡住），颜色这一层用不上。
      const source = material as Three.Material & { map?: unknown; alphaMap?: unknown }, target = copy as Three.Material & { map?: unknown; alphaMap?: unknown }
      target.opacity = source.opacity; target.map = source.map; target.alphaMap = source.alphaMap; target.side = source.side
      return copy
    }
    for (const scene of scenes) scene.root.traverse(object => {
      orders.set(object, object.renderOrder)
      object.renderOrder = Number.MIN_SAFE_INTEGER
      const mesh = object as Three.Mesh
      if (!mesh.material) return
      meshes.set(mesh, mesh.material)
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(depthOnly) : depthOnly(mesh.material)
    })
    const background = this.scene.background
    this.scene.background = null
    return () => {
      this.scene.background = background
      for (const [mesh, material] of meshes) mesh.material = material
      for (const [object, order] of orders) object.renderOrder = order
      for (const [material, value] of opaque) { material.colorWrite = value.colorWrite; material.depthWrite = value.depthWrite }
    }
  }

  /** 把路径追踪的结果（同尺寸、线性编码后的预乘画面）相加画到卡片那一层上的全屏四边形。 */
  /** 面光源要先装好 LTC 查找表（灯光片段的面光与发光卡片的面光源槽共用）。 */
  private ensureLtc(): Promise<void> {
    return this.ltcReady ??= loadAuthorThreeModule<{ RectAreaLightTexturesLib: { init(): unknown } }>('three/addons/lights/RectAreaLightTexturesLib.js', this.libraries)
      .then(({ RectAreaLightTexturesLib }) => { (this.library as unknown as { RectAreaLightNode: { setLTC(value: unknown): void } }).RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init()) })
      .catch(error => { this.ltcReady = undefined; throw error })
  }

  /**
   * 时间线灯光：亮度按灯种换成 three 的单位（平行光 ×3、聚光与点光 ×20 并按距离平方衰减、面光 ×5），亮度 1 是“一盏常用的主光”；
   * 阴影软硬换成阴影贴图的模糊半径，聚光的边缘软硬随它。
   */
  private async syncTimelineLights(lights: readonly import('@/core/videoEdit/spatialLights').SpatialLight[]): Promise<void> {
    const { library } = this
    const next = new Set(lights.map(light => light.clipId))
    for (const [clipId, entry] of this.timelineLights) if (!next.has(clipId)) { this.scene.remove(entry.light); if (entry.target) this.scene.remove(entry.target); entry.light.dispose(); this.timelineLights.delete(clipId) }
    for (const value of lights) {
      let entry = this.timelineLights.get(value.clipId)
      if (entry && entry.kind !== value.kind) { this.scene.remove(entry.light); if (entry.target) this.scene.remove(entry.target); entry.light.dispose(); this.timelineLights.delete(value.clipId); entry = undefined }
      if (!entry) {
        if (value.kind === 'area') await this.ensureLtc()
        const target = value.kind === 'directional' || value.kind === 'spot' ? new library.Object3D() : undefined
        const light: Three.Light = value.kind === 'directional' ? new library.DirectionalLight() : value.kind === 'spot' ? new library.SpotLight() : value.kind === 'point' ? new library.PointLight() : new library.RectAreaLight()
        light.name = `timeline-light:${value.clipId}`
        if (target) { (light as Three.DirectionalLight).target = target; this.scene.add(target) }
        this.scene.add(light)
        entry = { kind: value.kind, light, ...(target ? { target } : {}) }
        this.timelineLights.set(value.clipId, entry)
      }
      const light = entry.light
      light.color.set(value.color)
      // 平行光只看朝向：放在场景中心的反方向远处，阴影相机才罩得住整幅场景。
      const direction = new library.Vector3(...value.direction).normalize()
      if (value.kind === 'directional') light.position.copy(direction.clone().multiplyScalar(-6)); else light.position.set(...value.position)
      const aim = value.kind === 'directional' ? new library.Vector3(0, 0, 0) : new library.Vector3(...value.position).add(direction)
      if (entry.target) { entry.target.position.copy(aim); entry.target.updateMatrixWorld() }
      if (value.kind === 'directional') light.intensity = value.intensity * 3
      if (value.kind === 'spot') {
        const spot = light as Three.SpotLight
        spot.intensity = value.intensity * 20; spot.decay = 2; spot.distance = 0
        spot.angle = value.angle / 2 * Math.PI / 180; spot.penumbra = Math.min(1, .1 + value.softness * .9)
      }
      if (value.kind === 'point') { const point = light as Three.PointLight; point.intensity = value.intensity * 20; point.decay = 2; point.distance = 0 }
      if (value.kind === 'area') {
        const area = light as Three.RectAreaLight
        area.intensity = value.intensity * 5; area.width = area.height = Math.max(.01, value.size)
        area.lookAt(aim)
      }
      light.castShadow = value.castShadow && value.kind !== 'area'
      const shadow = (light as Three.DirectionalLight).shadow
      if (shadow && light.castShadow) {
        shadow.mapSize.set(2048, 2048)
        shadow.radius = 1 + value.softness * 6
        shadow.bias = -.0005
        if (value.kind === 'directional') {
          const camera = shadow.camera as Three.OrthographicCamera
          camera.left = camera.bottom = -2; camera.right = camera.top = 2; camera.near = .01; camera.far = 20; camera.updateProjectionMatrix()
        }
      }
      light.updateMatrixWorld()
    }
  }

  /** 实体卡片在卡片那一层里同作者物体一样只写深度：把它们包成场景的样子交给 applyDepthOnly。 */
  private solidScenes(): ThreeSpaceScene[] {
    return [...this.cards.entries()].filter(([, entry]) => entry.mesh.visible && this.solid.isSolid(entry.mesh) && !this.solid.isFlatSolid(entry.mesh))
      .map(([clipId, entry]) => ({ clipId, root: entry.mesh as unknown as Three.Group, time: 0, opacity: 1 }))
  }

  private async syncAreaLights(input: ThreeSpaceFrame, enabled: boolean): Promise<void> {
    const { library, tsl } = this
    this.areaLights ??= (async () => {
      await this.ensureLtc()
      return Array.from({ length: AREA_LIGHT_SLOTS }, (_, index): AreaLightSlot => {
        const target = new library.RenderTarget(1, 1, { type: library.HalfFloatType, depthBuffer: false })
        const source = tsl.texture(new library.Texture()), glow = tsl.uniform(0), strength = tsl.uniform(0)
        // 8×8 个采样点的平均：卡片画面按卡片的解码约定换成线性预乘色（发光画面逐通道），透明处算 0，平均值即单位面积发出的光。
        let sum: TslNode = tsl.vec3(0)
        for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
          const sample = (source as unknown as { sample(uv: TslNode): TslNode }).sample(tsl.vec2((x + .5) / 8, (y + .5) / 8))
          const glowing = tsl.pow(tsl.max(sample.rgb, tsl.vec3(0)), tsl.vec3(2.4))
          const plain = tsl.pow(tsl.max(tsl.select(sample.a.greaterThan(0), sample.rgb.div(sample.a), tsl.vec3(0)), tsl.vec3(0)), tsl.vec3(2.4)).mul(sample.a)
          sum = sum.add(tsl.select(glow.greaterThan(.5), glowing, plain))
        }
        const material = new library.MeshBasicNodeMaterial({ toneMapped: false, depthTest: false, depthWrite: false })
        material.colorNode = tsl.vec4(sum.div(64), 1)
        const light = new library.RectAreaLight(0xffffff, 1, 1, 1)
        ;(light as unknown as { colorNode: TslNode }).colorNode = tsl.textureLoad(tsl.texture(target.texture), tsl.ivec2(0, 0)).rgb.mul(strength)
        light.name = `card-light:${index}`
        this.scene.add(light)
        return { light, target, source, glow, strength, material, quad: new library.QuadMesh(material) }
      })
    })()
    // 加载失败（LTC 表取不到）时清掉缓存，下一帧重试，不让每帧都卡在同一个失败上。
    this.areaLights.catch(() => { this.areaLights = undefined })
    const slots = await this.areaLights
    const ranked = enabled ? input.cards.filter(card => card.emission > 0 && card.opacity > 0 && !card.geometry.behindCamera && this.cards.get(card.clipId)?.external)
      .map(card => ({ card, score: card.emission * card.geometry.screenBounds.width * card.geometry.screenBounds.height }))
      .sort((a, b) => b.score - a.score).slice(0, slots.length) : []
    // 朝向：发光那一面对着作者物体（没有物体时对着相机）。
    const box = new library.Box3()
    for (const root of this.attached) box.expandByObject(root)
    const toward = box.isEmpty() ? this.camera.position.clone() : box.getCenter(new library.Vector3())
    for (const [index, slot] of slots.entries()) {
      const entry = ranked[index]
      // 不用的槽只把强度设为 0、灯照样可见：隐藏会让灯从灯光列表里消失，所有受光材质按新的灯光组合重编译。
      if (!entry) { slot.strength.value = 0; continue }
      const matrix = this.cardMatrix(entry.card.geometry)
      const center = new library.Vector3().setFromMatrixPosition(matrix)
      const across = new library.Vector3().setFromMatrixColumn(matrix, 0), down = new library.Vector3().setFromMatrixColumn(matrix, 1)
      const width = across.length(), height = down.length()
      const normal = across.clone().cross(down).normalize()
      // 面光源沿自身 −z 发光：让 −z 指向物体那一侧。
      const z = toward.clone().sub(center).dot(normal) > 0 ? normal.clone().negate() : normal
      const x = across.normalize(), y = z.clone().cross(x).normalize()
      slot.light.position.copy(center)
      slot.light.quaternion.setFromRotationMatrix(new library.Matrix4().makeBasis(x, y, z))
      slot.light.width = width; slot.light.height = height
      slot.light.updateMatrixWorld(true)
      slot.source.value = this.cards.get(entry.card.clipId)!.external!
      slot.glow.value = entry.card.light ? 1 : 0
      slot.strength.value = entry.card.emission * entry.card.opacity
      await guardVideoEditThree(this.renderer, this.device, '三维渲染', () => {
        try { this.renderer.setRenderTarget(slot.target); slot.quad.render(this.renderer) } finally { this.renderer.setRenderTarget(null) }
      })
    }
  }

  /**
   * 实心玻璃的背面：把用到标准玻璃材质的网格放进玻璃层，用只看这一层的相机画一遍背面（视空间法线、视深），
   * 结果交给所有玻璃材质共用的纹理。没有玻璃或不在实时显示时关掉（玻璃按固定厚度近似）。
   */
  private async renderGlassBack(input: ThreeSpaceFrame, enabled: boolean): Promise<void> {
    const { library, tsl } = this
    const shared = this.glassBack?.shared ?? spaceGlassShared(library as never, tsl as never)
    const meshes: Three.Mesh[] = []
    if (enabled) for (const root of [...this.attached, ...[...this.cards.values()].map(entry => entry.mesh)]) root.traverse(object => {
      const mesh = object as Three.Mesh
      if (mesh.isMesh && mesh.visible && (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).some(material => material && isSpaceGlassMaterial(material))) meshes.push(mesh)
    })
    if (!meshes.length) { shared.on.value = 0; return }
    const width = input.target.width, height = input.target.height
    if (!this.glassBack) {
      // 不混合：three 会把被替换材质的 transparent 带给覆盖材质，玻璃是透明的，按普通混合时 alpha 里的视深会被混乱。
      const material = new library.MeshBasicNodeMaterial({ side: library.BackSide, toneMapped: false, blending: library.NoBlending })
      const view = tsl as unknown as { normalView: TslNode; positionView: TslNode }
      material.colorNode = tsl.vec4((view.normalView as unknown as { normalize(): TslNode }).normalize(), (view.positionView as unknown as { z: TslNode }).z.negate())
      const camera = new library.PerspectiveCamera()
      camera.layers.set(shared.layer)
      this.glassBack = { target: new library.RenderTarget(width, height, { type: library.HalfFloatType }), camera, material, shared }
    }
    const back = this.glassBack
    if (back.target.width !== width || back.target.height !== height) back.target.setSize(width, height)
    for (const mesh of meshes) mesh.layers.enable(shared.layer)
    back.camera.matrixWorld.copy(this.camera.matrixWorld); back.camera.matrixWorldInverse.copy(this.camera.matrixWorldInverse)
    back.camera.projectionMatrix.copy(this.camera.projectionMatrix); back.camera.projectionMatrixInverse.copy(this.camera.projectionMatrixInverse)
    back.camera.matrixAutoUpdate = false; back.camera.matrixWorldAutoUpdate = false
    const scene = this.scene as Three.Scene & { overrideMaterial: Three.Material | null }
    const background = scene.background
    scene.background = null; scene.overrideMaterial = back.material
    try {
      await guardVideoEditThree(this.renderer, this.device, '三维渲染', () => {
        try { this.renderer.setRenderTarget(back.target); this.renderer.render(scene, back.camera) } finally { this.renderer.setRenderTarget(null) }
      })
    } finally { scene.overrideMaterial = null; scene.background = background; for (const mesh of meshes) mesh.layers.disable(shared.layer) }
    markSpaceSharedTexture(back.target.texture)
    shared.back.value = back.target.texture
    shared.on.value = 1
    const environment = this.scene.environment ?? shared.placeholder
    for (const node of shared.environments) if (node.value !== environment) node.value = environment
    shared.environmentIntensity.value = this.scene.environment ? this.scene.environmentIntensity : 0
    shared.environmentRotation.value = this.scene.environmentRotation.y
  }

  /**
   * 下方画面在本像素的线性预乘色（与卡片同一解码约定）。按画面比例坐标换到下方画面的像素取：
   * 泛光的亮部通道在半分辨率上求值，按屏幕像素坐标取会错位。
   */
  private belowColor(): TslNode {
    const { tsl } = this
    const texel = tsl.min(tsl.floor(tsl.screenUV.mul(this.belowSize)), this.belowSize.sub(1))
    const sample = tsl.textureLoad(this.belowMap, tsl.ivec2(texel))
    const glowing = tsl.pow(tsl.max(sample.rgb, tsl.vec3(0)), tsl.vec3(2.4))
    const plain = tsl.pow(tsl.max(tsl.select(sample.a.greaterThan(0), sample.rgb.div(sample.a), tsl.vec3(0)), tsl.vec3(0)), tsl.vec3(2.4)).mul(sample.a)
    return tsl.select(this.belowLight.greaterThan(.5), glowing, plain)
  }

  /**
   * 下方画面的背景面：裁剪空间里铺满、深度在最远处，只在没有物体的地方写入（深度测试），写入时不混合（rgb = 下方画面、alpha = 0）。
   * 作为透明物体排在最前画，之后的卡片与半透明物体照常叠在它上面，透射材质的帧缓冲拷贝里就有它；不进法线预通道（只画不透明物体）。
   * 后处理属性、发光与速度写 0（速度不写 0 时运动模糊会按这块面的错误速度把物体拖进背景）；三种附件组合各一份输出。
   */
  private syncBelow(below: ThreeSpaceFrame['below'], emission: boolean, velocity: boolean, quad = true): void {
    const { library, tsl } = this
    // 关掉时换回占位纹理：扣除节点在所有实时管线里都绑着它，下方画面的纹理下一帧可能已被回收。
    if (!below) { if (this.belowEntry) this.belowEntry.mesh.visible = false; this.belowOn.value = 0; this.belowMap.value = this.belowPlaceholder; return }
    if (!this.belowEntry) {
      const material = new library.MeshBasicNodeMaterial({ transparent: true, blending: library.NoBlending, depthTest: true, depthWrite: false, toneMapped: false, side: library.DoubleSide })
      material.vertexNode = tsl.vec4(tsl.positionGeometry.xy.mul(2), .9999999, 1)
      // alpha 写 1：three 的透射会把材质的 alpha 乘上透过去取到的 alpha，写 0 时完全透射的玻璃覆盖率也成了 0。
      // 组内容的覆盖率另记在后处理属性的 b 通道里（背景面那里写 0）。
      material.colorNode = tsl.vec4(this.belowColor(), 1)
      const mesh = new library.Mesh(this.quad, material)
      mesh.frustumCulled = false
      mesh.renderOrder = -1e9
      mesh.name = 'below'
      // 路径追踪用的背板：与卡片同一四边形与解码，追踪时换成 matte 发光材质，平时隐藏。
      const backplate = new library.Mesh(this.quad, new library.MeshBasicNodeMaterial({}))
      backplate.matrixAutoUpdate = false
      backplate.frustumCulled = false
      backplate.visible = false
      backplate.name = 'below:backplate'
      this.scene.add(mesh, backplate)
      this.belowEntry = { mesh, backplate }
    }
    const entry = this.belowEntry
    if (entry.source !== below.texture) {
      entry.external?.dispose()
      entry.external = this.external(below.texture, below.width, below.height, true)
      entry.source = below.texture
    }
    this.belowMap.value = entry.external!
    this.belowSize.value.set(below.width, below.height)
    this.belowLight.value = below.light ? 1 : 0
    this.belowOn.value = 1
    if (!quad) return
    const zero = tsl.vec4(0, 0, 0, 0), material = entry.mesh.material as NodeMaterial
    const key = `${emission}:${velocity}`
    const outputs = (material.userData.outputs ??= {}) as Record<string, TslNode>
    outputs[key] ??= tsl.mrt({ attr: zero, ...emission ? { emission: zero } : {}, ...velocity ? { velocity: tsl.vec2(0) } : {} })
    if (material.mrtNode !== outputs[key]) { material.mrtNode = outputs[key]; material.needsUpdate = true }
    entry.mesh.visible = true
  }

  private underlayQuad(texture: Three.Texture): { render(renderer: unknown): void } {
    const { library, tsl } = this
    if (!this.underlay) {
      const source = tsl.texture(texture) as TslNode & { value: Three.Texture }
      const material = new library.MeshBasicNodeMaterial({ transparent: true, blending: library.CustomBlending, blendSrc: library.OneFactor, blendDst: library.OneFactor,
        blendSrcAlpha: library.OneFactor, blendDstAlpha: library.OneFactor, toneMapped: false, depthTest: false, depthWrite: false })
      material.colorNode = tsl.textureLoad(source, tsl.ivec2(tsl.screenCoordinate.xy))
      this.underlay = { source, quad: new library.QuadMesh(material) }
    }
    this.underlay.source.value = texture
    return this.underlay.quad
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

  private async trace(input: ThreeSpaceFrame): Promise<{ refining: boolean; covered: boolean; progress: number }> {
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
      if (!entry?.external || !entry.mesh.visible) return []
      // 实体卡片在追踪里是真实物体：画面作底色的按经典材质（底色贴图）追踪；玻璃、亚克力由材质替换表换成经典透射材质。
      if (this.solid.isSolid(entry.mesh) && !this.solid.isFlatSolid(entry.mesh)) {
        const solid = this.solid.pathTraceParameters(entry.mesh)
        return solid ? [{ mesh: entry.mesh, texture: entry.external, width: card.width, height: card.height, opacity: card.opacity, light: card.light, emission: card.emission, solid }] : []
      }
      return [{ mesh: entry.mesh, texture: entry.external, width: card.width, height: card.height, opacity: card.opacity, light: card.light, emission: card.emission }]
    })
    // 下方画面：追踪里是一张 matte 发光背板（相机看不见、穿过玻璃的光线看得见；它也照亮场景）。
    const backplate = input.below && !this.scene.background ? this.placeBackplate(input.below) : undefined
    // 追踪里卡片本身就是发光面，实时用的面光源再照一遍就重复了。
    // 追踪器读灯的经典参数（颜色 × 强度），不读颜色节点：追踪期间把强度设为 0，结束后还原。
    const areaSlots = this.areaLights ? await this.areaLights : []
    for (const slot of areaSlots) { slot.strength.value = 0; slot.light.intensity = 0 }
    // 标准材质里实时版与追踪版不同的（实心玻璃）：追踪期间换成同参数的经典材质。
    const swapped = new Map<Three.Mesh, Three.Material | Three.Material[]>()
    for (const root of [...this.attached, ...[...this.cards.values()].map(entry => entry.mesh)]) root.traverse(object => {
      const mesh = object as Three.Mesh
      if (!mesh.isMesh || !mesh.material) return
      const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      if (!list.some(material => spacePathTraceReplacement(material))) return
      swapped.set(mesh, mesh.material)
      mesh.material = Array.isArray(mesh.material) ? list.map(material => spacePathTraceReplacement(material) ?? material) : spacePathTraceReplacement(mesh.material)!
    })
    if (this.belowEntry) this.belowEntry.mesh.visible = false
    const traced = backplate ? [...cards, backplate] : cards
    // 物体的泛光与实时相同（序列泛光的强度、半径、阈值）；卡片的发光光晕在卡片那一层里按实时画。
    const glow = effects.bloom > 0 ? { strength: effects.bloom, radius: effects.bloomRadius, threshold: effects.bloomThreshold } : undefined
    const restore = this.applySceneOpacity(input.scenes)
    let refining = false
    try {
      await this.clock.run(input.scenes[0]?.time ?? input.frame.sequenceTime, async () => {
        refining = await tracer.render({ ...(plan.key === undefined ? {} : { key: plan.key }), scene: this.scene, camera, cards: traced, aperture, focusDistance: effects.focusDistance,
          samples: plan.samples, ...(plan.budgetMs === undefined ? {} : { budgetMs: plan.budgetMs }), ...(glow ? { glow } : {}), exposure: 2 ** effects.exposure, toneMapping: effects.toneMapping, target, light: input.light, assertCurrent: input.assertCurrent })
        input.assertCurrent()
        // 有卡片时：留下路径追踪那一层，再画卡片那一层把它加上（混合合成）；没有卡片时直接交出。
        const flat = cards.some(card => !('solid' in card))
        const layer = flat ? this.traceLayer(target.width, target.height) : undefined
        try { await guardVideoEditThree(this.renderer, this.device, '路径追踪', () => this.renderer.copyTextureToTexture(target.texture, layer?.texture ?? output.external)) }
        finally { this.renderer.setRenderTarget(null) }
      })
    } finally { restore(); for (const slot of areaSlots) slot.light.intensity = 1; if (backplate) backplate.mesh.visible = false; for (const [mesh, material] of swapped) mesh.material = material }
    const layer = cards.some(card => !('solid' in card)) ? this.traceLayerTarget : undefined
    if (layer && tracer.covered) await this.raster(input, { ...effects, display: 'realtime', ambientOcclusion: 0, reflections: 0, globalIllumination: 0, motionBlur: false }, { cardsOnly: true, underlay: layer.texture })
    return { refining, covered: tracer.covered, progress: tracer.progress(plan.samples) }
  }

  /**
   * 背板放在镜头正前方、铺满视野：深度取画面平面（世界原点所在的视深）与场景最远处两者中较远的，玻璃后面的东西都在它前面；
   * 放在画面平面上时折射偏移与实时的屏幕空间透射大致相当，太远会让透过玻璃的画面偏得过多。
   */
  private placeBackplate(below: NonNullable<ThreeSpaceFrame['below']>): { mesh: Three.Mesh; texture: Three.Texture; width: number; height: number; opacity: number; light: boolean; emission: number } {
    const { library, camera } = this
    this.syncBelow(below, false, false, false)
    const entry = this.belowEntry!
    entry.mesh.visible = false
    const view = camera.matrixWorldInverse
    let far = -new library.Vector3(0, 0, 0).applyMatrix4(view).z
    const box = new library.Box3()
    for (const root of this.attached) box.expandByObject(root)
    if (!box.isEmpty()) for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) far = Math.max(far, -new library.Vector3(x, y, z).applyMatrix4(view).z * 1.02)
    const depth = Math.max(far, camera.near * 4)
    const ty = Math.tan(camera.fov * Math.PI / 360), tx = ty * camera.aspect
    const right = new library.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new library.Vector3().setFromMatrixColumn(camera.matrixWorld, 1)
    const forward = new library.Vector3().setFromMatrixColumn(camera.matrixWorld, 2).negate()
    // uv（左上为 0、向右向下，与卡片的 uvToWorld 同一约定）→ 世界。
    const across = right.clone().multiplyScalar(2 * depth * tx), down = up.clone().multiplyScalar(-2 * depth * ty)
    const origin = camera.position.clone().addScaledVector(forward, depth).addScaledVector(right, -depth * tx).addScaledVector(up, depth * ty)
    const uvToWorld = new library.Matrix4().makeBasis(across, down, forward).setPosition(origin)
    entry.backplate.matrix.copy(uvToWorld).multiply(this.center)
    entry.backplate.matrixWorld.copy(entry.backplate.matrix)
    entry.backplate.visible = true
    return { mesh: entry.backplate, texture: entry.external!, width: below.width, height: below.height, opacity: 1, light: below.light, emission: 0 }
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

  private async syncCards(input: ThreeSpaceFrame): Promise<boolean> {
    const opened = new Map((input.shutterOpen?.cards ?? []).map(card => [card.clipId, card]))
    const shown = new Set<CardEntry>()
    let approximate = false
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
      // 卡片局部空间各轴一个单位对应的世界长度（x、y 按画面宽高，z 沿法线）：厚度与倒角按世界尺度换算。
      const scale = [0, 1, 2].map(axis => new this.library.Vector3().setFromMatrixColumn(entry.mesh.matrix, axis).length()) as [number, number, number]
      const solid = await this.solid.apply({ mesh: entry.mesh, map: entry.map as never, opacity: entry.opacity as never, emission: entry.emission as never, width: card.width, height: card.height },
        entry.material, card.surface, scale, input.exact === true)
      approximate ||= solid.approximate
      shown.add(entry)
    }
    for (const [clipId, entry] of this.cards) {
      if (shown.has(entry)) continue
      entry.mesh.visible = false
      if (this.renders - entry.used > CARD_IDLE_RENDERS) this.dropCard(clipId, entry)
    }
    return approximate
  }

  private dropCard(clipId: string, entry: CardEntry): void {
    void this.solid.apply({ mesh: entry.mesh, map: entry.map as never, opacity: entry.opacity as never, emission: entry.emission as never, width: 1, height: 1 }, entry.material, undefined, [1, 1, 1], false)
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
    // b：组内容的覆盖率（按 a 混合后正是叠加的覆盖率）；发光卡片 a 整片为 1，b 只记真实覆盖，透明的光晕处不算挡住下方画面。
    const attr = tsl.vec4(1, 1, light ? alpha : 1, light ? 1 : alpha)
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

  private syncScenes(scenes: readonly ThreeSpaceScene[], effects: ThreeSpaceEffects): void {
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
    // 没有作者环境时用序列的环境光预设（实时与路径追踪读同一张图）。
    if (!authors.some(scene => scene.environment) && effects.environment !== 'none') {
      this.scene.environment = videoEditSpaceEnvironment(this.library, effects.environment)
      // 预设环境图全 Worker 共用：玻璃节点会引用它，作者场景登记资源时不能当成自己的。
      markSpaceSharedTexture(this.scene.environment)
      this.scene.environmentIntensity = effects.environmentIntensity
      this.scene.environmentRotation.set(0, effects.environmentRotation * Math.PI / 180, 0)
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

  private ensurePipeline(effects: ThreeSpaceEffects): { pipeline: RenderPipeline; primed: boolean; emission: boolean; bloom?: { threshold: { value: number }; radius: { value: number } } } {
    if (effects.display !== 'realtime') effects = { ...effects, motionBlur: false, depthOfField: false, bloom: 0, ambientOcclusion: 0, reflections: 0, globalIllumination: 0, emission: false, toneMapping: 'neutral' }
    // 全局光照的反弹光存成 11-11-10 浮点纹理，设备不支持渲染到这种格式时不开（画面同不开）。
    if (effects.globalIllumination > 0 && !(this.renderer as unknown as { hasFeature(name: string): boolean }).hasFeature('rg11b10ufloat-renderable')) effects = { ...effects, globalIllumination: 0 }
    // 强度是每帧更新的均匀量，管线只按开关组合缓存。
    const key = JSON.stringify([effects.motionBlur, effects.depthOfField, effects.bloom > 0, effects.ambientOcclusion > 0, effects.reflections > 0, effects.globalIllumination > 0, effects.emission, effects.toneMapping])
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
    const surfaces = effects.ambientOcclusion > 0 || effects.reflections > 0 || effects.globalIllumination > 0
    // 后处理属性 attr：r = 跳过色调映射，g = 跳过整幅景深、FXAA、遮蔽与反射（平面卡片两样都跳过）。
    // three 的多目标输出里 output 以外的附件缺省不混合（最后写入者赢），半透明文字边缘会让后面的作者物体整像素被当成卡片；
    // attr 改为按覆盖率普通混合：rgb 累积卡片的覆盖率，a 累积总覆盖率（普通混合的 alpha 正是叠加后的覆盖率），
    // 两者相除才是“这个像素的颜色里卡片占多少”——半透明卡片叠在空白处时仍完全按卡片处理，叠在物体上时按比例。作者物体写 0。
    const attributes = tsl.mrt({ output: tsl.output, attr: tsl.vec4(0, 0, 1, tsl.output.a), ...effects.motionBlur ? { velocity: this.velocity } : {},
      // 发光附件：卡片写“额外光”（预乘），作者物体写 0 与自身覆盖率，挡在发光字前面的物体会遮住它的光晕。
      ...effects.emission ? { emission: tsl.vec4(0, 0, 0, tsl.output.a) } : {} }) as TslNode & { setBlendMode(name: string, mode: unknown): void; setClearColor(name: string, color: number, alpha: number): void }
    attributes.setBlendMode('attr', new library.BlendMode(library.NormalBlending))
    // 清成全透明：总覆盖率从 0 开始累积（缺省清屏透明度是 1）。画面输出同样要清成透明，否则没有物体的地方也是不透明的黑，
    // 整组画面会盖住它下面的二维画面。
    attributes.setClearColor('attr', 0, 0)
    attributes.setClearColor('output', 0, 0)
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
    // 扣掉下方画面：C = 内容 + (1 − A)·B（背景面 alpha 为 0，之后的物体按覆盖率叠在它上面），玻璃像素的颜色里已含折射后的 B。
    // 扣在遮蔽、景深、泛光之前，它们只作用于组自己的内容；屏幕反射读的仍是含 B 的场景通道。
    const content = attr.b
    color = tsl.select(this.belowOn.greaterThan(.5), tsl.vec4(color.rgb.sub(this.belowColor().mul(tsl.float(1).sub(content))), content), color)
    // 环境光遮蔽与反射只加在作者物体上：卡片是已经画好的画面，不该被压暗或叠上反射。
    const objects = tsl.float(1).sub(still)
    if (surfaces) {
      // 遮蔽与反射要读不带多重采样的深度与法线：另画一遍只出法线（与金属度粗糙度）的预通道，主通道照旧多重采样抗锯齿。
      const prePass = tsl.pass(this.scene, this.camera) as TslPass & { transparent: boolean }
      // 只画不透明物体：发光粒子、光晕这类透明面若写进法线，会被当成实体压出一块黑影。
      prePass.transparent = false
      nodes.push(prePass)
      const lighting = effects.globalIllumination > 0
      prePass.setMRT(tsl.mrt({ output: tsl.packNormalToRGB(tsl.normalView), ...effects.reflections > 0 ? { metalrough: tsl.vec2(tsl.metalness, tsl.roughness) } : {},
        // 漫反射色要扣掉金属度：节点材质的 diffuseColor 在这一步还是底色，金属不该接收漫反射的反弹光。
        ...lighting ? { diffuse: tsl.vec4(tsl.diffuseColor.rgb.mul(tsl.float(1).sub(tsl.metalness)), 1) } : {} }))
      prePass.getTexture('output').type = library.UnsignedByteType
      if (effects.reflections > 0) prePass.getTexture('metalrough').type = library.UnsignedByteType
      if (lighting) prePass.getTexture('diffuse').type = library.UnsignedByteType
      const depth = prePass.getTextureNode('depth'), normalTexture = prePass.getTextureNode('output')
      const normal = tsl.sample(coord => tsl.unpackRGBToNormal(normalTexture.sample(coord)))
      if (lighting) {
        // 屏幕空间全局光照（three 的 SSGINode，可见性位掩码 GI）：反弹光 × 物体漫反射色叠到物体上，在遮蔽之前（遮蔽同样压暗反弹光）。
        // 成片要逐帧确定：不用时间累积（它靠前后帧抖动采样再混合，单独渲染任一帧结果不同），改为固定噪声 + 半分辨率求值 + 按深度法线保边的降噪。
        // 反弹源的亮度截到 1：玻璃、金属的强高光只占几个像素，被少数采样方向打中就成了亮点，截掉后漫反射面的反弹光不变。
        const source = scenePass.getTextureNode('output')
        const clamped = tsl.convertToTexture(tsl.vec4(tsl.min(source.rgb, tsl.vec3(1)), source.a)) as TslNode & { dispose(): void }
        const bounce = new this.post.ssgi(clamped, depth, normal, this.camera)
        bounce.useTemporalFiltering = false
        bounce.sliceCount.value = SSGI_SLICES; bounce.stepCount.value = SSGI_STEPS
        // 节点每帧先把反弹光纹理清成白色（同一张渲染目标里的遮蔽纹理用白表示无遮蔽），没画到东西的地方就留着白：
        // 半分辨率的反弹光按双线性取到物体轮廓上时会混进这圈白、亮出一道边。清成透明黑，空白处就是“没有反弹光”。
        // 依赖 three 0.186.1 的 SSGINode 写法 setClearColor(0xffffff, 1)；升级 three 时要复查，写法变了这里会悄悄失效。
        const updateBefore = bounce.updateBefore.bind(bounce)
        bounce.updateBefore = frame => {
          const renderer = frame.renderer, setClearColor = renderer.setClearColor
          renderer.setClearColor = (color, alpha) => color === 0xffffff && alpha === 1 ? setClearColor.call(renderer, 0, 0) : setClearColor.call(renderer, color, alpha)
          try { return updateBefore(frame) } finally { delete (renderer as { setClearColor?: unknown }).setClearColor }
        }
        const setSize = bounce.setSize.bind(bounce)
        bounce.setSize = (width, height) => setSize(Math.max(1, Math.round(width * SSGI_SCALE)), Math.max(1, Math.round(height * SSGI_SCALE)))
        const smooth = this.post.denoise(bounce.getGINode(), depth, normal, this.camera) as TslNode & { dispose(): void; radius: { value: number }; depthPhi: { value: number } }
        smooth.radius.value = SSGI_DENOISE_RADIUS; smooth.depthPhi.value = SSGI_DENOISE_DEPTH
        deterministicDenoiseNoise(smooth)
        nodes.push(clamped, bounce, smooth)
        // 场景通道是预乘色（多重采样，边缘覆盖率小于 1），预通道不是：反弹光乘上覆盖率再叠，物体边缘解预乘后才不偏亮。
        color = tsl.vec4(color.rgb.add(prePass.getTextureNode('diffuse').rgb.mul(smooth.rgb).mul(this.globalIllumination.mul(objects)).mul(color.a)), color.a)
      }
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
    let bloom: (TslNode & { threshold: { value: number }; radius: { value: number } }) | undefined
    if (effects.bloom > 0) {
      // 泛光在景深与运动模糊之后：模糊掉的高光一样发光；亮度超过阈值的部分才扩散，暗处不变。辉光落在透明处时是透明度为 0 的发光。
      const glow = this.post.bloom(color, this.bloom, .45, .75) as TslNode & { threshold: { value: number }; radius: { value: number } }
      bloom = glow
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
    const tone = videoEditToneMapping(tsl, effects.toneMapping)
    const mapped = tsl.mix(tone(straight, this.exposure), straight, flat)
    const encoded = tsl.pow(tsl.max(mapped, tsl.vec3(0)), tsl.vec3(1 / 2.4))
    const lightEncoded = tsl.pow(tsl.max(tsl.mix(tone(color.rgb, this.exposure), color.rgb, flat), tsl.vec3(0)), tsl.vec3(1 / 2.4))
    const pipeline = new library.RenderPipeline(this.renderer)
    const output = tsl.convertToTexture(tsl.vec4(tsl.select(this.lightOutput.greaterThan(.5), lightEncoded, tsl.select(covered, encoded.mul(alpha), encoded)), alpha))
    nodes.push(output as unknown as { dispose(): void })
    // 多重采样只抹平几何轮廓，而且是在色调映射前按线性亮度平均：强高光贴着暗处时平均完仍过亮、边缘照样硬；
    // 细高光这类着色锯齿它也管不到。所以在编码后的画面上再做一遍 FXAA（SMAA 要在 Worker 里加载图片，用不了）。
    // 卡片是已经画好、抗过锯齿的画面，不再处理，免得文字被抹软。
    pipeline.outputNode = tsl.mix(this.post.fxaa(output), output, still)
    pipeline.outputColorTransform = false
    const entry = { pipeline, nodes, primed: false, emission: effects.emission, bloom }
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
    this.solid.dispose()
    for (const slot of this.areaLights ? await this.areaLights.catch(() => []) : []) { this.scene.remove(slot.light); slot.target.dispose(); slot.light.dispose(); slot.material.dispose() }
    for (const entry of this.timelineLights.values()) entry.light.dispose()
    this.timelineLights.clear()
    if (this.glassBack) { this.glassBack.target.dispose(); this.glassBack.material.dispose(); this.glassBack.shared.on.value = 0 }
    if (this.belowEntry) { (this.belowEntry.mesh.material as Three.Material).dispose(); (this.belowEntry.backplate.material as Three.Material).dispose(); this.belowEntry.external?.dispose() }
    this.quad.dispose()
    this.disposePipelines()
    await this.disposePathTraces()
    if (this.overrides) for (const material of Object.values(this.overrides)) { (material as unknown as { matcap?: Three.Texture }).matcap?.dispose(); material.dispose() }
    this.target?.dispose()
    this.output?.external.dispose()
    await this.renderer.dispose()
  }
}
