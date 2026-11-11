import { DOCUMENT_PACKAGE_EXTENSION, type DocumentContainerRef, type DocumentTarget, type PackageExportResult, type PackageImportResult } from '@/core/documents/types'
import { henjiDialogExtensions, matchHenjiExtension } from '@/core/fileExtensions'
import { appDirectories, join, openDialog, saveDialog } from '@/platform/desktopApi'

import { getDocumentOperations, type DocumentOperations } from './documentOperations'

/*
 * 单文件包的界面入口（4.1）：选位置 / 选文件交给系统对话框，打包与导入交给通用文档操作（与助手同一服务）。
 * 通用卡片右键“导出为单个文件…”、页头“导入单个文件…”与剪辑项目页、剪辑素材面板共用这里。
 * 用户取消对话框时返回 null。
 */

const EXTENSION = DOCUMENT_PACKAGE_EXTENSION.slice(1)
const FILTERS = [{ name: '痕迹AI 单文件包', extensions: [EXTENSION] }]
/** 导入时旧后缀的包也能选。 */
const OPEN_FILTERS = [{ name: '痕迹AI 单文件包', extensions: henjiDialogExtensions('document_package') }]

/** 默认位置：作品目录“导出”下以名称命名；取不到目录时只给文件名（系统对话框用上次的位置）。 */
async function defaultPackagePath(name: string): Promise<string> {
  const fileName = `${name}${DOCUMENT_PACKAGE_EXTENSION}`
  try {
    const directories = await appDirectories()
    return await join(directories.folders.exports, fileName)
  } catch {
    return fileName
  }
}

export async function exportDocumentPackageInteractive(
  document: DocumentTarget & { name: string },
  operations: DocumentOperations = getDocumentOperations(),
): Promise<PackageExportResult | null> {
  const destination = await saveDialog({ defaultPath: await defaultPackagePath(document.name), filters: FILTERS })
  if (!destination) return null
  return await operations.exportDocumentPackage({ id: document.id, ...(document.path ? { path: document.path } : {}) }, destination)
}

export async function exportProjectPackageInteractive(
  project: { id: string; name: string },
  operations: DocumentOperations = getDocumentOperations(),
): Promise<PackageExportResult | null> {
  const destination = await saveDialog({ defaultPath: await defaultPackagePath(project.name), filters: FILTERS })
  if (!destination) return null
  return await operations.exportProjectPackage(project.id, destination)
}

/** 选一个包导入：文档包放进 container（默认作品目录），项目包放进“项目”文件夹。 */
export async function importPackageInteractive(
  container?: DocumentContainerRef,
  operations: DocumentOperations = getDocumentOperations(),
): Promise<PackageImportResult | null> {
  const selected = await openDialog({ multiple: false, filters: OPEN_FILTERS })
  const source = typeof selected === 'string' ? selected : Array.isArray(selected) ? selected[0] : null
  if (!source) return null
  return await operations.importPackage(source, container)
}

/** 拖进来的文件是不是单文件包（拖放与“导入包”走同一条导入）。 */
export function isDocumentPackagePath(path: string): boolean {
  return matchHenjiExtension('document_package', path) !== null
}

/** 包文件名（不含文件夹），界面提示“已导出”时用。 */
export function packageFileName(result: PackageExportResult): string {
  return result.path.slice(Math.max(result.path.lastIndexOf('/'), result.path.lastIndexOf('\\')) + 1)
}

/** 拖进文档列表的文件分三路：本类文档（打开）、单文件包（导入）、其他文件（交给页面）。 */
export function routeDroppedDocumentFiles(
  files: readonly File[],
  documentExtensions: readonly string[],
  pathOf: (file: File) => string,
): { documentPath?: string; packagePath?: string; rest: File[] } {
  const entries = files.map((file) => ({ file, path: pathOf(file) }))
  const isDocument = (path: string): boolean => documentExtensions.some((extension) => path.toLowerCase().endsWith(`.${extension.toLowerCase()}`))
  // 一次只打开一个文档、导入一个包；多拖进来的同类文件不当作“其他文件”交给页面
  return {
    documentPath: entries.find(({ path }) => isDocument(path))?.path,
    packagePath: entries.find(({ path }) => isDocumentPackagePath(path))?.path,
    rest: entries.filter(({ path }) => !isDocument(path) && !isDocumentPackagePath(path)).map(({ file }) => file),
  }
}

/** 包导入完成后的状态文案（文档列表页与剪辑项目页共用）。 */
export function describePackageImport(
  result: PackageImportResult,
  t: (key: string, options: { name: string }) => string,
): string {
  return result.type === 'project'
    ? t('documentLibrary.package.importedProject', { name: result.project.name })
    : t('documentLibrary.package.importedDocument', { name: result.meta.name })
}
