import type { Plugin } from 'vite'

export interface RenderEngineSources {
  /** 沿依赖闭包散列的入口（相对 root）。 */
  closures?: readonly string[]
  /** 只散列文件本身的入口（相对 root）。 */
  files?: readonly string[]
  /** 闭包边界：引用到这些模块（相对 root，目录或去掉扩展名的文件）时不再往里走。 */
  boundaries?: readonly string[]
}
export declare const VIDEO_EDIT_RENDER_ENGINE_MODULE: 'virtual:video-edit-render-engine'
export declare const RENDER_ENGINE_CLOSURES: readonly string[]
export declare const RENDER_ENGINE_FILES: readonly string[]
export declare const RENDER_ENGINE_BOUNDARIES: readonly string[]
export declare function computeRenderEngineVersion(options: RenderEngineSources & { root: string }): Promise<{ version: string; files: string[] }>
export declare function videoEditRenderEngineVersion(options?: RenderEngineSources & { root?: string; fixed?: string }): Plugin
