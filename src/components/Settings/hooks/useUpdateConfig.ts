import { useState, useEffect } from 'react'
import { getUpdateConfig, setUpdateEnabled, setUpdateFrequency, clearIgnoredVersions } from '../../../utils/updateConfig'
import type { UpdateConfig } from '../../../utils/updateConfig'

export function useUpdateConfig() {
  const [config, setConfig] = useState<UpdateConfig>({
    enabled: true,
    frequency: 'daily'
  })

  // 加载更新配置
  useEffect(() => {
    const loadedConfig = getUpdateConfig()
    setConfig(loadedConfig)
  }, [])

  // 更新启用状态
  const updateEnabled = (enabled: boolean) => {
    setConfig(prev => ({ ...prev, enabled }))
    setUpdateEnabled(enabled)
  }

  // 更新检查频率
  const updateFrequency = (frequency: 'always' | 'daily' | 'weekly' | 'never') => {
    setConfig(prev => ({ ...prev, frequency }))
    setUpdateFrequency(frequency)
  }

  // 清除忽略的版本
  const clearIgnored = () => {
    clearIgnoredVersions()
  }

  return { config, updateEnabled, updateFrequency, clearIgnored }
}
