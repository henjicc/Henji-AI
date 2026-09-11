import { create } from 'zustand'

import { createLogger } from '@/core/logging'
import {
  DEFAULT_WORKSPACE_ID,
  isStartupWorkspaceId,
  type ToolboxToolId,
  type WorkspaceId,
} from '@/core/types/workspace'
import { useSettingsStore } from '@/stores/settingsStore'
import {
  useAssetLibraryStore,
  type AssetLibraryView,
} from '@/features/assets/store/assetLibraryStore'
import { emitApplicationEvent } from '@/core/events/applicationEvents'

const logger = createLogger('stores.navigation')
export type NavigationSource = 'user' | 'assistant' | 'system'

interface NavigationState {
  activeWorkspace: WorkspaceId
  activeToolId: ToolboxToolId | null
  revision: number
  userNavigationRevision: number
  lastNavigationSource: NavigationSource
  recordNavigation: (source?: NavigationSource) => void
  setActiveWorkspace: (workspace: WorkspaceId, source?: NavigationSource) => void
  setActiveToolId: (toolId: ToolboxToolId | null, source?: NavigationSource) => void
}

/**
 * 启动时停在哪个工作区由设置决定。
 *
 * 读的是 zustand persist 已同步补水的 localStorage 值，所以这里直接取 state 即可；
 * 值不合法（老版本数据、手改过存储）时回落默认工作区，不让导航卡在不存在的 Tab 上。
 */
function resolveInitialWorkspace(): WorkspaceId {
  const configured = useSettingsStore.getState().startupWorkspace
  return isStartupWorkspaceId(configured) ? configured : DEFAULT_WORKSPACE_ID
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activeWorkspace: resolveInitialWorkspace(),
  activeToolId: null,
  revision: 0,
  userNavigationRevision: 0,
  lastNavigationSource: 'system',
  recordNavigation: (source = 'user') => set((state) => ({
    lastNavigationSource: source, revision: state.revision + 1,
    userNavigationRevision: state.userNavigationRevision + (source === 'user' ? 1 : 0),
  })),
  setActiveWorkspace: (activeWorkspace, source = 'user') => set((state) => (
    state.activeWorkspace === activeWorkspace
      ? state
      : { activeWorkspace, revision: state.revision + 1, lastNavigationSource: source,
        userNavigationRevision: state.userNavigationRevision + (source === 'user' ? 1 : 0) }
  )),
  setActiveToolId: (activeToolId, source = 'user') => set((state) => (
    state.activeToolId === activeToolId
      ? state
      : { activeToolId, revision: state.revision + 1, lastNavigationSource: source,
        userNavigationRevision: state.userNavigationRevision + (source === 'user' ? 1 : 0) }
  )),
}))

/** 工作区导航的非 React 命令入口，同时维持素材库视图联动。 */
export function switchWorkspace(workspace: WorkspaceId, source: NavigationSource = 'user'): void {
  const previousWorkspace = useNavigationStore.getState().activeWorkspace
  const assetStore = useAssetLibraryStore.getState()

  if (workspace === 'assets') {
    if (previousWorkspace !== 'assets') {
      assetStore.setSourceWorkspace(previousWorkspace)
    }
    assetStore.setView('workspace')
  } else {
    assetStore.setView('closed')
  }

  useNavigationStore.getState().setActiveWorkspace(workspace, source)
  emitApplicationEvent('workspace-opened', { workspaceId: workspace })
  logger.info('工作区切换完成', {
    event: 'navigation.workspace_switch.completed',
    previousWorkspace,
    workspace,
    revision: useNavigationStore.getState().revision,
  })
}

/** 素材库入口；悬浮模式保留当前工作区，工作区模式切换到 assets。 */
export function openAssetLibrary(view: Exclude<AssetLibraryView, 'closed'>, source: NavigationSource = 'user'): void {
  const navigation = useNavigationStore.getState()
  const assetStore = useAssetLibraryStore.getState()

  if (navigation.activeWorkspace === 'assets' && view === 'floating') {
    navigation.setActiveWorkspace(assetStore.sourceWorkspace, source)
  } else if (navigation.activeWorkspace !== 'assets') {
    assetStore.setSourceWorkspace(navigation.activeWorkspace)
  }
  if (assetStore.view !== view) navigation.recordNavigation(source)
  assetStore.setView(view)
  if (view === 'workspace') {
    navigation.setActiveWorkspace('assets', source)
  }
}

/** 关闭素材库；完整工作区模式返回打开素材库前的来源工作区。 */
export function closeAssetLibrary(source: NavigationSource = 'user'): void {
  const assetStore = useAssetLibraryStore.getState()
  if (assetStore.view !== 'closed') useNavigationStore.getState().recordNavigation(source)
  assetStore.setView('closed')
  if (useNavigationStore.getState().activeWorkspace === 'assets') {
    useNavigationStore.getState().setActiveWorkspace(assetStore.sourceWorkspace, source)
  }
}

/** 选择工具箱子工具的非 React 命令入口。 */
export function selectToolboxTool(toolId: ToolboxToolId | null, source: NavigationSource = 'user'): void {
  useNavigationStore.getState().setActiveToolId(toolId, source)
}
