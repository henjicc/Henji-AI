import fsp from 'node:fs/promises'
import path from 'node:path'
import { isPathInside, type PathStyle } from '../../../../src/core/storage/pathSyntax'

/** Shared code path boundary for publication and container transfers. */
export async function ensureCodeLocation(root: string, target: string, style: PathStyle, create = false, created?: string[]): Promise<void> {
  const codeRoot = path.join(root, '代码')
  if (!isPathInside(style, codeRoot, target) || target === codeRoot) throw new Error('代码文件位置越界，必须位于此文档所在项目的“代码”文件夹内。')
  // Check each existing ancestor before mkdir/open, including junctions and symbolic links.
  const relative = path.relative(root, target); let current = root
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    const stat = await fsp.lstat(current).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
    if (stat?.isSymbolicLink()) throw new Error('代码文件位置包含链接，不能写入或读取项目之外的文件。')
    if (!stat && create && current !== target) { await fsp.mkdir(current); created?.push(current) }
  }
  const realRoot = await fsp.realpath(root); const parent = await fsp.realpath(path.dirname(target)).catch(() => null)
  if (parent && !isPathInside(style, realRoot, parent)) throw new Error('代码文件真实位置越界，请移除指向项目外的链接。')
}
