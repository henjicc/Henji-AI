import fs from 'node:fs/promises'
import path from 'node:path'
import type { RecycledLink } from './store'

/** 只复制链接本身；平台不支持创建时保留目标声明，不遍历链接外的内容。 */
export async function copyRecycledFile(source: string, target: string, warn: (file: string, error: unknown) => void): Promise<RecycledLink[]> {
  const links: RecycledLink[] = []
  const pending = [{ source, target }]
  while (pending.length) {
    const entry = pending.pop()!, stat = await fs.lstat(entry.source)
    if (stat.isSymbolicLink()) {
      const destination = await fs.readlink(entry.source)
      const directory = await fs.stat(entry.source).then(value => value.isDirectory(), () => false)
      try { await fs.symlink(destination, entry.target, directory ? (process.platform === 'win32' ? 'junction' : 'dir') : 'file') }
      catch (error) {
        if (!['EPERM', 'EACCES', 'ENOTSUP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
        links.push({ relativePath: path.relative(target, entry.target), target: destination, directory }); warn(entry.source, error)
      }
    } else if (stat.isDirectory()) {
      await fs.mkdir(entry.target)
      for (const name of await fs.readdir(entry.source)) pending.push({ source: path.join(entry.source, name), target: path.join(entry.target, name) })
    } else await fs.copyFile(entry.source, entry.target, fs.constants.COPYFILE_EXCL)
  }
  return links
}
