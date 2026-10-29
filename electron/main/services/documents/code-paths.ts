import fsp from 'node:fs/promises'
import path from 'node:path'
import { isPathInside, type PathStyle } from '../../../../src/core/storage/pathSyntax'

/** 收集代码时目标位置由软件推导，链接不能把自动复制引向用户未指定的位置。 */
export async function ensureCodeCollectionTarget(root: string, target: string, style: PathStyle): Promise<void> {
  if (!isPathInside(style, root, target) || target === root) throw new Error('收集目标必须位于目标容器内。')
  // 逐层核对目标目录，避免链接改变自动收集的写入位置。
  const relative = path.relative(root, target); let current = root
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    const stat = await fsp.lstat(current).catch(error => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
    if (stat?.isSymbolicLink()) throw new Error('收集目标包含链接，无法确认自动写入位置。')
  }
  const realRoot = await fsp.realpath(root); const parent = await fsp.realpath(path.dirname(target)).catch(() => null)
  if (parent && !isPathInside(style, realRoot, parent)) throw new Error('收集目标的真实位置不在目标容器内。')
}
