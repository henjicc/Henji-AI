export type WorkspaceId = 'generation' | 'nodes' | 'tools' | 'assets'

export type ToolboxToolId = 'cameraStage' | 'imageMark'

export const DEFAULT_WORKSPACE_ID: WorkspaceId = 'generation'

/**
 * 可作为启动默认页的工作区。
 *
 * 不含 `assets`：素材库那个 Tab 按设置走悬浮面板或工作区两种形态，不是单纯的工作区切换，
 * 拿它当启动页会和「素材库入口行为」设置打架。
 */
export const STARTUP_WORKSPACE_IDS = ['generation', 'nodes', 'tools'] as const

export type StartupWorkspaceId = (typeof STARTUP_WORKSPACE_IDS)[number]

export function isStartupWorkspaceId(value: unknown): value is StartupWorkspaceId {
  return typeof value === 'string' && (STARTUP_WORKSPACE_IDS as readonly string[]).includes(value)
}
