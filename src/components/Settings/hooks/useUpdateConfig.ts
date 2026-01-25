import { useEffect, useState } from 'react'
import {
  clearIgnoredVersions,
  getUpdateConfig,
  setUpdateEnabled,
  setUpdateFrequency,
  updateLastCheckTime
} from '../../../utils/updateConfig'
import type { UpdateConfig } from '../../../utils/updateConfig'
import { checkForUpdates, getCurrentVersion } from '../../../services/updateChecker'
import type { UpdateCheckResult } from '../../../services/updateChecker'

export interface UseUpdateConfigResult {
  config: UpdateConfig
  currentVersion: string
  isChecking: boolean
  updateEnabled: (enabled: boolean) => void
  updateFrequency: (frequency: UpdateConfig['frequency']) => void
  clearIgnored: () => void
  checkNow: () => Promise<UpdateCheckResult>
}

export function useUpdateConfig(): UseUpdateConfigResult {
  const [config, setConfig] = useState<UpdateConfig>({
    enabled: true,
    frequency: 'daily',
    lastCheckTime: 0,
    ignoredVersions: []
  })
  const [isChecking, setIsChecking] = useState(false)
  const currentVersion = getCurrentVersion()

  useEffect(() => {
    const loadedConfig = getUpdateConfig()
    setConfig(loadedConfig)
  }, [])

  const updateEnabled = (enabled: boolean) => {
    setConfig(prev => ({ ...prev, enabled }))
    setUpdateEnabled(enabled)
  }

  const updateFrequency = (frequency: UpdateConfig['frequency']) => {
    setConfig(prev => ({ ...prev, frequency }))
    setUpdateFrequency(frequency)
  }

  const clearIgnored = () => {
    clearIgnoredVersions()
    setConfig(prev => ({ ...prev, ignoredVersions: [] }))
  }

  const checkNow = async () => {
    setIsChecking(true)
    try {
      const result = await checkForUpdates()
      updateLastCheckTime()
      return result
    } finally {
      setIsChecking(false)
    }
  }

  return {
    config,
    currentVersion,
    isChecking,
    updateEnabled,
    updateFrequency,
    clearIgnored,
    checkNow
  }
}
