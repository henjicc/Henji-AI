import * as path from '@tauri-apps/api/path'
import { getDataRoot } from '@/utils/dataPath'

/**
 * 解析文件路径为绝对路径
 *
 * 处理逻辑：
 * - 如果是绝对路径（Windows: C:\\, D:\\, etc; Unix: /），直接返回
 * - 如果是相对路径（Uploads/..., Media/...），解析为数据目录下的绝对路径
 */
export async function resolveFilePath(filePath: string): Promise<string> {
  if (!filePath || filePath.trim() === '') {
    throw new Error('Empty file path provided')
  }

  const isAbsolute =
    /^[a-zA-Z]:[\\\/]/.test(filePath) || // Windows: C:\, D:\
    /^\//.test(filePath) ||              // Unix: /
    /^\\\\/.test(filePath)               // Windows UNC: \\server\share

  if (isAbsolute) return filePath

  const dataRoot = await getDataRoot()
  return await path.join(dataRoot, filePath)
}

