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

const logger = createLogger('stores.navigation')

interface NavigationState {
  activeWorkspace: WorkspaceId
  activeToolId: ToolboxToolId | null
  revision: number
  setActiveWorkspace: (workspace: WorkspaceId) => void
  setActiveToolId: (toolId: ToolboxToolId | null) => void
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
  setActiveWorkspace: (activeWorkspace) => set((state) => (
    state.activeWorkspace === activeWorkspace
      ? state
      : { activeWorkspace, revision: state.revision + 1 }
  )),
  setActiveToolId: (activeToolId) => set((state) => (
    state.activeToolId === activeToolId
      ? state
      : { activeToolId, revision: state.revision + 1 }
  )),
}))

/** 工作区导航的非 React 命令入口，同时维持素材库视图联动。 */
export function switchWorkspace(workspace: WorkspaceId): void {
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

  useNavigationStore.getState().setActiveWorkspace(workspace)
  logger.info('工作区切换完成', {
    event: 'navigation.workspace_switch.completed',
    previousWorkspace,
    workspace,
    revision: useNavigationStore.getState().revision,
  })
}

/** 素材库入口；悬浮模式保留当前工作区，工作区模式切换到 assets。 */
export function openAssetLibrary(view: Exclude<AssetLibraryView, 'closed'>): void {
  const navigation = useNavigationStore.getState()
  const assetStore = useAssetLibraryStore.getState()

  if (navigation.activeWorkspace === 'assets' && view === 'floating') {
    navigation.setActiveWorkspace(assetStore.sourceWorkspace)
  } else if (navigation.activeWorkspace !== 'assets') {
    assetStore.setSourceWorkspace(navigation.activeWorkspace)
  }
  assetStore.setView(view)
  if (view === 'workspace') {
    navigation.setActiveWorkspace('assets')
  }
}

/** 关闭素材库；完整工作区模式返回打开素材库前的来源工作区。 */
export function closeAssetLibrary(): void {
  const assetStore = useAssetLibraryStore.getState()
  assetStore.setView('closed')
  if (useNavigationStore.getState().activeWorkspace === 'assets') {
    useNavigationStore.getState().setActiveWorkspace(assetStore.sourceWorkspace)
  }
}

/** 选择工具箱子工具的非 React 命令入口。 */
export function selectToolboxTool(toolId: ToolboxToolId | null): void {
  useNavigationStore.getState().setActiveToolId(toolId)
}
