import { createLogger } from '@/core/logging'
import React, { Suspense, lazy, useState, useEffect } from 'react'
import WindowControls from './components/WindowControls'
import TabContainer from './components/TabContainer'
import { databaseService } from './services/database/DatabaseService'
import { canvasProjectService } from './services/canvasProjects'
import { getCustomModelService } from './services/customModels/CustomModelService'
import { modelscopeCustomModelService } from './services/modelscopeCustomModels/ModelscopeCustomModelService'
import { loadAllModels } from './core/loaders'
import { registerDefaultPanels } from '@/components/params/panels/registerDefaultPanels'
import { useApplyRuntimeTheme } from './hooks/useApplyRuntimeTheme'
import { useDevToolsShortcut } from './hooks/useDevToolsShortcut'
import { useLogWindowShortcut } from './hooks/useLogWindowShortcut'
import { useAssetLibraryStore } from '@/features/assets/store/assetLibraryStore'
import { LargeUploadChoiceDialog } from '@/components/upload/LargeUploadChoiceDialog'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAssetEdgeTrigger } from '@/features/assets/hooks/useAssetEdgeTrigger'
import { NotificationProvider } from '@/contexts/NotificationContext'
import { useUiStore } from '@/stores/uiStore'
import { syncProviderKeyStatuses } from '@/services/providerKeyStatus'
import { GlobalAlertDialog } from '@/components/ui/GlobalAlertDialog'
import {
  closeAssetLibrary,
  openAssetLibrary,
  switchWorkspace,
  useNavigationStore,
} from '@/stores/navigationStore'
import { useAssistantHostBridge } from '@/features/assistant/frontendTools/useAssistantHostBridge'
import { toggleAssistant, useAssistantUiStore } from '@/features/assistant/store/assistantUiStore'
import { openAssistantForDiagnosis } from '@/features/assistant/diagnostics/openAssistantDiagnosis'
import { UI_DURATION, uiTransition } from '@/components/ui/motion'

const logger = createLogger('App')

// 设置面板、智能助手、资产悬浮面板都是「按需打开」的浮层，却各自拖着一大棵子树
// （设置分区、Markdown 渲染、资产库列表）。放进启动同步图会让冷启动白解析一遍，
// 因此改为首次打开时才加载；打开过之后保持挂载，退场动画不受影响。
const SettingsModal = lazy(() => import('@/components/Settings'))
const AssistantSidebar = lazy(() =>
  import('@/features/assistant/AssistantSidebar').then((m) => ({ default: m.AssistantSidebar })),
)
const AssetLibraryFloatingPanel = lazy(() =>
  import('@/features/assets/AssetLibraryFloatingPanel').then((m) => ({ default: m.AssetLibraryFloatingPanel })),
)

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
  const [isReady, setIsReady] = useState(false)
  useAssistantHostBridge(isReady)
  const activeWorkspace = useNavigationStore((state) => state.activeWorkspace)
  // 设置面板开关提到 uiStore：错误弹窗的「去设置」可能从任意深度的组件触发
  const isSettingsOpen = useUiStore((state) => state.isSettingsOpen)
  const settingsTarget = useUiStore((state) => state.settingsTarget)
  const openSettings = useUiStore((state) => state.openSettings)
  const closeSettings = useUiStore((state) => state.closeSettings)
  const assetView = useAssetLibraryStore((state) => state.view)
  const assetTabAction = useSettingsStore((state) => state.assetTabAction)
  const assetPanelPosition = useSettingsStore((state) => state.assetPanelPosition)
  const assetEdgeTriggerEnabled = useSettingsStore((state) => state.assetEdgeTriggerEnabled)
  const assetTriggerEdge = useSettingsStore((state) => state.assetTriggerEdge)
  const assetEdgeDelayMs = useSettingsStore((state) => state.assetEdgeDelayMs)
  const assetDragEdgeDelayMs = useSettingsStore((state) => state.assetDragEdgeDelayMs)
  const assistantOpen = useAssistantUiStore((state) => state.open)
  const assistantMode = useAssistantUiStore((state) => state.mode)
  const assistantSize = useAssistantUiStore((state) => state.size)
  const assistantWorkspaceRef = React.useRef<HTMLDivElement>(null)
  // 懒加载浮层的「装载闩」：打开过一次就一直挂着，避免每次开关都重新触发 Suspense
  const [assistantMounted, setAssistantMounted] = useState(false)
  const [assetPanelMounted, setAssetPanelMounted] = useState(false)

  const openAssetFloating = React.useCallback((): void => {
    openAssetLibrary('floating')
  }, [])
  useAssetEdgeTrigger({ enabled: assetEdgeTriggerEnabled && !isSettingsOpen, edge: assetTriggerEdge, delayMs: assetEdgeDelayMs, dragDelayMs: assetDragEdgeDelayMs, open: assetView !== 'closed', onOpen: openAssetFloating })

  const openAssetWorkspace = (): void => {
    openAssetLibrary('workspace')
  }
  const closeAssets = React.useCallback((): void => {
    closeAssetLibrary()
  }, [])
  const handleAssetClick = (): void => {
    if (assetView !== 'closed') { closeAssets(); return }
    if (assetTabAction === 'workspace') openAssetWorkspace(); else openAssetFloating()
  }
  const handleTabChange = switchWorkspace

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
  useEffect(() => {
    if (assistantOpen) setAssistantMounted(true)
  }, [assistantOpen])
  useEffect(() => {
    if (assetView === 'floating') setAssetPanelMounted(true)
  }, [assetView])
  useEffect(() => {
    const handleAssistantShortcut = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.key.toLowerCase() !== 'a') return
      event.preventDefault()
      toggleAssistant()
    }
    window.addEventListener('keydown', handleAssistantShortcut)
    return () => window.removeEventListener('keydown', handleAssistantShortcut)
  }, [])
  // 应用初始化
  useEffect(() => {
    // 启动链路每一段都可能把第一次切 Tab 堵在后面（画布的 hydrate 就排在 canvasProjectService
    // 之后），所以每段都要能单独看到耗时，否则只能靠猜。
    const step = async (event: string, run: () => Promise<unknown>): Promise<void> => {
      const startedAt = performance.now()
      try {
        await run()
        logger.info('启动阶段完成', { event, context: { durationMs: Math.round(performance.now() - startedAt) } })
      } catch (error) {
        logger.error('启动阶段失败', error, { event: `${event.replace(/\.completed$/, '')}.failed` })
      }
    }

    const initializeApp = async () => {
      // 0. 注册默认面板（必须在使用前注册）
      registerDefaultPanels()

      // 模型注册表与数据库互不依赖，串行等待只会推迟后面所有人。
      // 画布 hydrate 要等 canvasProjectService，所以这条链越早跑完越好。
      await Promise.all([
        step('app.startup.models.completed', loadAllModels),
        step('app.startup.database.completed', async () => {
          await databaseService.init()
          await canvasProjectService.init()
        }),
      ])

      // 供应商密钥状态与自定义模型都不参与首屏渲染，放到后面并行跑，不再挡住启动链。
      // 密钥状态不能省：画布/生成前置校验读的就是它，冷启动不同步会误判"未配置 API Key"。
      await Promise.all([
        step('app.startup.provider_keys.completed', syncProviderKeyStatuses),
        step('app.startup.custom_models.completed', async () => {
          const customModelService = getCustomModelService(databaseService)
          await customModelService.loadEnabledModels()
          await modelscopeCustomModelService.loadModelsToRegistry()
        }),
      ])
    }

    void initializeApp()
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
          transition: uiTransition(['opacity'], UI_DURATION.slow)
        }}
      >
        {/* 标题栏（含 Tab 切换） */}
        <WindowControls
          activeTab={activeWorkspace}
          assetView={assetView}
          onTabChange={handleTabChange}
          onAssetClick={handleAssetClick}
          onOpenSettings={() => openSettings()}
          assistantOpen={assistantOpen}
          onAssistantClick={toggleAssistant}
        />

        {/* 工作区容器 */}
        <TabContainer
          containerRef={assistantWorkspaceRef}
          activeTab={activeWorkspace}
          insetLeft={assistantOpen && assistantMode === 'left' ? assistantSize.width : 0}
          insetRight={assistantOpen && assistantMode === 'right' ? assistantSize.width : 0}
        />
        {/* 三个懒加载浮层必须各有各的 Suspense 边界。共用一个时，任意一个 chunk 首次挂起
            都会让整个边界回落到 fallback，React 会把边界内**已经挂载**的兄弟一起写成
            display:none 再恢复——表现就是"第一次打开设置，助手闪一下"。 */}
        <Suspense fallback={null}>
          {assetPanelMounted && (
            <AssetLibraryFloatingPanel open={assetView === 'floating'} position={assetPanelPosition} onClose={closeAssets} onOpenWorkspace={openAssetWorkspace} />
          )}
        </Suspense>
        <Suspense fallback={null}>
          {assistantMounted && <AssistantSidebar workspaceRef={assistantWorkspaceRef} />}
        </Suspense>
        <Suspense fallback={null}>
          {isSettingsOpen && <SettingsModal onClose={closeSettings} target={settingsTarget} />}
        </Suspense>
        <LargeUploadChoiceDialog />
        <GlobalAlertDialog onAskAssistant={openAssistantForDiagnosis} />
      </div>
    </NotificationProvider>
  )
}

export default App


