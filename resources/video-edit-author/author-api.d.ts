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

export interface AuthorFrameInfo {
  time: number
  /** 一帧的秒数。 */
  frameDuration: number
  /** 片段内时间与片段时长（秒）。 */
  clip: { time: number; duration: number }
  audio?: AuthorAudioAnalysis
  /** 当前帧在音频分析区间内的秒数。 */
  audioTime?: number
}

/** 参数值按 params.键名 读取；键名与取值形状由 params 声明推断，推断不出时为 any。 */
export type AuthorParams = { readonly [key: string]: any }
/** image 参数的画面，按参数键取；未绑定时没有该键。 */
export type AuthorAssets = { readonly [key: string]: CanvasImageSource }

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
export type AuthorLayer = AuthorStaticLayer | AuthorPosedLayer

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
                    : any
/** 键名不确定（params 由变量或函数拼出）时退回 AuthorParams。 */
export type AuthorParamValues<P extends readonly AuthorParamDeclaration[]> =
  string extends P[number]['key'] ? AuthorParams : { readonly [D in P[number] as D['key']]: AuthorParamValue<D> }

export interface AuthorWebGL<P extends readonly AuthorParamDeclaration[] = readonly AuthorParamDeclaration[]> {
  draw(time: number, params: AuthorParamValues<P>, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): void
  dispose?(): void | Promise<void>
}
/** 图片、视频参数在时间线上的纹理，预乘 alpha。 */
export interface AuthorGpuImage { texture: GPUTexture; width: number; height: number }
/** GPU 输入：纹理归时间线所有，只读，不要销毁，只在这次 draw 里有效。 */
export interface AuthorGpuInputs {
  /** 只有滤镜有：正在处理的画面。 */
  current?: GPUTexture
  frames: ReadonlyArray<{ offset: number; texture: GPUTexture; available: boolean }>
  /** 图片、视频参数的纹理，键同参数名。直接采样它，不要读 assets：读 assets 会把这一帧拷成位图。 */
  images: { readonly [key: string]: AuthorGpuImage }
}
export interface AuthorWebGPU<P extends readonly AuthorParamDeclaration[] = readonly AuthorParamDeclaration[]> {
  draw(target: GPUTexture, time: number, params: AuthorParamValues<P>, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo, inputs?: AuthorGpuInputs): void | Promise<void>
  dispose?(): void | Promise<void>
}

/** 默认导出的效果对象。 */
export interface AuthorModule<P extends readonly AuthorParamDeclaration[] = readonly AuthorParamDeclaration[]> {
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
  draw?(ctx: OffscreenCanvasRenderingContext2D, time: number, params: AuthorParamValues<P>, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): void
  /** 每帧返回图层数组，按顺序从底到顶合成。 */
  layers?(params: AuthorParamValues<P>, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): AuthorLayer[]
  createWebGL?(gl: WebGL2RenderingContext): AuthorWebGL<P>
  createWebGPU?(device: GPUDevice): AuthorWebGPU<P> | Promise<AuthorWebGPU<P>>
  dispose?(): void | Promise<void>
}
