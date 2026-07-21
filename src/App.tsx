import { createLogger } from '@/core/logging'
import React, { useState, useEffect } from 'react'
import WindowControls from './components/WindowControls'
import TabContainer from './components/TabContainer'
import SettingsModal from '@/components/Settings'
import { databaseService } from './services/database/DatabaseService'
import { canvasProjectService } from './services/canvasProjects'
import { getCustomModelService } from './services/customModels/CustomModelService'
import { modelscopeCustomModelService } from './services/modelscopeCustomModels/ModelscopeCustomModelService'
import { loadAllModels } from './core/loaders'
import { registerDefaultPanels } from '@/components/params/panels/registerDefaultPanels'
import { useApplyRuntimeTheme } from './hooks/useApplyRuntimeTheme'
import { useDevToolsShortcut } from './hooks/useDevToolsShortcut'
import { useLogWindowShortcut } from './hooks/useLogWindowShortcut'
import type { WorkspaceId } from '@/core/types/workspace'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { AssetLibraryFloatingPanel } from '@/features/assets/AssetLibraryFloatingPanel'
import { LargeUploadChoiceDialog } from '@/components/upload/LargeUploadChoiceDialog'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAssetEdgeTrigger } from '@/features/assets/hooks/useAssetEdgeTrigger'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { useUiStore } from '@/stores/uiStore'
import { syncProviderKeyStatuses } from '@/services/providerKeyStatus'
import { GlobalAlertDialog } from '@/components/ui/GlobalAlertDialog'

const logger = createLogger('App')

/**
 * 简化后的 App 组件
 * 职责：
 * 1. 提供全局 Context Providers
 * 2. 渲染 WindowControls（标题栏 + Tab）
 * 3. 管理 Tab 切换和工作区渲染
 */
const App: React.FC = () => {
  useApplyRuntimeTheme()
  useDevToolsShortcut()
  useLogWindowShortcut()
  const [activeTab, setActiveTab] = useState<WorkspaceId>('generation')
  const [isReady, setIsReady] = useState(false)
  // 设置面板开关提到 uiStore：错误弹窗的「去设置」可能从任意深度的组件触发
  const isSettingsOpen = useUiStore((state) => state.isSettingsOpen)
  const settingsTarget = useUiStore((state) => state.settingsTarget)
  const openSettings = useUiStore((state) => state.openSettings)
  const closeSettings = useUiStore((state) => state.closeSettings)
  const assetView = useAssetLibraryStore((state) => state.view)
  const sourceWorkspace = useAssetLibraryStore((state) => state.sourceWorkspace)
  const setAssetView = useAssetLibraryStore((state) => state.setView)
  const setSourceWorkspace = useAssetLibraryStore((state) => state.setSourceWorkspace)
  const assetTabAction = useSettingsStore((state) => state.assetTabAction)
  const assetPanelPosition = useSettingsStore((state) => state.assetPanelPosition)
  const assetEdgeTriggerEnabled = useSettingsStore((state) => state.assetEdgeTriggerEnabled)
  const assetTriggerEdge = useSettingsStore((state) => state.assetTriggerEdge)
  const assetEdgeDelayMs = useSettingsStore((state) => state.assetEdgeDelayMs)
  const assetDragEdgeDelayMs = useSettingsStore((state) => state.assetDragEdgeDelayMs)

  const openAssetFloating = React.useCallback((): void => {
    if (activeTab !== 'assets') setSourceWorkspace(activeTab)
    setAssetView('floating')
  }, [activeTab, setAssetView, setSourceWorkspace])
  useAssetEdgeTrigger({ enabled: assetEdgeTriggerEnabled && !isSettingsOpen, edge: assetTriggerEdge, delayMs: assetEdgeDelayMs, dragDelayMs: assetDragEdgeDelayMs, open: assetView !== 'closed', onOpen: openAssetFloating })

  const openAssetWorkspace = (): void => {
    if (activeTab !== 'assets') setSourceWorkspace(activeTab)
    setAssetView('workspace')
    setActiveTab('assets')
  }
  const closeAssets = React.useCallback((): void => {
    setAssetView('closed')
    if (activeTab === 'assets') setActiveTab(sourceWorkspace)
  }, [activeTab, setAssetView, sourceWorkspace])
  const handleAssetClick = (): void => {
    if (assetView !== 'closed') { closeAssets(); return }
    if (assetTabAction === 'workspace') openAssetWorkspace(); else openAssetFloating()
  }
  const handleTabChange = (tab: WorkspaceId): void => { setAssetView('closed'); setActiveTab(tab) }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || assetView === 'closed') return
      if (document.querySelector('[data-asset-preview="open"], [data-asset-card-menu]')) return
      if (event.target instanceof HTMLElement && event.target.closest('[data-asset-floating-panel] input')) return
      closeAssets()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [assetView, closeAssets])
  useEffect(() => { if (assetView === 'closed' && activeTab === 'assets') setActiveTab(sourceWorkspace) }, [activeTab, assetView, sourceWorkspace])

  // 应用初始化
  useEffect(() => {
    const initializeApp = async () => {
      // 0. 注册默认面板（必须在使用前注册）
      registerDefaultPanels()

      // 1. 加载所有模型到 ModelRegistry
      try {
        await loadAllModels()
        // logger.info('[App] Models loaded:', stats)
      } catch (error) {
        logger.error('[App] Failed to load models:', error)
      }

      // 2. 初始化数据库
      try {
        await databaseService.init()
      } catch (error) {
        logger.error('[App] Failed to initialize database:', error)
      }

      // 2.1 初始化画布项目存储
      try {
        await canvasProjectService.init()
      } catch (error) {
        logger.error('[App] Failed to initialize canvas project storage:', error)
      }

      // 2.2 同步各供应商密钥配置状态
      // 不能等设置面板打开才同步：画布/生成前置校验读的就是这个状态，
      // 冷启动不同步会拿持久化旧值误判"未配置 API Key"
      await syncProviderKeyStatuses()

      // 3. 加载启用的自定义模型
      try {
        const customModelService = getCustomModelService(databaseService)
        await customModelService.loadEnabledModels()
        await modelscopeCustomModelService.loadModelsToRegistry()
      } catch (error) {
        logger.error('[App] Failed to load custom models:', error)
      }
    }

    initializeApp()
  }, [])

  // 启动就绪状态
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsReady(true)
    }, 100)
    return () => clearTimeout(timer)
  }, [])

  return (
    <NotificationProvider>
      <div
        className="h-screen min-h-screen bg-app text-white flex flex-col relative overflow-hidden"
        style={{
          opacity: isReady ? 1 : 0,
          transition: 'opacity 0.3s ease-in-out'
        }}
      >
        {/* 标题栏（含 Tab 切换） */}
        <WindowControls
          activeTab={activeTab}
          assetView={assetView}
          onTabChange={handleTabChange}
          onAssetClick={handleAssetClick}
          onOpenSettings={() => openSettings()}
        />

        {/* 工作区容器 */}
        <TabContainer activeTab={activeTab} />
        <AssetLibraryFloatingPanel open={assetView === 'floating'} position={assetPanelPosition} onClose={closeAssets} onOpenWorkspace={openAssetWorkspace} />
        {isSettingsOpen && <SettingsModal onClose={closeSettings} target={settingsTarget} />}
        <LargeUploadChoiceDialog />
        <GlobalAlertDialog />
      </div>
    </NotificationProvider>
  )
}

export default App


