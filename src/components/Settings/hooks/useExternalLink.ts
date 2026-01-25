import { open } from '@tauri-apps/plugin-shell'
import { logError } from '@/utils/errorLogger'

export interface UseExternalLinkResult {
  openExternal: (url: string) => Promise<void>
}

export function useExternalLink(): UseExternalLinkResult {
  const openExternal = async (url: string) => {
    try {
      await open(url)
    } catch (error) {
      logError('打开链接失败:', error)
    }
  }

  return { openExternal }
}
