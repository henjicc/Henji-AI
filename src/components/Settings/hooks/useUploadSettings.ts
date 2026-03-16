import type { UploadProvider } from '@/core/config/providers'
import { useSettingsStore } from '@/stores/settingsStore'

export interface UseUploadSettingsResult {
  provider: UploadProvider
  fallbackEnabled: boolean
  setProvider: (provider: UploadProvider) => void
  setFallbackEnabled: (enabled: boolean) => void
}

export function useUploadSettings(): UseUploadSettingsResult {
  const provider = useSettingsStore((state) => state.uploadProvider)
  const fallbackEnabled = useSettingsStore((state) => state.uploadFallbackEnabled)
  const setProvider = useSettingsStore((state) => state.setUploadProvider)
  const setFallbackEnabled = useSettingsStore((state) => state.setUploadFallbackEnabled)

  return { provider, fallbackEnabled, setProvider, setFallbackEnabled }
}
