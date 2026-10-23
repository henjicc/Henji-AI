import type { ToolboxToolId, WorkspaceId } from '../types/workspace'

export interface NavigationDestination { workspace: WorkspaceId; toolId: ToolboxToolId | null }
type NavigationGuard = (destination: NavigationDestination, proceed: () => void) => boolean
const guards = new Set<NavigationGuard>()
/** 同步拦住切换；需要确认的宿主在完成自身离开屏障后调用 proceed。 */
export function registerNavigationGuard(guard: NavigationGuard): () => void { guards.add(guard); return () => guards.delete(guard) }
export function allowNavigation(destination: NavigationDestination, proceed: () => void): boolean {
  for (const guard of guards) if (!guard(destination, proceed)) return false
  return true
}
