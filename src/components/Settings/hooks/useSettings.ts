import { useState, useEffect } from 'react'

interface Settings {
  maxHistoryCount: number
  showPriceEstimate: boolean
  enableAutoCollapse: boolean
  collapseDelay: number
  collapseOnScrollOnly: boolean
  enableQuickDownload: boolean
  quickDownloadButtonOnly: boolean
  quickDownloadPath: string
  enableAutoFocusModelSearch: boolean
  maxConcurrentTasks: number
}

const DEFAULT_SETTINGS: Settings = {
  maxHistoryCount: 50,
  showPriceEstimate: true,
  enableAutoCollapse: true,
  collapseDelay: 500,
  collapseOnScrollOnly: true,
  enableQuickDownload: false,
  quickDownloadButtonOnly: true,
  quickDownloadPath: '',
  enableAutoFocusModelSearch: true,
  maxConcurrentTasks: 2
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  // 加载设置
  useEffect(() => {
    const loadSettings = () => {
      const loaded: Settings = {
        maxHistoryCount: parseInt(localStorage.getItem('max_history_count') || '50', 10),
        showPriceEstimate: localStorage.getItem('show_price_estimate') !== 'false',
        enableAutoCollapse: localStorage.getItem('enable_auto_collapse') !== 'false',
        collapseDelay: parseInt(localStorage.getItem('collapse_delay') || '500', 10),
        collapseOnScrollOnly: localStorage.getItem('collapse_on_scroll_only') !== 'false',
        enableQuickDownload: localStorage.getItem('enable_quick_download') === 'true',
        quickDownloadButtonOnly: localStorage.getItem('quick_download_button_only') !== 'false',
        quickDownloadPath: localStorage.getItem('quick_download_path') || '',
        enableAutoFocusModelSearch: localStorage.getItem('enable_auto_focus_model_search') !== 'false',
        maxConcurrentTasks: parseInt(localStorage.getItem('max_concurrent_tasks') || '2', 10)
      }
      setSettings(loaded)
    }
    loadSettings()
  }, [])

  // 更新单个设置
  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }))
    localStorage.setItem(
      key.replace(/([A-Z])/g, '_$1').toLowerCase(),
      String(value)
    )
  }

  return { settings, updateSetting }
}
