import { createLogger } from '@/core/logging'
import { useEffect, useState } from 'react'
import type { ReleaseInfo } from '@/services/updateChecker'
import { checkForUpdates, getCurrentVersion } from '@/services/updateChecker'
import { isVersionIgnored, shouldCheckForUpdates, updateLastCheckTime } from '@/utils/updateConfig'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.useUpdateCheck')

export interface UseUpdateCheckReturn {
  showUpdateDialog: boolean
  releaseInfo: ReleaseInfo | null
  currentVersion: string
  closeUpdateDialog: () => void
}

export function useUpdateCheck(): UseUpdateCheckReturn {
  const [showUpdateDialog, setShowUpdateDialog] = useState(false)
  const [releaseInfo, setReleaseInfo] = useState<ReleaseInfo | null>(null)
  const [currentVersion] = useState(() => getCurrentVersion())

  useEffect(() => {
    const run = async (): Promise<void> => {
      if (!shouldCheckForUpdates()) return

      try {
        logger.info('[Workspace] 开始检查更新...', {})
        const result = await checkForUpdates()
        updateLastCheckTime()

        if (result.hasUpdate && result.releaseInfo) {
          const latestVersion = result.latestVersion || result.releaseInfo.version
          if (isVersionIgnored(latestVersion)) {
            logger.info('[Workspace] 版本已忽略', { latestVersion })
            return
          }
          setReleaseInfo(result.releaseInfo)
          setShowUpdateDialog(true)
        }
      } catch (error) {
        logger.error('[Workspace] 检查更新失败', error)
      }
    }

    const timer = window.setTimeout(() => {
      void run()
    }, 2000)

    return () => window.clearTimeout(timer)
  }, [])

  return {
    showUpdateDialog,
    releaseInfo,
    currentVersion,
    closeUpdateDialog: () => setShowUpdateDialog(false),
  }
}

