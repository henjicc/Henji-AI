import type { EffectDescriptor } from './author-effects'
export type { EffectDescriptor } from './author-effects'
/**
 * 代码素材作者接口的类型声明，只给作者源码类型检查用：源码检查 Worker 把本文件作为文本打包
 * （src/features/videoEdit/engine/videoEditAuthorTypeEnvironment.ts），不属于应用自身的 TypeScript 工程，
 * 也不随安装包作为单独文件发行。检查器另外提供这些名字的全局别名（AuthorLayer、AuthorPose 等），
 * 作者在工厂函数上标注类型时不用导入。
 *
 * 宿主真实契约在 src/features/videoEdit/engine/videoEditAuthorModule.ts，两边由
 * videoEditAuthorApiContract.test.ts 逐字段互相核对：任一侧增删或改字段而另一侧没跟上，测试会失败。
 *
 * 与宿主类型的有意差别（都只是放宽，宿主运行时同样接受）：
 * - params 的值按 params 声明推断键名与常用取值形状，推断不出的一律 any，不按 unknown 逼作者断言；
 * - bounds、clip 写成 number[]：工厂函数里未经上下文推断的 [x0, y0, x1, y1] 字面量是 number[]，
 *   宿主按下标读取，长度不对由运行时报错；
 * - 带 pose 的图层必须写 bounds（宿主运行时同样要求），类型上就拦下。
 */

/** 画布像素矩形 [x0, y0, x1, y1]。 */
export type AuthorRect = readonly number[]

/** 宿主离线分析的内容音频；没有可分析的声音时 info.audio 不存在。 */
export interface AuthorAudioAnalysis {
  fps: number
  duration: number
  /** 每分析帧 RMS，0–1。 */
  levels: number[]
  bands: { bass: number[]; mid: number[]; treble: number[] }
  /** 升序秒数，基准为分析区间起点。 */
  beats: number[]
  onsets: number[]
  bpm: number
  beatsPerBar: number
  barOrigin: number
}

export type SimulationData = null | boolean | number | string | SimulationData[] | { [key: string]: SimulationData } | ArrayBuffer | ArrayBufferView
export interface AuthorSimulationInfo { readonly step: number; readonly time: number; readonly dt: number; readonly random: () => number }
export interface AuthorSimulation<S extends SimulationData = SimulationData, V extends SimulationData = SimulationData, P extends readonly AuthorParamDeclaration[] = readonly AuthorParamDeclaration[]> {
  step(params: AuthorParamValues<P>, info: AuthorSimulationInfo): void
  snapshot(): S
  restore(snapshot: S): void
  read(): V
  interpolate?(left: Readonly<V>, right: Readonly<V>, alpha: number): V
  dispose(): void
}
export interface AuthorSimulationDeclaration { rate?: number; snapshotEvery?: number; seed?: number }
export interface AuthorSimulationSampler { at(sourceSeconds: number): Readonly<SimulationData> }

/** 作者根空间里的一个点（three 的 Vector3 可以直接 copy）。 */
export interface AuthorElementPoint { x: number; y: number; z: number }
/**
 * 作者 API 16 起，三维作者的图片参数绑定时间线片段（{kind:'clip',clipId}）时，那个片段此刻在作者根空间里的位置与形状。
 * 画面照旧在 assets[参数键]。没开空间的片段算在画面平面（z=0）上。
 */
export interface AuthorElement {
  readonly clipId: string
  /** 片段画面（整幅序列大小）的 uv（左上为 0、向右向下）→ 作者根空间，列主序 4×4。 */
  readonly matrix: readonly number[]
  at(u: number, v: number): AuthorElementPoint
  /** 外沿采样点：逐列（上下沿）或逐行（左右沿）取最外侧的不透明像素；spacing 为相邻两点间隔（显示高度的比例，缺省 0.004；形状按长边 512 格取样，间隔不会小于一格）。 */
  edge(side: 'bottom' | 'top' | 'left' | 'right', spacing?: number): AuthorElementPoint[]
  /** 在不透明区域里按覆盖均匀撒 count 个点（同一 seed 结果相同）。 */
  sample(count: number, seed?: number): AuthorElementPoint[]
  /**
   * 作者 API 17 起：不透明区域的轮廓，每块一个外轮廓与若干洞，点为画面 uv。用 uv 建 THREE.Shape（或 ExtrudeGeometry）后
   * geometry.applyMatrix4(new THREE.Matrix4().fromArray(element.matrix)) 即放到片段的真实位置（挤出的 z 在 matrix 里一个显示高度一个单位）。
   * tolerance 为简化容差（显示高度的比例，缺省 0.0015）。形状按长边 512 格取样；逐帧变化的画面每帧都会重新取。
   */
  outline?(tolerance?: number): AuthorElementPolygon[]
}
export interface AuthorElementPolygon { outer: Array<[number, number]>; holes: Array<Array<[number, number]>> }

export interface AuthorFrameInfo {
  space?: AuthorSpaceInfo
  /** 作者 API 16：图片参数引用时间线片段时的位置与形状（按参数键；那个片段此刻不在画面上为 null）。 */
  elements?: Readonly<Record<string, AuthorElement | null>>
  simulation?: AuthorSimulationSampler
  time: number
  /** 一帧的秒数。 */
  frameDuration: number
  /** frameKey 中提供：包含中心时刻的完整曝光范围（素材秒数）；shutter/phase 为有效快门角度，未启用图层运动模糊时均为 0，start = end = time。 */
  exposure?: { start: number; end: number; shutter: number; phase: number }
  /** 片段内时间与片段时长（秒）。 */
  clip: { time: number; duration: number }
  audio?: AuthorAudioAnalysis
  /** 当前帧在音频分析区间内的秒数。 */
  audioTime?: number
  /**
   * 输出像素与画布像素之比（≤1）：预览降分辨率与导出按输出分辨率渲染时提供（1/2 时为 0.5），省略即 1。Canvas 坐标不受影响；
   * WebGPU / WebGL 的 target 与 width/height 已是缩小后的像素，按像素写的长度乘 `info.renderScale ?? 1`。
   */
  renderScale?: number
  /** 绑定了网页的图片参数在这一帧的页面信息，按参数名；没有网页参数时不存在。 */
  web?: { readonly [key: string]: AuthorWebFrame }
}

export type WebTextDeclaration = Readonly<Record<string, readonly string[]>>
export type WebTextRect = readonly [number, number, number, number]
export interface WebTextSource { readonly start: number; readonly end: number }
export interface WebTextFont {
  readonly fontFamily: string; readonly fontSize: string; readonly fontWeight: string; readonly fontStyle: string
  readonly fontStretch: string; readonly lineHeight: string; readonly letterSpacing: string; readonly wordSpacing: string
  readonly direction: string; readonly writingMode: string; readonly fontFeatureSettings: string
  readonly fontVariationSettings: string; readonly whiteSpace: string; readonly textTransform: string; readonly lang: string
}
export interface WebTextFragment { readonly rect: WebTextRect; readonly line: number | null }
export type WebTextBreakKind = 'line-break' | 'block' | 'language' | 'replaced-element'
export interface WebTextBreak { readonly offset: number; readonly kind: WebTextBreakKind }
export type WebTextLayoutStatus = 'box' | 'zero-width' | 'collapsed-whitespace' | 'display-none' | 'visibility-hidden' | 'content-hidden'
export interface WebTextGrapheme {
  readonly source: WebTextSource
  /** 目标内 Text 节点序号与节点内 UTF-16 区间；跨内联节点的字素保留全部来源。 */
  readonly segments: readonly { readonly node: number; readonly start: number; readonly end: number; readonly font: number }[]
  readonly rects: readonly WebTextFragment[]
  readonly bounds: WebTextRect | null
  readonly pivot: readonly [number, number] | null
  readonly baseline: null
  /** Range 布局状态独立于透明度与取景；零宽片段保留位置。 */
  readonly layoutStatus: WebTextLayoutStatus
  readonly transparent: boolean
  readonly outsideRegion: boolean
  readonly regionRects: readonly WebTextFragment[]
  readonly rendered: boolean
  readonly overlaps: boolean
}
export interface WebTextWord { readonly source: WebTextSource; readonly isWordLike: boolean; readonly graphemes: readonly number[]; readonly rects: readonly WebTextFragment[] }
export interface WebTextLineFragment { readonly rect: WebTextRect; readonly node: number; readonly font: number }
export interface WebTextGeometry {
  readonly coordinateSpace: 'viewport-css'
  readonly coverage: 'dom-text-only'
  readonly text: string
  readonly breaks: readonly WebTextBreak[]
  readonly fonts: readonly WebTextFont[]
  readonly graphemes: readonly WebTextGrapheme[]
  readonly words: readonly WebTextWord[]
  readonly lineFragments: readonly WebTextLineFragment[]
  /** 与 graphemes 一一对应的格子（画面像素整数 [x,y,w,h]），互不重叠地铺满文字；按它切文字层，所有字不动时与原画面一致。竖排或没有位置的字素为 null。 */
  readonly cells?: readonly (WebTextRect | null)[]
  readonly segmentation: readonly { readonly source: WebTextSource; readonly locale: string; readonly contract: 'intl-segmenter' }[]
  readonly limitations: readonly string[]
}
export type WebTextResult = { readonly status: 'ready'; readonly geometry: WebTextGeometry }
  | { readonly status: 'not-found' }
  | { readonly status: 'unsupported' | 'unavailable'; readonly reason: string; readonly details?: readonly string[] }
export type WebTextResults = Readonly<Record<string, WebTextResult>>
export interface WebTextCapture {
  readonly samplerVersion: number
  readonly ticket: string
  readonly time: number
  readonly contentHash: string
  readonly results: WebTextResults
  readonly sampleMs: number
  readonly serializationMs: number
  readonly bytes: number
}
export interface WebTextImageMapping {
  readonly contentWidth: number
  readonly contentHeight: number
  /** CSS viewport → 有效图像像素，按 Canvas 仿射矩阵 [a,b,c,d,e,f]。 */
  readonly viewportToImage: readonly [number, number, number, number, number, number]
}

/**
 * 网页参数这一帧的页面信息。画面（assets / inputs.images 同名键）是视口里 region 这一块，每 CSS 像素 scale 个像素。
 * boxes 的矩形是视口 CSS 像素，换到画面像素：(x - region[0]) * scale。
 * data-henji-stage 标记视口大小、原点 (0,0) 的舞台；宿主搬入画布后不依赖父元素选择器或泛选 canvas，动态内容（含弹层）留在舞台内，舞台外可见内容保持静止。
 */
export interface AuthorWebFrame {
  /** 仅显式 webText 声明启用。Range 排版盒；baseline 为 null，pivot 是盒中心，不是字形墨迹。x/y 姿态位移使用作者逻辑画布像素，rotate 为弧度。 */
  text?: WebTextResults
  imageMapping?: WebTextImageMapping
  /** 页面时间（秒），即交给页面 henjiWeb.seek 的时刻。 */
  time: number
  /** 页面视口（CSS 像素）。 */
  width: number
  height: number
  /** 画面对应的视口区域 [x, y, 宽, 高]（CSS 像素）。 */
  region: [number, number, number, number]
  /** 每 CSS 像素的画面像素数。 */
  scale: number
  /** 页面声明的总时长（秒），没有声明为 null。 */
  duration: number | null
  /** boxes 里各选择器的元素矩形 [x, y, 宽, 高]，找不到为 null。 */
  boxes: { readonly [selector: string]: [number, number, number, number] | null }
}

/** 参数值按 params.键名 读取；键名与取值形状由 params 声明推断，推断不出时为 any。 */
export type AuthorParams = { readonly [key: string]: any }
/**
 * scene 参数（作者接口 v5）的值：宿主按这个参数声明的 schema 解析好的全片描述——剪后时间、按录屏秒锚定后的时刻、
 * 窗口内容时间表（timetables[].shots[]）。窗口内容的画面按 shot.input 键在 assets / inputs.images 里取。
 * 只读：同一文档版本内各帧、各片段拿到的是同一个已冻结的对象，可以按对象身份缓存自己的派生数据，修改会报错。
 * 未绑定或没能解析时为 null。
 */
export type AuthorScene = { readonly [key: string]: any }
/** image 参数的画面，按参数键取；未绑定、或视频参数带取帧时间表（spans）而这一帧不在任何一段里时没有该键。片子数据派生的画面按 shot.input 键取。 */
export type AuthorAssets = { readonly [key: string]: CanvasImageSource }
export type AuthorParameters = AuthorParams

/** 变换作用在画布坐标上：先绕画布原点缩放、旋转（弧度），再平移 x/y。 */
export interface AuthorPose {
  x?: number
  y?: number
  rotation?: number
  scale?: number
  scaleX?: number
  scaleY?: number
  opacity?: number
  blur?: number
}

interface AuthorLayerBase {
  adjust?: never
  fill?: never
  effects?: (time: number) => readonly EffectDescriptor[]
  /** 稳定字符串，用于点选、元素覆盖与标注定位。 */
  id?: string
  name?: string
  /** 指向生成这类图层的工厂函数。 */
  factory?: { file: string; name: string }
  /** 把图层绑定到 table 参数的一行。 */
  data?: { parameter: string; index: number } | { parameter: string; key: string | number; keyField: string }
  /** 可选裁切矩形 [x0, y0, x1, y1]。 */
  clip?: AuthorRect
  motionBlur?: boolean
  blurShape?: 'gaussian' | 'lens'
  /**
   * 内容键：与上一帧同一图层（同 id）的值相同、bounds/clip 与用到的图片都没变时，引擎不调用 draw，沿用上一帧的画面；
   * pose 照常每帧求值。动画落定后给它，例如 'settled'；内容还在变时不要给，或每次变化换一个值。
   */
  cacheKey?: string | number
  /** 坐标仍是画布像素。 */
  draw(ctx: OffscreenCanvasRenderingContext2D, time: number): void
}
/** 没有 pose 的图层；bounds 只用于选框。 */
export interface AuthorStaticLayer extends AuthorLayerBase {
  bounds?: AuthorRect
  pose?: undefined
}
/** 带 pose 的图层只画一次内容，按 pose(t) 合成；必须给出内容范围 bounds。 */
export interface AuthorPosedLayer extends AuthorLayerBase {
  bounds: AuthorRect
  /** 返回 null 表示本时刻不显示。 */
  pose(time: number): AuthorPose | null
}
/** 对本模块此前合成的画面应用效果；仅采样 pose.opacity，clip 按作者画幅裁切。 */
export interface AuthorAdjustmentLayer {
  id: string
  name?: string
  adjust(time: number): readonly EffectDescriptor[]
  clip?: AuthorRect
  pose?(time: number): Pick<AuthorPose, 'opacity'> | null
  draw?: never
  fill?: never
  effects?: never
}
/**
 * 画面来源用原生生成器（作者接口 v14）：宿主在 bounds 里用 GPU 画 fill(t) 返回的生成器（目前只有 gradient()），不写 draw。
 * 暗底大面积渐变用它，不出色带；可再接 effects、pose、clip，bounds 不写时铺满画布。
 */
export interface AuthorFillLayer extends Omit<AuthorLayerBase, 'fill' | 'cacheKey' | 'draw'> {
  bounds?: AuthorRect
  fill(time: number): EffectDescriptor
  pose?(time: number): AuthorPose | null
  draw?: never
}
export type AuthorLayer = AuthorFillLayer | AuthorStaticLayer | AuthorPosedLayer | AuthorAdjustmentLayer

/** params 数组的一项；字段由宿主在加载时校验，这里只约束 key 与 type。 */
export interface AuthorParamDeclaration {
  readonly key: string
  readonly type: string
  readonly [field: string]: unknown
}
export type AuthorColor = [number, number, number, number]
export interface AuthorPoint { x: number; y: number }
type AuthorParamValue<D> =
  D extends { readonly type: 'number' | 'angle' | 'seed' } ? number
    : D extends { readonly type: 'boolean' } ? boolean
      : D extends { readonly type: 'text' | 'font' | 'choice' | 'select' } ? string
        : D extends { readonly type: 'point' } ? AuthorPoint
          : D extends { readonly type: 'grade' } ? { hue: number; strength: number; luminance: number }
            // 默认值写 #RRGGBB(AA) 时代码收到同格式字符串，写 [r,g,b,a] 时收到 0–1 数组。
            : D extends { readonly type: 'color' } ? D extends { readonly default: string } ? string : AuthorColor
              // 没有数组默认值的 range 按 number 处理。
              : D extends { readonly type: 'range' } ? D extends { readonly default: readonly unknown[] } ? [number, number] : number
                : D extends { readonly type: 'gradient' } ? Array<{ at: number; color: AuthorColor }>
                  : D extends { readonly type: 'curve' } ? AuthorPoint[]
                    : D extends { readonly type: 'scene' } ? AuthorScene | null
                      : any
/** 键名不确定（params 由变量或函数拼出）时退回 AuthorParams。 */
export type AuthorParamValues<P extends readonly AuthorParamDeclaration[]> =
  string extends P[number]['key'] ? AuthorParams : { readonly [D in P[number] as D['key']]: AuthorParamValue<D> }

export interface AuthorWebGL<P extends readonly AuthorParamDeclaration[] = readonly AuthorParamDeclaration[], I extends AuthorFrameInfo = AuthorFrameInfo> {
  draw(time: number, params: AuthorParamValues<P>, width: number, height: number, assets: AuthorAssets, info: I): void
  dispose?(): void | Promise<void>
}
/** 图片、视频参数在时间线上的纹理，预乘 alpha。 */
export interface AuthorGpuImage { texture: GPUTexture; width: number; height: number }
/** GPU 输入：纹理归时间线所有，只读，不要销毁，只在这次 draw 里有效。 */
export interface AuthorGpuInputs {
  /** 只有滤镜有：正在处理的画面。 */
  current?: GPUTexture
  frames: ReadonlyArray<{ offset: number; texture: GPUTexture; available: boolean }>
  /** 图片、视频参数的纹理，键同参数名；片子数据派生的画面按 shot.input 键（没有画面的没有该键，同 AuthorAssets）。直接采样它，不要读 assets：读 assets 会把这一帧拷成位图。 */
  images: { readonly [key: string]: AuthorGpuImage }
}
export interface AuthorWebGPU<P extends readonly AuthorParamDeclaration[] = readonly AuthorParamDeclaration[], I extends AuthorFrameInfo = AuthorFrameInfo> {
  draw(target: GPUTexture, time: number, params: AuthorParamValues<P>, width: number, height: number, assets: AuthorAssets, info: I, inputs?: AuthorGpuInputs): void | Promise<void>
  dispose?(): void | Promise<void>
}

/** 默认导出的效果对象。 */
export type AuthorSpatialFrameInfo = AuthorFrameInfo & { space: AuthorSpaceInfo }
export interface AuthorModule<P extends readonly AuthorParamDeclaration[] = readonly AuthorParamDeclaration[], I extends AuthorFrameInfo = AuthorFrameInfo> {
  space?: boolean
  createThree?(host: AuthorThreeHost): AuthorThreeScene<P> | Promise<AuthorThreeScene<P>>
  /** 图片参数名到 CSS 选择器列表；只自动覆盖舞台内普通 HTML Text，不包含伪元素、SVG、Canvas、表单、Shadow DOM 或 iframe。 */
  webText?: WebTextDeclaration
  name: string
  kind?: 'generator' | 'filter'
  mode?: 'static' | 'dynamic'
  /** 放置提示；实际画布尺寸与时间由宿主给出。 */
  width?: number
  height?: number
  durationSeconds?: number
  /** 滤镜需要的相邻帧偏移（宿主帧单位，非零、不重复）。 */
  frames?: readonly number[]
  params?: P
  /** 自定义组件类型。 */
  types?: { readonly [name: string]: unknown }
  /** layers 的运动曝光默认值。 */
  motionBlur?: { shutter?: number; phase?: number; maxSamples?: number }
  /**
   * 这一帧整个曝光区间画了什么：宿主每帧只调用一次，info.time/clip 是中心帧，info.exposure 给出包含中心帧的曝光范围。
   * 作者须把曝光区间内影响画面的量（出现/退场、运动轨迹、镜头落点等）全部放入返回值，不能只描述中心时刻。
   * 纯函数，返回可 JSON 序列化的值。返回值相同（且 dataFiles 以外的代码与输入相同）时，整个曝光画面必须相同。
   * 不得读 GPU、画布、素材像素或网页布局；只用参数、尺寸、时刻与模块自己的数据。宿主用它决定预渲染文件能否复用。
   * 漏报变化会留下旧画面；修正声明后用“删除渲染文件”恢复。
   */
  frameKey?(params: AuthorParameters, width: number, height: number, info: I): unknown
  /** 代码工程内的相对路径：这些文件对画面的影响全部体现在 frameKey 的返回值里，算代码身份时不计入它们；入口文件始终计入代码身份，不存在的路径忽略。没有 frameKey 时不起作用。 */
  dataFiles?: readonly string[]
  draw?(ctx: OffscreenCanvasRenderingContext2D, time: number, params: AuthorParamValues<P>, width: number, height: number, assets: AuthorAssets, info: I): void
  /** 每帧返回图层数组，按顺序从底到顶合成。 */
  layers?(params: AuthorParamValues<P>, width: number, height: number, assets: AuthorAssets, info: I): AuthorLayer[]
  simulation?: AuthorSimulationDeclaration
  createSimulation?(params: AuthorParamValues<P>, width: number, height: number, info: AuthorSimulationInfo): AuthorSimulation<SimulationData, SimulationData, P> | Promise<AuthorSimulation<SimulationData, SimulationData, P>>
  createWebGL?(gl: WebGL2RenderingContext): AuthorWebGL<P, I>
  createWebGPU?(device: GPUDevice): AuthorWebGPU<P, I> | Promise<AuthorWebGPU<P, I>>
  dispose?(): void | Promise<void>
}

/** 空间时钟均为秒；project 返回归一化屏幕 x/y 与深度。 */
export interface AuthorSpaceInfo {
  readonly camera: AuthorSpaceCamera
  readonly sequenceTime: number; readonly sampleTime: number; readonly sourceTime: number; readonly centerSourceTime: number
  readonly root: AuthorSpaceMatrix
  readonly output: { width: number; height: number; displayWidth: number; displayHeight: number }
  project(point: readonly [number, number, number]): readonly [number, number, number]
}
export interface AuthorThreeHost {
  readonly camera: import('three').PerspectiveCamera
  readonly width: number
  readonly height: number
  /**
   * 作者 API 17 起：本场景的源时间（秒）的 TSL 均匀量，节点材质里的动画用它（如 sin(host.time.mul(2))）。
   * TSL 自带的 time 按渲染次数推进、同组场景共用，预览与导出会对不上。
   */
  readonly time?: import('three/webgpu').UniformNode<'float', number>
  /** 作者 API 17 起：与时间线物体同一实现的标准材质与环境，实时与“渲染”方式读同一份参数。 */
  readonly space?: AuthorSpaceHost
}
export type AuthorSpaceMaterialPreset = 'matte' | 'metal' | 'thin-film' | 'acrylic' | 'glass' | 'emissive'
export interface AuthorSpaceMaterialParams {
  /** '#rrggbb' 或 0xrrggbb：磨砂、金属、薄膜金属的底色，发光体的光色。 */
  color?: string | number
  /** 表面粗糙 0–1（磨砂缺省 0.7、金属 0.25、薄膜 0.2）。 */
  roughness?: number
  /** 亚克力、玻璃的磨砂程度 0–1（玻璃缺省 0.05、亚克力 0.15）。 */
  frost?: number
  /** 亚克力、玻璃透出的颜色。 */
  tint?: string | number
  /** 玻璃色散 0–1（缺省 0.3）。 */
  dispersion?: number
  /** 玻璃吸收 0–1（缺省 0.2）：越厚颜色越深。 */
  absorption?: number
  /** 玻璃折射率 1–2.5（缺省 1.5）。 */
  ior?: number
  /** 薄膜金属：膜厚范围（纳米，缺省 [250, 650]）、强度 0–1、沿 u 的色带条数（缺省 3）。 */
  range?: readonly [number, number]
  strength?: number
  frequency?: number
  /** 发光体亮度（线性倍数，缺省 2）。 */
  intensity?: number
}
export interface AuthorSpaceHost {
  /**
   * 标准材质：matte 磨砂、metal 金属、thin-film 薄膜金属、acrylic 亚克力（薄透明板）、glass 实心玻璃（两次折射、色散、按厚度吸收）、emissive 发光体。
   * 实心玻璃在实时里是屏幕空间近似（看不到屏幕外与凹形体内部），“渲染”方式下是真实体积。返回的材质归作者场景所有。
   */
  material(preset: AuthorSpaceMaterialPreset, params?: AuthorSpaceMaterialParams): import('three').Material
  /** 预设环境图（等距柱状，赋给 scene.environment）：宿主所有，不要释放。 */
  environment(preset: 'none' | 'studioNeutral' | 'studioWarm' | 'studioCool' | 'rim' | 'sky'): import('three').Texture | null
}
export interface AuthorThreeScene<P extends readonly AuthorParamDeclaration[] = readonly AuthorParamDeclaration[]> {
  scene: import('three').Scene
  update(params: AuthorParamValues<P>, assets: AuthorAssets, info: AuthorSpatialFrameInfo): void
  dispose?(): void | Promise<void>
}

type AuthorSpaceVector = readonly [number, number, number]
type AuthorSpaceMatrix = readonly [number, number, number, number, number, number, number, number, number, number, number, number, number, number, number, number]
interface AuthorSpaceCamera {
  position: AuthorSpaceVector; target: AuthorSpaceVector; up: AuthorSpaceVector
  focalLengthMm: number; sensorWidthMm: number; focusDistance: number; fStop: number; defocus: number
  near: number; far: number; fovYRadians: number
  view: AuthorSpaceMatrix; projectionWebGpu: AuthorSpaceMatrix; projectionWebGl: AuthorSpaceMatrix
  canonicalIdentity: boolean; resolvedAim: AuthorSpaceVector; resolvedFocus: AuthorSpaceVector; targetActive: boolean
}
