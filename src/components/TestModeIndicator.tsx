/**
 * 测试模式指示器
 * 显示在窗口右上角，提示当前处于测试模式
 */

import React, { useState, useEffect } from 'react'
import { isTestModeEnabled } from '@/utils/testMode'

interface TestModeIndicatorProps {
  onOpenPanel: () => void
}

const TestModeIndicator: React.FC<TestModeIndicatorProps> = ({ onOpenPanel }) => {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    // 初始化状态
    setEnabled(isTestModeEnabled())

    // 监听测试模式变化
    const handleTestModeChange = (event: CustomEvent) => {
      setEnabled(event.detail.enabled)
    }

    window.addEventListener('test-mode-changed', handleTestModeChange as EventListener)

    return () => {
      window.removeEventListener('test-mode-changed', handleTestModeChange as EventListener)
    }
  }, [])

  if (!enabled) return null

  return (
    <div
      onClick={onOpenPanel}
      className="fixed top-4 right-4 z-50 px-3 py-1.5 bg-yellow-500/90 hover:bg-yellow-500 text-black rounded-lg cursor-pointer transition-all duration-200 shadow-lg backdrop-blur-sm flex items-center gap-2 text-sm font-medium"
      title="点击打开测试面板 (Ctrl+Alt+Shift+T)"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z"
        />
      </svg>
      测试模式
    </div>
  )
}

export default TestModeIndicator
