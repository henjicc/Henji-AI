import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { CodeSourceSpan } from '@/core/videoEdit/codeMaterial/contract'
import { deterministicAuthorModule, importAuthorDeterministic } from './videoEditAuthorDeterminism'
import { authorModuleTextLayouts } from '../../../core/videoEdit/textDrawObservation'

/** Executable ES module contract. These functions never cross a worker boundary. */
export interface AuthorFrameInfo {
  time: number
  frameDuration: number
  clip: { time: number; duration: number }
  /** Existing host analysis for explicitly declared audio parameters. */
  audio?: import('@/core/audioAnalysis/contentAnalysis').AudioContentAnalysis
  audioTime?: number
  /**
   * 本帧输出像素与画布像素之比，只在节目回放分辨率降低时出现（如 1/2 时为 0.5）；完整分辨率、取帧与导出没有该字段（即 1）。
   * Canvas 图层由宿主缩放，坐标不变；WebGPU / WebGL 拿到的 target 与 width/height 已是缩小后的像素，按像素写的常数乘它。
   */
  renderScale?: number
}
export type AuthorParameters = Readonly<Record<string, unknown>>
export type AuthorAssets = Readonly<Record<string, CanvasImageSource>>
export interface AuthorPose {
  x?: number; y?: number; rotation?: number; scale?: number; scaleX?: number; scaleY?: number
  opacity?: number; blur?: number
}
export interface AuthorLayer {
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
  draw(ctx: OffscreenCanvasRenderingContext2D, time: number): void
}
export interface AuthorWebGL {
  draw(time: number, params: AuthorParameters, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): void
  dispose?(): void | Promise<void>
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
  draw?(ctx: OffscreenCanvasRenderingContext2D, time: number, params: AuthorParameters, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): void
  layers?(params: AuthorParameters, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): AuthorLayer[]
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
export async function loadAuthorModule(url: string): Promise<AuthorModule> {
  try {
    const layouts = new Set<string>()
    const loaded = await importAuthorDeterministic(() => importNativeModule(url), id => layouts.add(id))
    const effect = loaded.default
    if (!effect || typeof effect.name !== 'string') throw new Error('默认导出需要效果名称 name。')
    if (![effect.draw, effect.layers, effect.createWebGL, effect.createWebGPU].some(value => typeof value === 'function')) throw new Error('效果需要 draw、layers、createWebGL 或 createWebGPU 入口。')
    if (effect.layers && (effect.createWebGL || effect.createWebGPU)) throw new Error('layers 不能与独立 GPU 绘制入口同时声明。')
    const wrapped = deterministicAuthorModule(effect)
    authorModuleTextLayouts.set(wrapped, layouts)
    return wrapped
  } catch (cause) {
    throw new Error(`加载代码效果 ${url} 失败：${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}
