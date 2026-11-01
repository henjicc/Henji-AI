import type { AuthorSimulation, AuthorSimulationDeclaration, AuthorSimulationInfo, AuthorSimulationSampler } from '@/core/videoEdit/codeSimulation'
import type { CodeAuthorBundle } from '@/core/videoEdit/codeAuthorProgram'
import { resolveAuthorLibraryModule } from '@/core/videoEdit/codeMaterial/authorLibraries'
import { prepareAuthorTextResources } from './videoEditAuthorTextResources'
import { CODE_AUTHOR_API_MIN_VERSION, CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION } from '@/core/videoEdit/codeAuthorVersions'
import type { EffectDescriptor } from '@/core/videoEdit/authorEffects.generated'
import type { ContentTrustReference } from '@/core/contentTrust'
import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { CodeSourceSpan } from '@/core/videoEdit/codeMaterial/contract'
import { deterministicAuthorModule, importAuthorDeterministic } from './videoEditAuthorDeterminism'
import { authorModuleTextLayouts } from '../../../core/videoEdit/textDrawObservation'
import { assertAuthorTrust } from './videoEditAuthorTrust'
import type { AuthorSpaceInfo, AuthorThreeHost, AuthorThreeScene } from './videoEditAuthorThree'
import type { WebTextDeclaration, WebTextImageMapping, WebTextResults } from '@/core/videoEdit/webTextGeometry'

/** Executable ES module contract. These functions never cross a worker boundary. */
export interface AuthorFrameInfo {
  space?: AuthorSpaceInfo
  simulation?: AuthorSimulationSampler
  time: number
  frameDuration: number
  /** frameKey 中提供：包含中心时刻的曝光范围（素材秒数）及有效快门角度。 */
  exposure?: { start: number; end: number; shutter: number; phase: number }
  clip: { time: number; duration: number }
  /** Existing host analysis for explicitly declared audio parameters. */
  audio?: import('@/core/audioAnalysis/contentAnalysis').AudioContentAnalysis
  audioTime?: number
  /**
   * 本帧输出像素与画布像素之比（≤1）：预览降分辨率与导出按输出分辨率渲染时提供（如 1/2 时为 0.5），省略即 1。
   * Canvas 图层由宿主缩放，坐标不变；WebGPU / WebGL 拿到的 target 与 width/height 已是缩小后的像素，按像素写的常数乘它。
   */
  renderScale?: number
  /** 绑定了网页的图片参数在这一帧的页面信息，按参数名；没有网页参数时没有这一项。 */
  web?: Readonly<Record<string, AuthorWebFrame>>
}
/**
 * 网页参数这一帧的页面信息。`time` 是页面时间（秒）；页面按 `width`×`height` 的视口排版，画面只含 `region`
 * （[x, y, 宽, 高]）这一块，每 CSS 像素 `scale` 个画面像素；`boxes` 是 boxes 里各选择器的元素矩形 [x, y, 宽, 高]
 * （视口 CSS 像素，找不到为 null）。`duration` 是页面声明的总时长。
 */
export interface AuthorWebFrame {
  /** Range 排版盒；不是字形墨迹或真实基线，pivot 是盒中心。 */
  text?: WebTextResults
  imageMapping?: WebTextImageMapping
  time: number
  width: number
  height: number
  region: [number, number, number, number]
  scale: number
  duration: number | null
  boxes: Readonly<Record<string, [number, number, number, number] | null>>
}
export type AuthorParameters = Readonly<Record<string, unknown>>
export type AuthorAssets = Readonly<Record<string, CanvasImageSource>>
export interface AuthorPose {
  x?: number; y?: number; rotation?: number; scale?: number; scaleX?: number; scaleY?: number
  opacity?: number; blur?: number
}
export interface AuthorLayer {
  adjust?: (time: number) => readonly EffectDescriptor[]
  fill?: unknown
  effects?: (time: number) => readonly EffectDescriptor[]
  id?: string
  name?: string
  /** Resolved by the module builder; never inferred by intercepting Canvas calls. */
  sourceSpan?: CodeSourceSpan
  /** Optional navigation for layers produced by a reusable factory. */
  factory?: { file: string; name: string }
  /** Bind the selected layer to one editable row; a stable key survives reordering. */
  data?: { parameter: string; index: number } | { parameter: string; key: string | number; keyField: string }
  bounds?: [number, number, number, number]
  clip?: [number, number, number, number]
  pose?: (time: number) => AuthorPose | null
  motionBlur?: boolean
  blurShape?: 'gaussian' | 'lens'
  /**
   * Author-declared content key. Equal to the previous frame's (same layer id), with unchanged bounds, clip and image
   * versions: `draw` is not called and the previous recording and raster are reused; `pose` is still sampled every frame.
   */
  cacheKey?: string | number
  draw?(ctx: OffscreenCanvasRenderingContext2D, time: number): void
}
export interface AuthorWebGL {
  draw(time: number, params: AuthorParameters, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): void
  dispose?(): void | Promise<void>
}
/** 源时间换成帧位置的细分：整帧仍是整数，小数帧按 1/1024 帧取值，去掉浮点误差，预览、导出与指纹取到同一个值。 */
const FRAME_POSITION_STEPS = 1024
/**
 * 图层与调整层的效果时钟：代码素材源时间对应的帧位置，可以带小数，慢放、时间重映射时每个输出帧都前进。
 * 渲染、输出复用键与预渲染指纹都取这同一个值，预览与导出才一致。
 * static 模块承诺画面不随时间变，输出键也不含时间，一律取 0，结果不取决于先渲染哪一帧。
 */
export function authorFramePosition(module: Pick<AuthorModule, 'mode'>, info: Pick<AuthorFrameInfo, 'time' | 'frameDuration'>): number {
  return module.mode === 'static' ? 0 : Math.round(info.time / info.frameDuration * FRAME_POSITION_STEPS) / FRAME_POSITION_STEPS
}
export function isAuthorAdjustment(layer: AuthorLayer, apiVersion: number): boolean {
  // 旧接口的同名字段属于作者数据，宿主不能读取或重写作者对象。
  if (apiVersion < CODE_AUTHOR_ADJUSTMENT_MIN_API_VERSION || layer.adjust === undefined) return false
  if (typeof layer.adjust !== 'function') throw new Error('adjust 必须是函数。')
  if (typeof layer.id !== 'string' || !layer.id.trim()) throw new Error('调整层需要 id。')
  if (['draw', 'fill', 'effects'].some(key => layer[key as keyof AuthorLayer] !== undefined)) throw new Error('adjust 与 draw、fill、effects 互斥。')
  return true
}
export interface AuthorWebGPU {
  draw(target: GpuTexture, time: number, params: AuthorParameters, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo, inputs?: AuthorGpuInputs): void | Promise<void>
  dispose?(): void | Promise<void>
}
/** An image/video parameter as the timeline's own texture (premultiplied alpha). */
export interface AuthorGpuImage { texture: GpuTexture; width: number; height: number }
/** Borrowed for this call on the compositor's device. Authors own their pass
 * targets; current/neighbour/image textures remain owned by the timeline. */
export interface AuthorGpuInputs {
  /** Filters only: the picture being filtered. */
  current?: GpuTexture
  frames: ReadonlyArray<{ offset: number; texture: GpuTexture; available: boolean }>
  /** Image and video parameters by key. Reading `assets` instead copies the frame into a bitmap. */
  images: Readonly<Record<string, AuthorGpuImage>>
}
export interface AuthorModule {
  space?: boolean
  createThree?(host: AuthorThreeHost): AuthorThreeScene | Promise<AuthorThreeScene>
  /** 图片参数名 → 需要同刻文本几何的 CSS 选择器；普通图片绑定不触发采样。 */
  webText?: WebTextDeclaration
  name: string
  kind?: 'generator' | 'filter'
  /** Optional placement hints. Rendering dimensions/time still belong to the host. */
  width?: number
  height?: number
  durationSeconds?: number
  mode?: 'static' | 'dynamic'
  /** Additional source frames, in host-frame units, in declaration order. */
  frames?: readonly number[]
  params?: ReadonlyArray<{ key: string; type: string; default?: unknown; layer?: string; group?: string; [key: string]: unknown }>
  types?: Readonly<Record<string, unknown>>
  motionBlur?: { shutter?: number; phase?: number; maxSamples?: number }
  /** 纯函数；相同键且代码与输入相同必须得到相同画面，不读取 GPU、画布、素材像素或网页布局。 */
  frameKey?(params: AuthorParameters, width: number, height: number, info: AuthorFrameInfo): unknown
  /** 这些工程相对路径的画面影响全部由 frameKey 表达；只有声明 frameKey 时才从代码身份排除；入口文件始终计入。 */
  dataFiles?: readonly string[]
  draw?(ctx: OffscreenCanvasRenderingContext2D, time: number, params: AuthorParameters, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): void
  layers?(params: AuthorParameters, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): AuthorLayer[]
  simulation?: AuthorSimulationDeclaration
  createSimulation?(params: AuthorParameters, width: number, height: number, info: AuthorSimulationInfo): AuthorSimulation | Promise<AuthorSimulation>
  createWebGL?(gl: WebGL2RenderingContext): AuthorWebGL
  createWebGPU?(device: GpuDevice): AuthorWebGPU | Promise<AuthorWebGPU>
  dispose?(): void | Promise<void>
}

// Vite 4 即使看到 @vite-ignore 仍会注入窗口客户端；固定函数体让原生模块加载不经过 import-analysis。
// 前提是渲染进程未设置不含 unsafe-eval 的 CSP。静态资源桥需要单独的开发/打包分发入口；
// new URL 只生成地址，既不隔离接收该地址的变量 import，也不会自行让桥的 JS 跳过 Vite 转换。
const importNativeModule = new Function('url', 'return import(url)') as (url: string) => Promise<{ default?: AuthorModule }>

/** Native import resolves relative dependencies and cycles using standard ESM semantics.
 * Every entry runs with seeded randomness and frame-derived clocks (see videoEditAuthorDeterminism). */
export async function loadAuthorModule(url: string, context?: ContentTrustReference[], apiVersion = CODE_AUTHOR_API_MIN_VERSION, bundle?: CodeAuthorBundle): Promise<AuthorModule> {
  await assertAuthorTrust({ url, context })
  const text = await prepareAuthorTextResources(bundle)
  try {
    if (text && bundle?.libraries?.['henji-layout']) {
      const library = resolveAuthorLibraryModule('henji-layout/text', bundle.libraries)
      if (library) await importNativeModule(library.url)
    }
    const layouts = new Set<string>()
    const loaded = await importAuthorDeterministic(() => importNativeModule(url), id => layouts.add(id), text?.fonts)
    const effect = loaded.default
    if (!effect || typeof effect.name !== 'string') throw new Error('默认导出需要效果名称 name。')
    if (![effect.draw, effect.layers, effect.createWebGL, effect.createWebGPU, effect.createThree].some(value => typeof value === 'function')) throw new Error('效果需要 draw、layers、createWebGL、createWebGPU 或 createThree 入口。')
    if (effect.createThree && [effect.draw, effect.layers, effect.createWebGL, effect.createWebGPU].some(Boolean)) throw new Error('createThree 不能与其他绘制入口同时声明。')
    if (effect.layers && (effect.createWebGL || effect.createWebGPU)) throw new Error('layers 不能与独立 GPU 绘制入口同时声明。')
    const wrapped = deterministicAuthorModule(effect, apiVersion, text?.fonts)
    if (text) {
      text.bind(wrapped)
      const dispose = wrapped.dispose
      wrapped.dispose = async () => { try { await dispose?.() } finally { text.close() } }
    }
    authorModuleTextLayouts.set(wrapped, layouts)
    return wrapped
  } catch (cause) {
    text?.close()
    throw new Error(`加载代码效果 ${url} 失败：${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}
