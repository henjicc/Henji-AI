import { useEffect } from 'react'
import { contributeAppMenus, type AppMenuEntry } from '@/core/appMenu/appMenu'
import type { WorkspaceId } from '@/core/types/workspace'
import { openLogWindow } from '@/commands/logging'
import { getPlatform } from '@/platform/runtime'
import { useUiStore } from '@/stores/uiStore'

interface GlobalAppMenuOptions {
  activeWorkspace: WorkspaceId
  workspaces: readonly { id: WorkspaceId; label: string }[]
  onWorkspaceChange: (id: WorkspaceId) => void
  assistantOpen: boolean
  onToggleAssistant: () => void
  assetFloating: boolean
  onToggleAssets: () => void
}

/** 应用层公共菜单：文件（设置、退出）、窗口（工作区、助手、资产库、日志）、帮助。工作区的命令由各工作区自己声明。 */
export function useGlobalAppMenus({ activeWorkspace, workspaces, onWorkspaceChange, assistantOpen, onToggleAssistant, assetFloating, onToggleAssets }: GlobalAppMenuOptions): void {
  useEffect(() => {
    const openSettings = useUiStore.getState().openSettings
    const workspaceItems: AppMenuEntry[] = workspaces.filter(item => item.id !== 'assets').map(item => ({
      kind: 'action', id: `app.workspace.${item.id}`, label: item.label, checked: item.id === activeWorkspace, run: () => onWorkspaceChange(item.id),
    }))
    return contributeAppMenus('app', [
      { menu: 'file', order: 90, items: [
        { kind: 'action', id: 'app.settings', label: '设置…', run: () => openSettings() },
        { kind: 'separator' },
        { kind: 'action', id: 'app.quit', label: '退出', run: () => getPlatform().window.close() },
      ] },
      { menu: 'window', order: 0, items: workspaceItems },
      { menu: 'window', order: 10, items: [
        { kind: 'action', id: 'app.assistant', label: '智能助手', checked: assistantOpen, run: onToggleAssistant },
        { kind: 'action', id: 'app.assets', label: '资产库浮动面板', checked: assetFloating, run: onToggleAssets },
      ] },
      { menu: 'window', order: 20, items: [
        { kind: 'action', id: 'app.logs', label: '日志与诊断', run: () => openLogWindow() },
        { kind: 'action', id: 'app.minimize', label: '最小化', run: () => getPlatform().window.minimize() },
      ] },
      { menu: 'help', order: 0, items: [
        { kind: 'action', id: 'app.shortcuts', label: '查看与快捷键设置', run: () => openSettings({ tab: 'general', sectionId: 'general-view' }) },
        { kind: 'action', id: 'app.about', label: '关于痕迹AI与检查更新', run: () => openSettings({ tab: 'general', sectionId: 'general-about' }) },
      ] },
    ])
  }, [activeWorkspace, workspaces, onWorkspaceChange, assistantOpen, onToggleAssistant, assetFloating, onToggleAssets])
}
