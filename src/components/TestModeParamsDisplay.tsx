/**
 * 测试模式参数显示窗口
 * 在右上角显示最后的请求参数
 */

import React, { useState, useEffect } from 'react'
import { getTestModeState, type TestModeState } from '@/utils/testMode'
import { UiIconButton, UiPanel } from '@/components/ui'
import { ChevronDown } from 'lucide-react'
import { UnifiedLogViewer } from '@/components/debug/UnifiedLogViewer'

const TestModeParamsDisplay: React.FC = () => {
  const [state, setState] = useState<TestModeState>(getTestModeState())
  const [isCollapsed, setIsCollapsed] = useState(false)

  useEffect(() => {
    // 初始化状态
    setState(getTestModeState())

    // 监听测试模式变化
    const handleTestModeChange = (event: CustomEvent) => {
      setState(event.detail)
    }

    window.addEventListener('test-mode-changed', handleTestModeChange as EventListener)

    return () => {
      window.removeEventListener('test-mode-changed', handleTestModeChange as EventListener)
    }
  }, [])

  if (!state.enabled) {
    return null
  }

  return (
    <UiPanel
      className="fixed top-16 right-4 z-40 border-yellow-500/30 shadow-2xl"
      style={{ maxWidth: '600px', minWidth: '400px' }}
    >
      {/* 标题栏 */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b border-yellow-500/20 cursor-pointer"
        onClick={() => setIsCollapsed(!isCollapsed)}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse" />
          <span className="text-xs font-medium text-yellow-500">
            测试模式 - 统一日志查看器
          </span>
        </div>
        <UiIconButton
          type="button"
          className="h-6 w-6 border-0 bg-transparent text-yellow-500/60 hover:text-yellow-500"
        >
          <ChevronDown className={`h-4 w-4 transition-transform ${isCollapsed ? 'rotate-180' : ''}`} />
        </UiIconButton>
      </div>

      {/* 内容区域 */}
      {!isCollapsed && (
        <div className="p-3 text-xs">
          <UnifiedLogViewer />
        </div>
      )}
    </UiPanel>
  )
}

export default TestModeParamsDisplay
