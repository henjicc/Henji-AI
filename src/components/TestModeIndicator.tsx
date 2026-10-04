/**
 * 测试模式指示器
 * 显示在窗口右上角，提示当前处于测试模式
 */

import React, { useState, useEffect } from 'react'
import { isTestModeEnabled } from '@/utils/testMode'
import { useI18n } from '@/hooks/useI18n'
import { FlaskConical } from 'lucide-react'
import { UiButton } from '@/components/ui'

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

  // 开发用徽标（任务 5.7）：放进生成页命令带右端（搜索之前），是可聚焦的按钮；警示色只进图标，不画实底抢主动作
  return (
    <UiButton variant="secondary" size="sm" onClick={onOpenPanel} title={t('testMode.indicatorTitle')}>
      <FlaskConical aria-hidden="true" className="mr-1.5 h-3.5 w-3.5 text-warning-text" />
      {t('testMode.indicatorLabel')}
    </UiButton>
  )
}

export default TestModeIndicator
