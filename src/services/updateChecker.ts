/**
 * 更新检测服务
 * 通过 GitHub API 检查应用是否有新版本
 */

import { fetch } from '@tauri-apps/plugin-http'
import { logError } from '../utils/errorLogger'

export interface ReleaseInfo {
  version: string
  name: string
  body: string
  publishedAt: string
  htmlUrl: string
  downloadUrl?: string
}

export interface UpdateCheckResult {
  hasUpdate: boolean
  currentVersion: string
  latestVersion?: string
  releaseInfo?: ReleaseInfo
}

const GITHUB_REPO_OWNER = 'henjicc'
const GITHUB_REPO_NAME = 'Henji-AI'
const GITHUB_API_URL = `https://api.github.com/repos/${GITHUB_REPO_OWNER}/${GITHUB_REPO_NAME}/releases/latest`

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
  // 从 package.json 获取版本号
  return '0.1.0'
}

/**
 * 检查是否有新版本
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
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
      downloadUrl: msiAsset?.browser_download_url
    }

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      releaseInfo
    }
  } catch (error) {
    logError('检查更新失败:', error)
    throw error
  }
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
