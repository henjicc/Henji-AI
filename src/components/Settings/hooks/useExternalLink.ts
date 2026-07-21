import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform/runtime'

const logger = createLogger('components.Settings.hooks.useExternalLink')

export interface UseExternalLinkResult {
  openExternal: (url: string) => Promise<void>
}

export function useExternalLink(): UseExternalLinkResult {
  const openExternal = async (url: string) => {
    try {
      await getPlatform().system.shell.openExternal(url)
    } catch (error) {
      logger.error('打开链接失败:', error)
    }
  }

  return { openExternal }
}

