import type { DocumentContainerRef } from '@/core/documents/types'
import { getPlatform } from '@/platform/runtime'
import { getDocumentOperations, type DocumentOperations } from './documentOperations'

/** 文档所在项目的“导出”文件夹：助手与外部智能体的成品不指定位置时放这里，不弹保存对话框。 */
export async function projectExportDirectory(container: DocumentContainerRef, operations: DocumentOperations = getDocumentOperations()): Promise<string> {
  if (container.kind !== 'project') throw new Error('这份文档不在项目里，无法确定输出位置；请指定 destination（快速下载或预设目录）。')
  const project = await operations.findProject(container.projectId).catch(() => null)
  if (!project) throw new Error('文档所在项目找不到，请指定 destination。')
  return joinOutputPath(project.path, '导出')
}

/** 目录与文件名拼接，沿用目录自身的分隔符。 */
export function joinOutputPath(directory: string, name: string): string {
  const separator = directory.includes('\\') && !directory.includes('/') ? '\\' : '/'
  return `${directory.replace(/[\\/]+$/, '')}${separator}${name}`
}

/**
 * 在目录中取不重名的文件路径（重名加“ (2)”序号），不覆盖已有文件。
 * siblings 是同一次导出要一起写出的其他扩展名（如随 WAV 附带的 SRT），任何一个已存在都换下一个序号。
 */
export async function uniqueOutputPath(directory: string, name: string, extension: string, siblings: readonly string[] = []): Promise<string> {
  const fs = getPlatform().system.fs
  await fs.mkdir(directory, { recursive: true })
  const base = name.replace(/[\\/:*?"<>|]/g, '-').trim() || '输出'
  for (let attempt = 1; ; attempt++) {
    const stem = joinOutputPath(directory, attempt === 1 ? base : `${base} (${attempt})`)
    const taken = await Promise.all([extension, ...siblings].map((ext) => fs.exists(`${stem}.${ext}`)))
    if (!taken.some(Boolean)) return `${stem}.${extension}`
  }
}
