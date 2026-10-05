import { createLogger } from '@/core/logging'
import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import { deleteAppSetting, getAppSetting, setAppSetting } from '@/commands/appSettings'
import i18n from 'i18next'
import type { AppDirectories } from '@/platform/contracts/system'
import {
  appDirectories,
  basename,
  copyFile,
  dirname,
  exists,
  extname,
  join,
  mkdir,
  readDir,
  readFile,
  remove,
  writeFile,
} from '@/platform/desktopApi'

const logger = createLogger('utils.dataPath')

const CUSTOM_DATA_DIR_SETTING_KEY = 'custom_data_directory'
let legacyMigrationDone = false

/**
 * 老用户的自定义数据目录曾经只存在 localStorage，迁移到 SQLite settings 表后一次性搬运并清理旧 key。
 * localStorage 清空/丢失曾导致应用静默回退默认目录、用户找不到之前迁移过去的文件。
 */
async function migrateLegacyCustomDataRoot(): Promise<void> {
  if (legacyMigrationDone) return
  legacyMigrationDone = true

  const legacy = localStorage.getItem(CUSTOM_DATA_DIR_SETTING_KEY)
  if (!legacy || !legacy.trim()) return

  try {
    const existing = await getAppSetting(CUSTOM_DATA_DIR_SETTING_KEY)
    if (!existing) {
      await setAppSetting(CUSTOM_DATA_DIR_SETTING_KEY, legacy.trim())
    }
    localStorage.removeItem(CUSTOM_DATA_DIR_SETTING_KEY)
  } catch (error) {
    logger.error('迁移自定义数据目录设置失败:', error)
  }
}

// ==================== 核心路径管理 ====================

/**
 * 目录唯一来源在主进程 `electron/main/services/appPaths.ts`，这里只读取快照，不自行拼接目录名。
 * 首次调用时把当前界面语言带给主进程，用于首次确定默认目录名称（痕迹AI / Henji AI）。
 */
export async function getAppDirectories(): Promise<AppDirectories> {
  const uiLanguage = i18n.resolvedLanguage ?? i18n.language
  return await appDirectories(uiLanguage ? { uiLanguage } : undefined)
}

/**
 * 获取默认用户目录（系统“文档”下的“痕迹AI”，首次创建后固定）
 */
export async function getDefaultDataRoot(): Promise<string> {
  return (await getAppDirectories()).defaultUserRoot
}

/**
 * 获取当前用户目录（默认或自定义）；生成记录等保存的相对路径以它为基准
 */
export async function getDataRoot(): Promise<string> {
  await migrateLegacyCustomDataRoot()
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
  await migrateLegacyCustomDataRoot()
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
  await migrateLegacyCustomDataRoot()
  return (await getAppDirectories()).folders.uploads
}

/**
 * 获取 history.json 文件路径（程序目录内）
 */
export async function getHistoryFilePath(): Promise<string> {
  return await join(await getProgramDataRoot(), 'history.json')
}

/**
 * 获取 presets.json 文件路径（程序目录内）
 */
export async function getPresetsFilePath(): Promise<string> {
  return await join(await getProgramDataRoot(), 'presets.json')
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

/**
 * 设置自定义数据根目录
 * @param customPath 自定义目录路径
 */
export async function setCustomDataRoot(customPath: string): Promise<void> {
  await setAppSetting(CUSTOM_DATA_DIR_SETTING_KEY, customPath)
}

/**
 * 恢复到默认数据根目录
 */
export async function resetToDefaultDataRoot(): Promise<void> {
  await deleteAppSetting(CUSTOM_DATA_DIR_SETTING_KEY)
}

// ==================== 验证和检查 ====================

/**
 * 验证目录是否可写
 * @param dirPath 目录路径
 * @returns 是否可写
 */
export async function validateDirectory(dirPath: string): Promise<boolean> {
  try {
    // 确保目录存在
    await mkdir(dirPath, { recursive: true })

    // 尝试创建测试文件
    const testFilePath = await join(dirPath, '.henji_write_test')
    await writeFile(testFilePath, new Uint8Array([1, 2, 3]))

    // 尝试读取测试文件
    await readFile(testFilePath)

    // 删除测试文件
    await remove(testFilePath)

    return true
  } catch (error) {
    logger.error('目录验证失败:', error)
    return false
  }
}

/**
 * 检查目录是否包含 Henji-AI 数据
 * @param dirPath 目录路径
 * @returns 是否包含数据
 */
export async function hasExistingData(dirPath: string): Promise<boolean> {
  try {
    const dirExists = await exists(dirPath)
    if (!dirExists) {
      return false
    }

    // 检查是否有关键文件或子目录
    const entries = await readDir(dirPath)
    return entries.length > 0
  } catch (error) {
    logger.error('检查现有数据失败:', error)
    return false
  }
}

// ==================== 数据迁移 ====================

/**
 * 收集目录中的所有文件
 * @param dirPath 目录路径
 * @param baseDir 基础目录（用于计算相对路径）
 * @returns 文件路径数组（相对于 baseDir）
 */
async function collectFiles(dirPath: string, baseDir: string): Promise<string[]> {
  const files: string[] = []

  try {
    const dirExists = await exists(dirPath)
    if (!dirExists) {
      return files
    }

    const entries = await readDir(dirPath)

    for (const entry of entries) {
      const fullPath = await join(dirPath, entry.name)

      if (entry.isDirectory) {
        // 递归收集子目录中的文件
        const subFiles = await collectFiles(fullPath, baseDir)
        files.push(...subFiles)
      } else {
        // 计算相对路径
        const relativePath = fullPath.replace(baseDir, '').replace(/^[/\\]/, '')
        files.push(relativePath)
      }
    }
  } catch (error) {
    // 读不全文件清单就不能继续：迁移结束会删除旧目录，漏掉的文件就丢了（5.8）
    logger.error('数据迁移读取文件清单失败', error, { event: 'data_path.migration.list_failed' })
    throw error
  }

  return files
}

/**
 * 创建迁移标记文件
 * @param dirPath 目录路径
 */
async function createMigrationMarker(dirPath: string): Promise<void> {
  const markerPath = await join(dirPath, '.migration_in_progress')
  await writeFile(markerPath, new TextEncoder().encode(new Date().toISOString()))
}

/**
 * 删除迁移标记文件
 * @param dirPath 目录路径
 */
async function removeMigrationMarker(dirPath: string): Promise<void> {
  const markerPath = await join(dirPath, '.migration_in_progress')
  try {
    await remove(markerPath)
  } catch (error) {
    // 忽略删除失败
  }
}

/**
 * 检查是否有未完成的迁移
 * @param dirPath 目录路径
 * @returns 是否有未完成的迁移
 */
export async function hasPendingMigration(dirPath: string): Promise<boolean> {
  const markerPath = await join(dirPath, '.migration_in_progress')
  return await exists(markerPath)
}

/**
 * 迁移数据
 * @param oldPath 旧目录路径
 * @param newPath 新目录路径
 * @param onProgress 进度回调函数
 * @param mode 迁移模式：'normal' | 'merge' | 'overwrite'
 */
export async function migrateData(
  oldPath: string,
  newPath: string,
  onProgress?: (current: number, total: number, file: string) => void,
  mode: 'normal' | 'merge' | 'overwrite' = 'normal'
): Promise<void> {
  try {
    // 1. 验证新目录可写
    const isValid = await validateDirectory(newPath)
    if (!isValid) {
      throw new Error('目标目录无法写入')
    }

    // 2. 处理目录冲突
    if (mode === 'overwrite') {
      // 覆盖模式：删除新目录中的现有数据
      const newDirExists = await exists(newPath)
      if (newDirExists) {
        await remove(newPath, { recursive: true })
      }
    }

    // 3. 创建迁移标记
    await createMigrationMarker(newPath)

    // 4. 初始化新目录结构
    await initializeDataDirectory(newPath)

    // 5. 收集所有文件
    const files = await collectFiles(oldPath, oldPath)
    const totalFiles = files.length

    if (totalFiles === 0) {
      // 没有文件需要迁移
      await removeMigrationMarker(newPath)
      return
    }

    // 6. 逐个复制文件。单个文件失败继续复制其余文件以便一次报全，但只要有失败，迁移整体失败：
    // 后面第 9 步会删除旧目录，带着复制不全的新目录继续（例如数据库 henji.db 没拷过去）就是丢数据（5.8）。
    const failedFiles: string[] = []
    for (let i = 0; i < files.length; i++) {

      const relativeFilePath = files[i]
      const sourceFilePath = await join(oldPath, relativeFilePath)
      const targetFilePath = await join(newPath, relativeFilePath)

      try {
        // 确保目标目录存在
        const targetDir = await dirname(targetFilePath)
        await mkdir(targetDir, { recursive: true })

        // 处理文件名冲突（仅在合并模式下）
        let finalTargetPath = targetFilePath
        if (mode === 'merge') {
          const targetExists = await exists(targetFilePath)
          if (targetExists) {
            // 添加时间戳后缀
            const timestamp = Date.now()
            const ext = extname(targetFilePath)
            const baseName = basename(targetFilePath, ext)
            const targetParent = await dirname(targetFilePath)
            finalTargetPath = await join(targetParent, `${baseName}_${timestamp}${ext}`)
          }
        }

        // 复制文件
        await copyFile(sourceFilePath, finalTargetPath)

        // 报告进度
        if (onProgress) {
          onProgress(i + 1, totalFiles, relativeFilePath)
        }
      } catch (error) {
        logger.error('数据迁移复制文件失败', error, { event: 'data_path.migration.copy_failed', context: { file: relativeFilePath } })
        failedFiles.push(relativeFilePath)
      }
    }
    if (failedFiles.length > 0) {
      const sample = failedFiles.slice(0, 3).join('、')
      throw new Error(`${failedFiles.length} 个文件没能复制到新目录（${sample}${failedFiles.length > 3 ? ' 等' : ''}），原目录的数据保持不变`)
    }

    // 7. 验证迁移完整性（检查关键文件）
    const criticalFiles = ['history.json', 'presets.json']
    for (const file of criticalFiles) {
      const oldFilePath = await join(oldPath, file)
      const newFilePath = await join(newPath, file)
      const oldExists = await exists(oldFilePath)
      const newExists = await exists(newFilePath)

      if (oldExists && !newExists) {
        throw new Error(`关键文件迁移失败: ${file}`)
      }
    }

    // 8. 删除迁移标记
    await removeMigrationMarker(newPath)

    // 数据库记录里的位置都按作品目录相对记录（存储底座 2.3），换目录不需要改写记录。

    // 9. 自动删除旧数据（根据用户决策）
    if (oldPath !== newPath) {
      await cleanupOldData(oldPath)
    }
  } catch (error) {
    logger.error('数据迁移中止', error, { event: 'data_path.migration.aborted' })
    // 尝试删除迁移标记
    try {
      await removeMigrationMarker(newPath)
    } catch (e) {
      // 忽略
    }
    throw error
  }
}

/**
 * 清理旧数据（迁移成功后调用）
 * @param oldPath 旧目录路径
 */
export async function cleanupOldData(oldPath: string): Promise<void> {
  try {
    const oldExists = await exists(oldPath)
    if (oldExists) {
      await remove(oldPath, { recursive: true })
      logger.info('旧数据已清理:', oldPath)
    }
  } catch (error) {
    logger.error('清理旧数据失败:', error)
    // 不抛出错误，因为迁移已经成功
  }
}

// 生成记录等数据库记录里的路径换算在主进程仓库完成（存储底座 2.3），渲染层只处理绝对路径。
