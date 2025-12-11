import { path } from '@tauri-apps/api'
import { mkdir, readDir, copyFile, remove, exists, writeFile, readFile } from '@tauri-apps/plugin-fs'
import { logError, logWarning, logInfo } from '../utils/errorLogger'

// ==================== 核心路径管理 ====================

/**
 * 获取默认数据根目录
 * @returns 默认数据目录路径（AppLocalData/Henji-AI）
 */
export async function getDefaultDataRoot(): Promise<string> {
  const appLocalDataDir = await path.appLocalDataDir()
  return await path.join(appLocalDataDir, 'Henji-AI')
}

/**
 * 获取当前数据根目录（默认或自定义）
 * @returns 当前使用的数据根目录路径
 */
export async function getDataRoot(): Promise<string> {
  const customPath = localStorage.getItem('custom_data_directory')
  if (customPath && customPath.trim()) {
    return customPath
  }
  return await getDefaultDataRoot()
}

/**
 * 获取 Media 子目录路径
 */
export async function getMediaPath(): Promise<string> {
  const root = await getDataRoot()
  return await path.join(root, 'Media')
}

/**
 * 获取 Waveforms 子目录路径
 */
export async function getWaveformsPath(): Promise<string> {
  const root = await getDataRoot()
  return await path.join(root, 'Waveforms')
}

/**
 * 获取 Uploads 子目录路径
 */
export async function getUploadsPath(): Promise<string> {
  const root = await getDataRoot()
  return await path.join(root, 'Uploads')
}

/**
 * 获取 history.json 文件路径
 */
export async function getHistoryFilePath(): Promise<string> {
  const root = await getDataRoot()
  return await path.join(root, 'history.json')
}

/**
 * 获取 presets.json 文件路径
 */
export async function getPresetsFilePath(): Promise<string> {
  const root = await getDataRoot()
  return await path.join(root, 'presets.json')
}

/**
 * 初始化数据目录（创建必要的子目录）
 * @param rootPath 数据根目录路径
 */
export async function initializeDataDirectory(rootPath: string): Promise<void> {
  try {
    // 创建根目录
    await mkdir(rootPath, { recursive: true })

    // 创建子目录
    await mkdir(await path.join(rootPath, 'Media'), { recursive: true })
    await mkdir(await path.join(rootPath, 'Waveforms'), { recursive: true })
    await mkdir(await path.join(rootPath, 'Uploads'), { recursive: true })
  } catch (error) {
    logError('初始化数据目录失败:', error)
    throw new Error(`初始化数据目录失败: ${error}`)
  }
}

/**
 * 设置自定义数据根目录
 * @param customPath 自定义目录路径
 */
export async function setCustomDataRoot(customPath: string): Promise<void> {
  localStorage.setItem('custom_data_directory', customPath)
}

/**
 * 恢复到默认数据根目录
 */
export async function resetToDefaultDataRoot(): Promise<void> {
  localStorage.removeItem('custom_data_directory')
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
    const testFilePath = await path.join(dirPath, '.henji_write_test')
    await writeFile(testFilePath, new Uint8Array([1, 2, 3]))

    // 尝试读取测试文件
    await readFile(testFilePath)

    // 删除测试文件
    await remove(testFilePath)

    return true
  } catch (error) {
    logError('目录验证失败:', error)
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
    logError('检查现有数据失败:', error)
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
      const fullPath = await path.join(dirPath, entry.name)

      if (entry.isDirectory) {
        // 递归收集子目录中的文件
        const subFiles = await collectFiles(fullPath, baseDir)
        files.push(...subFiles)
      } else {
        // 计算相对路径
        const relativePath = fullPath.replace(baseDir, '').replace(/^[\/\\]/, '')
        files.push(relativePath)
      }
    }
  } catch (error) {
    logError('收集文件失败:', error)
  }

  return files
}

/**
 * 创建迁移标记文件
 * @param dirPath 目录路径
 */
async function createMigrationMarker(dirPath: string): Promise<void> {
  const markerPath = await path.join(dirPath, '.migration_in_progress')
  await writeFile(markerPath, new TextEncoder().encode(new Date().toISOString()))
}

/**
 * 删除迁移标记文件
 * @param dirPath 目录路径
 */
async function removeMigrationMarker(dirPath: string): Promise<void> {
  const markerPath = await path.join(dirPath, '.migration_in_progress')
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
  const markerPath = await path.join(dirPath, '.migration_in_progress')
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

    // 6. 逐个复制文件
    for (let i = 0; i < files.length; i++) {
      const relativeFilePath = files[i]
      const sourceFilePath = await path.join(oldPath, relativeFilePath)
      const targetFilePath = await path.join(newPath, relativeFilePath)

      try {
        // 确保目标目录存在
        const targetDir = await path.dirname(targetFilePath)
        await mkdir(targetDir, { recursive: true })

        // 处理文件名冲突（仅在合并模式下）
        let finalTargetPath = targetFilePath
        if (mode === 'merge') {
          const targetExists = await exists(targetFilePath)
          if (targetExists) {
            // 添加时间戳后缀
            const timestamp = Date.now()
            const ext = await path.extname(targetFilePath)
            const basename = await path.basename(targetFilePath, ext)
            const dirname = await path.dirname(targetFilePath)
            finalTargetPath = await path.join(dirname, `${basename}_${timestamp}${ext}`)
          }
        }

        // 复制文件
        await copyFile(sourceFilePath, finalTargetPath)

        // 报告进度
        if (onProgress) {
          onProgress(i + 1, totalFiles, relativeFilePath)
        }
      } catch (error) {
        logError(`复制文件失败: ${relativeFilePath}`, error)
        // 继续复制其他文件
      }
    }

    // 7. 验证迁移完整性（检查关键文件）
    const criticalFiles = ['history.json', 'presets.json']
    for (const file of criticalFiles) {
      const oldFilePath = await path.join(oldPath, file)
      const newFilePath = await path.join(newPath, file)
      const oldExists = await exists(oldFilePath)
      const newExists = await exists(newFilePath)

      if (oldExists && !newExists) {
        throw new Error(`关键文件迁移失败: ${file}`)
      }
    }

    // 8. 删除迁移标记
    await removeMigrationMarker(newPath)

    // 9. 自动删除旧数据（根据用户决策）
    if (oldPath !== newPath) {
      await cleanupOldData(oldPath)
    }
  } catch (error) {
    logError('数据迁移失败:', error)
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
      logInfo('旧数据已清理:', oldPath)
    }
  } catch (error) {
    logError('清理旧数据失败:', error)
    // 不抛出错误，因为迁移已经成功
  }
}

// ==================== 路径转换工具 ====================

/**
 * 判断路径是否为绝对路径
 * @param filePath 文件路径
 * @returns 是否为绝对路径
 */
export function isAbsolutePath(filePath: string): boolean {
  // Windows: C:\ 或 D:\ 等
  // Unix/Mac: / 开头
  return /^[a-zA-Z]:[\\\/]/.test(filePath) || filePath.startsWith('/')
}

/**
 * 将绝对路径转换为相对于数据根目录的相对路径
 * @param absolutePath 绝对路径
 * @param dataRoot 数据根目录
 * @returns 相对路径
 */
export async function toRelativePath(absolutePath: string, dataRoot: string): Promise<string> {
  if (!absolutePath) return absolutePath

  // 如果已经是相对路径，直接返回
  if (!isAbsolutePath(absolutePath)) {
    return absolutePath
  }

  // 标准化路径分隔符
  const normalizedAbsolute = absolutePath.replace(/\\/g, '/')
  const normalizedRoot = dataRoot.replace(/\\/g, '/')

  // 如果路径在数据根目录下，返回相对路径
  if (normalizedAbsolute.startsWith(normalizedRoot)) {
    const relativePath = normalizedAbsolute.substring(normalizedRoot.length)
    // 移除开头的斜杠
    return relativePath.replace(/^\/+/, '')
  }

  // 如果路径不在数据根目录下，返回原路径
  // 这种情况可能发生在旧数据或外部文件
  return absolutePath
}

/**
 * 将相对路径转换为绝对路径
 * @param relativePath 相对路径
 * @param dataRoot 数据根目录
 * @returns 绝对路径
 */
export async function toAbsolutePath(relativePath: string, dataRoot: string): Promise<string> {
  if (!relativePath) return relativePath

  // 如果已经是绝对路径，直接返回
  if (isAbsolutePath(relativePath)) {
    return relativePath
  }

  // 拼接为绝对路径
  return await path.join(dataRoot, relativePath)
}

/**
 * 转换路径字符串（支持 ||| 分隔的多路径）
 * @param pathString 路径字符串（可能包含 ||| 分隔符）
 * @param dataRoot 数据根目录
 * @param toRelative 是否转换为相对路径（true）或绝对路径（false）
 * @returns 转换后的路径字符串
 */
export async function convertPathString(
  pathString: string | undefined,
  dataRoot: string,
  toRelative: boolean
): Promise<string | undefined> {
  if (!pathString) return pathString

  // 检查是否包含多路径分隔符
  if (pathString.includes('|||')) {
    const paths = pathString.split('|||')
    const convertedPaths = await Promise.all(
      paths.map(p => toRelative ? toRelativePath(p, dataRoot) : toAbsolutePath(p, dataRoot))
    )
    return convertedPaths.join('|||')
  }

  // 单个路径
  return toRelative ? toRelativePath(pathString, dataRoot) : toAbsolutePath(pathString, dataRoot)
}

/**
 * 转换路径数组
 * @param paths 路径数组
 * @param dataRoot 数据根目录
 * @param toRelative 是否转换为相对路径（true）或绝对路径（false）
 * @returns 转换后的路径数组
 */
export async function convertPathArray(
  paths: string[] | undefined,
  dataRoot: string,
  toRelative: boolean
): Promise<string[] | undefined> {
  if (!paths || paths.length === 0) return paths

  return Promise.all(
    paths.map(p => toRelative ? toRelativePath(p, dataRoot) : toAbsolutePath(p, dataRoot))
  )
}
