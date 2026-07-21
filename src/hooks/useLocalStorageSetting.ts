import { useEffect, useState } from 'react'

export interface LocalStorageSettingSpec<T> {
  key: string
  parse: (raw: string | null) => T
}

export type LocalStorageSettingSpecs<T extends object> = {
  [K in keyof T]: LocalStorageSettingSpec<T[K]>
}

/**
 * 按 spec 集合同步读取一批 localStorage key，不监听变化，供非组件上下文（如回调内）即时取最新值。
 */
export function readLocalStorageSettings<T extends object>(
  specs: LocalStorageSettingSpecs<T>
): T {
  const result = {} as T
  for (const field of Object.keys(specs) as Array<keyof T>) {
    const spec = specs[field]
    result[field] = spec.parse(localStorage.getItem(spec.key))
  }
  return result
}

/**
 * 挂载时读取一批 localStorage key，并在 watchEvents 触发时重新读取。
 * specs/watchEvents 应传入模块级常量，保持引用稳定。
 */
export function useLocalStorageSettings<T extends object>(
  specs: LocalStorageSettingSpecs<T>,
  watchEvents: readonly string[]
): T {
  const [values, setValues] = useState<T>(() => readLocalStorageSettings(specs))

  useEffect(() => {
    const reload = (): void => setValues(readLocalStorageSettings(specs))
    reload()
    watchEvents.forEach((eventName) => window.addEventListener(eventName, reload))
    return () => {
      watchEvents.forEach((eventName) => window.removeEventListener(eventName, reload))
    }
  }, [specs, watchEvents])

  return values
}

export interface CollapseSettings {
  enableAutoCollapse: boolean
  collapseDelay: number
  collapseOnScrollOnly: boolean
}

export const COLLAPSE_SETTING_SPECS: LocalStorageSettingSpecs<CollapseSettings> = {
  enableAutoCollapse: { key: 'enable_auto_collapse', parse: (raw) => raw !== 'false' },
  collapseDelay: { key: 'collapse_delay', parse: (raw) => parseInt(raw || '500', 10) },
  collapseOnScrollOnly: { key: 'collapse_on_scroll_only', parse: (raw) => raw !== 'false' },
}

export const COLLAPSE_SETTING_CHANGED_EVENT = 'collapseSettingChanged'
export const COLLAPSE_WATCH_EVENTS: readonly string[] = [COLLAPSE_SETTING_CHANGED_EVENT]

export interface QuickDownloadSettings {
  enableQuickDownload: boolean
  quickDownloadButtonOnly: boolean
  quickDownloadPath: string
}

export const QUICK_DOWNLOAD_SETTING_SPECS: LocalStorageSettingSpecs<QuickDownloadSettings> = {
  enableQuickDownload: { key: 'enable_quick_download', parse: (raw) => raw === 'true' },
  quickDownloadButtonOnly: { key: 'quick_download_button_only', parse: (raw) => raw !== 'false' },
  quickDownloadPath: { key: 'quick_download_path', parse: (raw) => raw || '' },
}
