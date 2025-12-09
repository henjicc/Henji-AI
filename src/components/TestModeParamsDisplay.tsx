/**
 * 测试模式参数显示窗口
 * 在右上角显示最后的请求参数
 */

import React, { useState, useEffect } from 'react'
import { getTestModeState, type TestModeState } from '@/utils/testMode'

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

    const apiParams: Record<string, any> = {}

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
    <div
      className="fixed top-16 right-4 z-40 bg-[#1a1a1a]/95 backdrop-blur-lg border border-yellow-500/30 rounded-lg shadow-2xl"
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
        <button className="text-yellow-500/60 hover:text-yellow-500 transition-colors">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-4 w-4 transition-transform ${isCollapsed ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
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
    </div>
  )
}

export default TestModeParamsDisplay
