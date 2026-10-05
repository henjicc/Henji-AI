import { createLogger } from '@/core/logging'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import i18n from 'i18next'
import type { AppDirectories } from '@/platform/contracts/system'
import { appDirectories, join, mkdir } from '@/platform/desktopApi'

const logger = createLogger('utils.dataPath')

let lastAppDirectories: AppDirectories | null = null

// ==================== 核心路径管理 ====================

/**
 * 目录唯一来源在主进程 `electron/main/services/appPaths.ts`，这里只读取快照，不自行拼接目录名。
 * 首次调用时把当前界面语言带给主进程，用于首次确定默认目录名称（痕迹AI / Henji AI）。
 */
export async function getAppDirectories(): Promise<AppDirectories> {
  const uiLanguage = i18n.resolvedLanguage ?? i18n.language
  lastAppDirectories = await appDirectories(uiLanguage ? { uiLanguage } : undefined)
  return lastAppDirectories
}

/** 最近一次读取到的目录快照（同步读取用，如助手查询设置）；尚未读取过时为 null。 */
export function peekAppDirectories(): AppDirectories | null {
  return lastAppDirectories
}

/**
 * 获取当前作品目录（默认或自定义）
 */
export async function getDataRoot(): Promise<string> {
  return (await getAppDirectories()).userRoot
}

/**
 * 程序目录（数据库、日志、缩略图与内部存储，不随用户目录移动）
 */
export async function getProgramDataRoot(): Promise<string> {
  return (await getAppDirectories()).programDir
}

/**
 * 获取生成结果目录路径
 */
export async function getMediaPath(): Promise<string> {
  return (await getAppDirectories()).folders.generated
}

/**
 * 获取缩略图缓存目录路径（程序目录内）
 */
export async function getThumbnailsPath(): Promise<string> {
  return (await getAppDirectories()).thumbnailsDir
}

/**
 * 获取上传素材目录路径
 */
export async function getUploadsPath(): Promise<string> {
  return (await getAppDirectories()).folders.uploads
}

/**
 * 初始化用户目录（创建分类文件夹）
 * @param rootPath 用户目录路径
 */
export async function initializeDataDirectory(rootPath: string): Promise<void> {
  try {
    if (isDesktopRuntime()) {
      await getPlatform().media.allowRoot(rootPath)
    }

    await mkdir(rootPath, { recursive: true })
    const { folderNames } = await getAppDirectories()
    for (const name of Object.values(folderNames)) {
      await mkdir(await join(rootPath, name), { recursive: true })
    }
  } catch (error) {
    logger.error('初始化数据目录失败:', error)
    throw new Error(`初始化数据目录失败: ${error}`)
  }
}

// 更换作品目录在主进程整体移动文件夹（src/commands/workRoot.ts，任务 4.2）；记录里的位置都是相对写法，不需要改写。
