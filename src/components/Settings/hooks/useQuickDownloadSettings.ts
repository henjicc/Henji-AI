import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useSettings } from './useSettings'

export interface UseQuickDownloadSettingsResult {
  enableQuickDownload: boolean
  quickDownloadButtonOnly: boolean
  quickDownloadPath: string
  setEnableQuickDownload: (value: boolean) => void
  setQuickDownloadButtonOnly: (value: boolean) => void
  setQuickDownloadPath: (value: string) => void
  selectQuickDownloadPath: () => Promise<void>
}

export function useQuickDownloadSettings(): UseQuickDownloadSettingsResult {
  const { settings, updateSetting } = useSettings()

  const setEnableQuickDownload = (value: boolean) => {
    updateSetting('enableQuickDownload', value)
  }

  const setQuickDownloadButtonOnly = (value: boolean) => {
    updateSetting('quickDownloadButtonOnly', value)
  }

  const setQuickDownloadPath = (value: string) => {
    updateSetting('quickDownloadPath', value)
  }

  const selectQuickDownloadPath = async () => {
    const selected = await openDialog({
      directory: true,
      multiple: false
    })
    if (!selected || Array.isArray(selected)) {
      return
    }
    setQuickDownloadPath(selected)
  }

  return {
    enableQuickDownload: settings.enableQuickDownload,
    quickDownloadButtonOnly: settings.quickDownloadButtonOnly,
    quickDownloadPath: settings.quickDownloadPath,
    setEnableQuickDownload,
    setQuickDownloadButtonOnly,
    setQuickDownloadPath,
    selectQuickDownloadPath
  }
}
