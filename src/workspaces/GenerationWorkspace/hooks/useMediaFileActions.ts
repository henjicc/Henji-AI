import { createLogger } from '@/core/logging'
import { useCallback } from 'react'
import { getPlatform } from '@/platform/runtime'
import { downloadMediaFile, quickDownloadMediaFile, resolveFilePath, isDesktop } from '@/utils/save'
import { QUICK_DOWNLOAD_SETTING_SPECS, readLocalStorageSettings } from '@/hooks/useLocalStorageSetting'
import type { ToastNotification } from '../types'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.useMediaFileActions')

export interface MediaFileActionMessages {
  downloadSuccess: string
  downloadInvalidPath: string
  downloadFailed: (reason: string) => string
  copySuccess: string
  copyMissingPath: string
  copyFailed: (reason: string) => string
}

export interface UseMediaFileActionsParams {
  notify: (message: string, type?: ToastNotification['type']) => void
  messages: MediaFileActionMessages
}

export interface UseMediaFileActionsReturn {
  download: (filePath: string, fromButton?: boolean) => Promise<void>
  copyImageToClipboard: (filePath?: string) => Promise<void>
}

export function useMediaFileActions({ notify, messages }: UseMediaFileActionsParams): UseMediaFileActionsReturn {
  const download = useCallback(async (filePath: string, fromButton: boolean = false): Promise<void> => {
    if (!filePath) {
      notify(messages.downloadInvalidPath, 'error')
      return
    }

    if (!isDesktop()) {
      notify(messages.downloadFailed('not_desktop'), 'error')
      return
    }

    try {
      const sourcePath = await resolveFilePath(filePath)

      const {
        enableQuickDownload: enableQuick,
        quickDownloadButtonOnly: buttonOnly,
        quickDownloadPath: quickPath,
      } = readLocalStorageSettings(QUICK_DOWNLOAD_SETTING_SPECS)

      const useQuick = enableQuick && (!buttonOnly || fromButton) && !!quickPath
      logger.info('[Workspace] 下载设置', { enableQuick, buttonOnly, quickPath, useQuick })

      if (useQuick) {
        await quickDownloadMediaFile(sourcePath, quickPath)
      } else {
        await downloadMediaFile(sourcePath)
      }

      notify(messages.downloadSuccess, 'success')
    } catch (err) {
      if (err instanceof Error && err.message === 'cancelled') {
        return
      }
      const reason = err instanceof Error ? err.message : String(err)
      logger.error('[Workspace] 下载失败', err)
      notify(messages.downloadFailed(reason), 'error')
    }
  }, [messages, notify])

  const copyImageToClipboard = useCallback(async (filePath?: string): Promise<void> => {
    if (!filePath) {
      notify(messages.copyMissingPath, 'error')
      return
    }

    if (!isDesktop()) {
      notify(messages.copyFailed('not_desktop'), 'error')
      return
    }

    try {
      const fullPath = await resolveFilePath(filePath)
      await getPlatform().clipboard.writeImageFromPath(fullPath)

      await new Promise<void>((resolve) => {
        setTimeout(() => {
          void document.body.offsetHeight
          resolve()
        }, 1)
      })

      notify(messages.copySuccess, 'success')
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      logger.error('[Workspace] 复制图片失败', err)
      notify(messages.copyFailed(reason), 'error')
    }
  }, [messages, notify])

  return { download, copyImageToClipboard }
}


