import React, { useState, useEffect } from 'react'
import WindowControls from './components/WindowControls'
import TabContainer from './components/TabContainer'
import { DragDropProvider } from './contexts/DragDropContext'
import GlobalContextMenuProvider from './contexts/GlobalContextMenuProvider'
import { databaseService } from './services/database/DatabaseService'
import { canvasProjectService } from './services/canvasProjects'
import { getCustomModelService } from './services/customModels/CustomModelService'
import { loadAllModels } from './core/loaders'
import { registerDefaultPanels } from './core/panels'

/**
 * 简化后的 App 组件
 * 职责：
 * 1. 提供全局 Context Providers
 * 2. 渲染 WindowControls（标题栏 + Tab）
 * 3. 管理 Tab 切换和工作区渲染
 */
const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState('conversation')
  const [isReady, setIsReady] = useState(false)

  // 应用初始化
  useEffect(() => {
    const initializeApp = async () => {
      // 0. 注册默认面板（必须在使用前注册）
      registerDefaultPanels()

      // 1. 加载所有模型到 ModelRegistry
      try {
        const stats = await loadAllModels()
        // console.log('[App] Models loaded:', stats)
      } catch (error) {
        console.error('[App] Failed to load models:', error)
      }

      // 2. 初始化数据库
      await databaseService.init()

      // 2.1 初始化画布项目存储
      await canvasProjectService.init()

      // 3. 加载启用的自定义模型
      try {
        const customModelService = getCustomModelService(databaseService)
        await customModelService.loadEnabledModels()
      } catch (error) {
        console.error('[App] Failed to load custom models:', error)
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
    <DragDropProvider>
      <GlobalContextMenuProvider>
        <div
          className="h-screen min-h-screen bg-[#0a0b0d] text-white flex flex-col relative overflow-hidden"
          style={{
            opacity: isReady ? 1 : 0,
            transition: 'opacity 0.3s ease-in-out'
          }}
        >
          {/* 标题栏（含 Tab 切换） */}
          <WindowControls
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />

          {/* 工作区容器 */}
          <TabContainer activeTab={activeTab} />
        </div>
      </GlobalContextMenuProvider>
    </DragDropProvider>
  )
}

export default App
