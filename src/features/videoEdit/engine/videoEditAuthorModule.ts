import type { GpuDevice, GpuTexture } from '@/core/imageEdit/worker/webgpuRuntimeSupport'
import type { CodeSourceSpan } from '@/core/videoEdit/codeMaterial/contract'

/** Executable ES module contract. These functions never cross a worker boundary. */
export interface AuthorFrameInfo {
  time: number
  frameDuration: number
  clip: { time: number; duration: number }
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
  draw(ctx: OffscreenCanvasRenderingContext2D, time: number): void
}
export interface AuthorWebGL {
  draw(time: number, params: AuthorParameters, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): void
  dispose?(): void | Promise<void>
}
export interface AuthorWebGPU {
  draw(target: GpuTexture, time: number, params: AuthorParameters, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): void | Promise<void>
  dispose?(): void | Promise<void>
}
export interface AuthorModule {
  name: string
  kind?: 'generator' | 'filter'
  params?: ReadonlyArray<{ key: string; type: string; default?: unknown; layer?: string; group?: string; [key: string]: unknown }>
  types?: Readonly<Record<string, unknown>>
  motionBlur?: { shutter?: number; phase?: number; maxSamples?: number }
  draw?(ctx: OffscreenCanvasRenderingContext2D, time: number, params: AuthorParameters, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): void
  layers?(params: AuthorParameters, width: number, height: number, assets: AuthorAssets, info: AuthorFrameInfo): AuthorLayer[]
  createWebGL?(gl: WebGL2RenderingContext): AuthorWebGL
  createWebGPU?(device: GpuDevice): AuthorWebGPU | Promise<AuthorWebGPU>
  dispose?(): void | Promise<void>
}

/** Native import resolves relative dependencies and cycles using standard ESM semantics. */
export async function loadAuthorModule(url: string): Promise<AuthorModule> {
  try {
    const loaded: { default?: AuthorModule } = await import(/* @vite-ignore */ url)
    const effect = loaded.default
    if (!effect || typeof effect.name !== 'string') throw new Error('默认导出需要效果名称 name。')
    if (![effect.draw, effect.layers, effect.createWebGL, effect.createWebGPU].some(value => typeof value === 'function')) throw new Error('效果需要 draw、layers、createWebGL 或 createWebGPU 入口。')
    if (effect.layers && (effect.createWebGL || effect.createWebGPU)) throw new Error('layers 不能与独立 GPU 绘制入口同时声明。')
    return effect
  } catch (cause) {
    throw new Error(`加载代码效果 ${url} 失败：${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}
