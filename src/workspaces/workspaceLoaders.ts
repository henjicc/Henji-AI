import type { ComponentType } from 'react'
import type { WorkspaceId } from '@/core/types/workspace'

type WorkspaceModule = { default: ComponentType }
type WorkspaceLoader = () => Promise<WorkspaceModule>

/**
 * 工作区懒加载入口的唯一登记处。
 *
 * `React.lazy` 与空闲预取必须复用同一个 loader 引用，模块缓存才会命中；
 * 各写一份 `import()` 会让预取白做一遍。
 */
export const workspaceLoaders: Record<WorkspaceId, WorkspaceLoader> = {
  generation: () => import('./GenerationWorkspace'),
  nodes: () => import('./CanvasWorkspace'),
  tools: () => import('./ToolboxWorkspace'),
  assets: () => import('./AssetLibraryWorkspace'),
}

/**
 * 空闲预取清单：只含尚未访问的工作区。
 *
 * 刻意不预取工具箱里的 3D 镜头参考和图片编辑器：它们是整个前端最大的两棵子树，
 * 又都要在工具箱里再点一次才会打开。把它们塞进预取只会挤占 Tab 切换要用的带宽
 * （dev 下还会堵住 Vite 的转译队列，反而让点 Tab 变慢）。
 */
export function listPrefetchOrder(active: WorkspaceId): WorkspaceLoader[] {
  return (Object.keys(workspaceLoaders) as WorkspaceId[])
    .filter((id) => id !== active)
    .map((id) => workspaceLoaders[id])
}
