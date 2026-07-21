import { createLogger } from '@/core/logging'
import { useEffect, useState } from 'react'
import type { ReleaseInfo } from '@/services/updateChecker'
import { checkForUpdates, getCurrentVersion } from '@/services/updateChecker'
import { detectShell, getPlatform } from '@/platform/runtime'
import type { UpdaterCheckResult, UpdaterEvent } from '@/platform/contracts/updater'
import { isVersionIgnored, shouldCheckForUpdates, updateLastCheckTime } from '@/utils/updateConfig'

const logger = createLogger('workspaces.GenerationWorkspace.hooks.useUpdateCheck')
const GITHUB_RELEASES_URL = 'https://github.com/henjicc/Henji-AI/releases'

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

  const applyUpdaterResult = (result: UpdaterCheckResult): void => {
    if (!result.releaseInfo && !result.hasUpdate) return
    setReleaseInfo({
      version: result.latestVersion || result.releaseInfo?.version || '',
      name: result.releaseInfo?.name || '',
      body: result.releaseInfo?.body || '',
      publishedAt: result.releaseInfo?.publishedAt || new Date().toISOString(),
      htmlUrl: result.releaseInfo?.htmlUrl || GITHUB_RELEASES_URL,
      source: 'electron-updater',
      updateStatus: result.status,
      progressPercent: result.progress?.percent,
    })
    if (result.hasUpdate || result.status === 'downloaded' || result.status === 'downloading') {
      setShowUpdateDialog(true)
    }
  }

  useEffect(() => {
    if (detectShell() !== 'electron') return

    const unsubscribe = getPlatform().updater.onEvent((event: UpdaterEvent) => {
      if (event.type === 'error') {
        logger.error('[Workspace] Electron 更新器事件失败', event.result.errorMessage)
        return
      }
      applyUpdaterResult(event.result)
    })

    return unsubscribe
  }, [])

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

