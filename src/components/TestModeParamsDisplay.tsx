/**
 * 测试模式参数显示窗口
 * 在右上角显示最后的请求参数
 */

import React, { useState, useEffect } from 'react'
import { getTestModeState, type TestModeState } from '@/utils/testMode'
import { UiIconButton, UiPanel } from '@/components/ui'
import { ChevronDown } from 'lucide-react'
import { ApiTraceViewer } from '@/components/debug/ApiTraceViewer'

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

  // 如果测试模式未启用或没有调试记录，不显示
  if (!state.enabled || (!state.lastTrace && !state.lastParams)) {
    return null
  }

  const modelLabel = state.lastTrace?.model ?? String(state.lastParams?.model ?? '未知模型')
  const lastTimestamp = state.lastTrace?.timestamp ?? String(state.lastParams?.timestamp ?? '')

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
            {modelLabel} - 真实 API 日志
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
          {state.lastTrace ? (
            <ApiTraceViewer traceRecord={state.lastTrace} compact />
          ) : (
            <pre className="text-gray-300 whitespace-pre-wrap break-all max-h-[500px] overflow-y-auto">
              {JSON.stringify(state.lastParams, null, 2)}
            </pre>
          )}
          {lastTimestamp && (
            <div className="mt-2 pt-2 border-t border-zinc-700/50 text-gray-500 text-[10px]">
              {new Date(lastTimestamp).toLocaleTimeString('zh-CN')}
            </div>
          )}
        </div>
      )}
    </UiPanel>
  )
}

export default TestModeParamsDisplay
