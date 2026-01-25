import { useMemo, useState } from 'react'
import { UploadService, type UploadProviderType } from '@/services/upload/UploadService'

export interface UseUploadSettingsResult {
  provider: UploadProviderType
  fallbackEnabled: boolean
  setProvider: (provider: UploadProviderType) => void
  setFallbackEnabled: (enabled: boolean) => void
}

export function useUploadSettings(): UseUploadSettingsResult {
  const service = useMemo(() => UploadService.getInstance(), [])
  const [provider, setProviderState] = useState<UploadProviderType>(service.getCurrentProvider())
  const [fallbackEnabled, setFallbackEnabledState] = useState<boolean>(service.isFallbackEnabled())

  const setProvider = (next: UploadProviderType) => {
    service.setProvider(next)
    setProviderState(next)
  }

  const setFallbackEnabled = (enabled: boolean) => {
    service.setFallbackEnabled(enabled)
    setFallbackEnabledState(enabled)
  }

  return { provider, fallbackEnabled, setProvider, setFallbackEnabled }
}
