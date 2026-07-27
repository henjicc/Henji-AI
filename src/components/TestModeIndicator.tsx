/**
 * 测试模式指示器
 * 显示在窗口右上角，提示当前处于测试模式
 */

import React, { useState, useEffect } from 'react'
import { isTestModeEnabled } from '@/utils/testMode'
import { useI18n } from '@/hooks/useI18n'
import { Lightbulb } from 'lucide-react'

interface TestModeIndicatorProps {
  onOpenPanel: () => void
}

const TestModeIndicator: React.FC<TestModeIndicatorProps> = ({ onOpenPanel }) => {
  const { t } = useI18n('ui')
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
      className="fixed top-4 right-4 z-toast px-3 py-1.5 bg-yellow-500/90 hover:bg-yellow-500 text-black rounded-lg cursor-pointer transition-colors duration-200 shadow-panel flex items-center gap-2 text-sm font-medium"
      title={t('testMode.indicatorTitle')}
    >
      <Lightbulb className="h-4 w-4" />
      {t('testMode.indicatorLabel')}
    </div>
  )
}

export default TestModeIndicator
