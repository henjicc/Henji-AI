import { createLogger } from '@/core/logging'
import React, { useState, useEffect } from 'react'
import WindowControls from './components/WindowControls'
import TabContainer from './components/TabContainer'
import SettingsModal from '@/components/Settings'
import { databaseService } from './services/database/DatabaseService'
import { canvasProjectService } from './services/canvasProjects'
import { getCustomModelService } from './services/customModels/CustomModelService'
import { loadAllModels } from './core/loaders'
import { registerDefaultPanels } from './core/panels'
import { useApplyRuntimeTheme } from './hooks/useApplyRuntimeTheme'
import { useDevToolsShortcut } from './hooks/useDevToolsShortcut'

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
  const [activeTab, setActiveTab] = useState('generation')
  const [isReady, setIsReady] = useState(false)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

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

      // 3. 加载启用的自定义模型
      try {
        const customModelService = getCustomModelService(databaseService)
        await customModelService.loadEnabledModels()
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
        onTabChange={setActiveTab}
        onOpenSettings={() => setIsSettingsOpen(true)}
      />

      {/* 工作区容器 */}
      <TabContainer activeTab={activeTab} />
      {isSettingsOpen && <SettingsModal onClose={() => setIsSettingsOpen(false)} />}
    </div>
  )
}

export default App


