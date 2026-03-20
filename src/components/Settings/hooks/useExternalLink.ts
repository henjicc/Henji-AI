import { createLogger } from '@/core/logging'
import { open } from '@tauri-apps/plugin-shell'

const logger = createLogger('components.Settings.hooks.useExternalLink')

export interface UseExternalLinkResult {
  openExternal: (url: string) => Promise<void>
}

export function useExternalLink(): UseExternalLinkResult {
  const openExternal = async (url: string) => {
    try {
      await open(url)
    } catch (error) {
      logger.error('打开链接失败:', error)
    }
  }

  return { openExternal }
}

