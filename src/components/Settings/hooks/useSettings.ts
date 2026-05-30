import { useEffect, useState } from 'react'
import {
  DEFAULT_USD_TO_CNY_RATE,
  PRICE_ESTIMATE_CURRENCY_MODE_STORAGE_KEY,
  PRICE_SETTING_CHANGED_EVENT,
  SHOW_PRICE_ESTIMATE_STORAGE_KEY,
  USD_TO_CNY_RATE_STORAGE_KEY,
  normalizePriceEstimateCurrencyMode,
  normalizeUsdToCnyRate,
  readPriceEstimateDisplaySettings,
  type PriceEstimateCurrencyMode,
} from '@/core/pricing/priceDisplay'
import {
  normalizePromptOptimizationButtonBehavior,
  readPromptOptimizationButtonBehavior,
  writePromptOptimizationButtonBehavior,
  type PromptOptimizationButtonBehavior,
} from '@/core/llm/promptOptimizationBehavior'

interface Settings {
  maxHistoryCount: number
  showPriceEstimate: boolean
  priceEstimateCurrencyMode: PriceEstimateCurrencyMode
  usdToCnyRate: number
  enableAutoCollapse: boolean
  collapseDelay: number
  collapseOnScrollOnly: boolean
  enableQuickDownload: boolean
  quickDownloadButtonOnly: boolean
  quickDownloadPath: string
  enableAutoFocusModelSearch: boolean
  maxConcurrentTasks: number
  promptOptimizationButtonBehavior: PromptOptimizationButtonBehavior
}

const DEFAULT_SETTINGS: Settings = {
  maxHistoryCount: 50,
  showPriceEstimate: true,
  priceEstimateCurrencyMode: 'auto',
  usdToCnyRate: DEFAULT_USD_TO_CNY_RATE,
  enableAutoCollapse: true,
  collapseDelay: 500,
  collapseOnScrollOnly: true,
  enableQuickDownload: false,
  quickDownloadButtonOnly: true,
  quickDownloadPath: '',
  enableAutoFocusModelSearch: true,
  maxConcurrentTasks: 2,
  promptOptimizationButtonBehavior: 'select-profile',
}

type SettingsKey = keyof Settings

export interface UseSettingsResult {
  settings: Settings
  updateSetting: <K extends SettingsKey>(key: K, value: Settings[K]) => void
}

const COLLAPSE_SETTING_KEYS: SettingsKey[] = [
  'enableAutoCollapse',
  'collapseDelay',
  'collapseOnScrollOnly'
]

const PRICE_SETTING_KEYS: SettingsKey[] = [
  'showPriceEstimate',
  'priceEstimateCurrencyMode',
  'usdToCnyRate',
]

export function useSettings(): UseSettingsResult {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)

  // 加载设置
  useEffect(() => {
    const loadSettings = () => {
      const priceSettings = readPriceEstimateDisplaySettings()
      const loaded: Settings = {
        maxHistoryCount: parseInt(localStorage.getItem('max_history_count') || '50', 10),
        showPriceEstimate: priceSettings.showPriceEstimate,
        priceEstimateCurrencyMode: priceSettings.currencyMode,
        usdToCnyRate: priceSettings.usdToCnyRate,
        enableAutoCollapse: localStorage.getItem('enable_auto_collapse') !== 'false',
        collapseDelay: parseInt(localStorage.getItem('collapse_delay') || '500', 10),
        collapseOnScrollOnly: localStorage.getItem('collapse_on_scroll_only') !== 'false',
        enableQuickDownload: localStorage.getItem('enable_quick_download') === 'true',
        quickDownloadButtonOnly: localStorage.getItem('quick_download_button_only') !== 'false',
        quickDownloadPath: localStorage.getItem('quick_download_path') || '',
        enableAutoFocusModelSearch: localStorage.getItem('enable_auto_focus_model_search') !== 'false',
        maxConcurrentTasks: parseInt(localStorage.getItem('max_concurrent_tasks') || '2', 10),
        promptOptimizationButtonBehavior: readPromptOptimizationButtonBehavior(),
      }
      setSettings(loaded)
    }
    loadSettings()
  }, [])

  // 更新单个设置
  const updateSetting = <K extends SettingsKey>(key: K, value: Settings[K]) => {
    const nextValue = key === 'priceEstimateCurrencyMode'
      ? normalizePriceEstimateCurrencyMode(value)
      : key === 'usdToCnyRate'
        ? normalizeUsdToCnyRate(value)
        : key === 'promptOptimizationButtonBehavior'
          ? normalizePromptOptimizationButtonBehavior(value)
        : value
    setSettings(prev => ({ ...prev, [key]: nextValue }))
    if (key === 'promptOptimizationButtonBehavior') {
      writePromptOptimizationButtonBehavior(nextValue)
      return
    }
    const storageKey = key === 'showPriceEstimate'
      ? SHOW_PRICE_ESTIMATE_STORAGE_KEY
      : key === 'priceEstimateCurrencyMode'
        ? PRICE_ESTIMATE_CURRENCY_MODE_STORAGE_KEY
        : key === 'usdToCnyRate'
          ? USD_TO_CNY_RATE_STORAGE_KEY
          : key.replace(/([A-Z])/g, '_$1').toLowerCase()
    localStorage.setItem(storageKey, String(nextValue))
    if (COLLAPSE_SETTING_KEYS.includes(key)) {
      window.dispatchEvent(new Event('collapseSettingChanged'))
    }
    if (PRICE_SETTING_KEYS.includes(key)) {
      window.dispatchEvent(new Event(PRICE_SETTING_CHANGED_EVENT))
    }
  }

  return { settings, updateSetting }
}
