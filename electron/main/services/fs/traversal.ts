import fsp from 'node:fs/promises'
import path from 'node:path'

/** 普通路径无需 realpath；扫描根的任一父级可能是目录联接点。 */
export async function resolveLinkedPath(target: string): Promise<string> {
  const absolute = path.resolve(target)
  let current = absolute
  for (;;) {
    if ((await fsp.lstat(current)).isSymbolicLink()) return fsp.realpath(absolute)
    const parent = path.dirname(current)
    if (parent === current) return absolute
    current = parent
  }
}

export function isUnavailableTraversalEntry(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return typeof code === 'string' && ['EPERM', 'EACCES', 'ELOOP', 'UNKNOWN', 'EINVAL'].includes(code)
}

export function isMissingTraversalEntry(error: unknown): boolean {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  return code === 'ENOENT' || code === 'ENOTDIR'
}
