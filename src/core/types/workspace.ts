export type WorkspaceId = 'generation' | 'nodes' | 'videoEdit' | 'tools' | 'assets'

export { toolboxToolIdSchema, type ToolboxToolId } from '../toolbox/toolCatalog'

export const DEFAULT_WORKSPACE_ID: WorkspaceId = 'generation'

/**
 * 可作为启动默认页的工作区：标题栏的全部 Tab。
 *
 * `assets` 不是导航工作区（资产走独立的打开状态，悬浮面板或完整工作区）：选它时底下停在默认工作区，
 * 启动后直接打开完整资产工作区（见 App.tsx），不受「标题栏点击行为」影响。
 */
export const STARTUP_WORKSPACE_IDS = ['generation', 'nodes', 'videoEdit', 'tools', 'assets'] as const

export type StartupWorkspaceId = (typeof STARTUP_WORKSPACE_IDS)[number]

export function isStartupWorkspaceId(value: unknown): value is StartupWorkspaceId {
  return typeof value === 'string' && (STARTUP_WORKSPACE_IDS as readonly string[]).includes(value)
}
