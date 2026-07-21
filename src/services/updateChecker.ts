import { createLogger } from '@/core/logging'

const logger = createLogger('services.updateChecker')
/**
 * 更新检测服务
 * 通过 GitHub API 检查应用是否有新版本
 */

import { nativeFetch as fetch } from '@/platform/desktopApi'
import { detectShell, getPlatform } from '@/platform/runtime'
import type { UpdaterCheckResult } from '@/platform/contracts/updater'

export interface ReleaseInfo {
  version: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
  downloadUrl?: string
  source?: 'github-release' | 'electron-updater'
  updateStatus?: UpdaterCheckResult['status']
  progressPercent?: number
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  releaseInfo?: ReleaseInfo
  status?: UpdaterCheckResult['status']
  errorMessage?: string
}

const GITHUB_REPO_OWNER = 'henjicc'
const GITHUB_REPO_NAME = 'Henji-AI'
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases`

/**
 * 比较版本号
 * @param v1 版本1 (例如: "0.1.0")
 * @param v2 版本2 (例如: "0.2.0")
 * @returns 如果 v2 > v1 返回 true
 */
function compareVersions(v1: string, v2: string): boolean {
  const parts1 = v1.replace(/^v/, '').split('.').map(Number)
  const parts2 = v2.replace(/^v/, '').split('.').map(Number)

  for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {

    const part1 = parts1[i] || 0
    const part2 = parts2[i] || 0

    if (part2 > part1) return true
    if (part2 < part1) return false
  }

  return false
}

/**
 * 获取当前应用版本
 */
export function getCurrentVersion(): string {
  // 与 package.json 的 version 保持一致
  return '2.0.0'
}

function mapElectronUpdaterResult(result: UpdaterCheckResult): UpdateCheckResult {
  return {
    hasUpdate: result.hasUpdate,
    currentVersion: result.currentVersion,
    latestVersion: result.latestVersion,
    status: result.status,
    errorMessage: result.errorMessage,
    releaseInfo: result.releaseInfo
      ? {
          version: result.releaseInfo.version,
          name: result.releaseInfo.name,
          body: result.releaseInfo.body,
          publishedAt: result.releaseInfo.publishedAt,
          htmlUrl: result.releaseInfo.htmlUrl || GITHUB_RELEASES_URL,
          source: 'electron-updater',
          updateStatus: result.status,
          progressPercent: result.progress?.percent,
        }
      : undefined,
  }
}

async function checkElectronUpdates(): Promise<UpdateCheckResult> {
  const result = await getPlatform().updater.checkForUpdates()
  return mapElectronUpdaterResult(result)
}

/**
 * 检查是否有新版本
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  if (detectShell() === 'electron') {
    return await checkElectronUpdates()
  }

  const currentVersion = getCurrentVersion()

  try {
    const response = await fetch(GITHUB_API_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'Henji-AI-Update-Checker'
      }
    })

    if (!response.ok) {
      // 404 表示仓库没有 Release，这是正常情况
      if (response.status === 404) {
        return {
          hasUpdate: false,
          currentVersion
        }
      }
      throw new Error(`GitHub API 请求失败: ${response.status}`)
    }

    const data = await response.json() as {
      tag_name: string
      name: string
      body: string
      published_at: string
      html_url: string
      assets: Array<{
        name: string
        browser_download_url: string
      }>
    }

    const latestVersion = data.tag_name.replace(/^v/, '')
    const hasUpdate = compareVersions(currentVersion, latestVersion)

    // 查找 Windows MSI 安装包
    const msiAsset = data.assets.find(asset =>
      asset.name.endsWith('.msi') || asset.name.endsWith('.exe')
    )

    const releaseInfo: ReleaseInfo = {
      version: latestVersion,
      name: data.name,
      body: data.body,
      publishedAt: data.published_at,
      htmlUrl: data.html_url,
      downloadUrl: msiAsset?.browser_download_url,
      source: 'github-release',
    }

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      releaseInfo
    }
  } catch (error) {
    logger.error('检查更新失败:', error)
    throw error
  }
}

export async function downloadElectronUpdate(): Promise<UpdateCheckResult> {
  const result = await getPlatform().updater.downloadUpdate()
  return mapElectronUpdaterResult(result)
}

export async function installElectronUpdate(): Promise<void> {
  await getPlatform().updater.quitAndInstall()
}

/**
 * 格式化发布日期
 */
export function formatReleaseDate(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays === 0) {
    return '今天'
  } else if (diffDays === 1) {
    return '昨天'
  } else if (diffDays < 7) {
    return `${diffDays} 天前`
  } else if (diffDays < 30) {
    const weeks = Math.floor(diffDays / 7)
    return `${weeks} 周前`
  } else if (diffDays < 365) {
    const months = Math.floor(diffDays / 30)
    return `${months} 个月前`
  } else {
    return date.toLocaleDateString('zh-CN')
  }
}
