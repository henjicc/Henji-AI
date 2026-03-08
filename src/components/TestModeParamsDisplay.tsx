/**
 * 测试模式参数显示窗口
 * 在右上角显示最后的请求参数
 */

import React, { useState, useEffect } from 'react'
import { getTestModeState, type TestModeState } from '@/utils/testMode'
import { UiIconButton, UiPanel } from '@/components/ui'
import { ChevronDown } from 'lucide-react'

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

  // 如果测试模式未启用或没有参数，不显示
  if (!state.enabled || !state.lastParams) {
    return null
  }

  const { lastParams } = state
  const { model, options, timestamp } = lastParams

  // 过滤出真正会传递给 API 的参数
  const getApiParams = () => {
    // 需要排除的参数（UI 状态参数和内部参数）
    const excludePatterns = [
      /^ppio/,           // ppioPixverse45VideoResolution 等
      /^fal[A-Z]/,       // falWan25VideoDuration 等
      /^video[A-Z]/,     // videoNegativePrompt 等
      /^uploaded/,       // uploadedFilePaths 等
      /^aspect_ratio$/,  // 通用参数
      /^num_images$/,    // 通用参数
    ]

    const apiParams: Record<string, unknown> = {}

    for (const [key, value] of Object.entries(options)) {
      // 检查是否应该排除
      const shouldExclude = excludePatterns.some(pattern => pattern.test(key))

      if (!shouldExclude) {
        apiParams[key] = value
      }
    }

    return apiParams
  }

  const apiParams = getApiParams()

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
            {model} - API 参数
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
          <pre className="text-gray-300 whitespace-pre-wrap break-all max-h-[500px] overflow-y-auto">
            {JSON.stringify(apiParams, null, 2)}
          </pre>
          {timestamp && (
            <div className="mt-2 pt-2 border-t border-zinc-700/50 text-gray-500 text-[10px]">
              {new Date(timestamp).toLocaleTimeString('zh-CN')}
            </div>
          )}
        </div>
      )}
    </UiPanel>
  )
}

export default TestModeParamsDisplay
