import fs from 'node:fs/promises'
import path from 'node:path'

// The desktop composition root supplies application roots. Standalone cache stores
// remain usable in isolated tests/hosts without importing Electron or the database.
let roots: () => readonly string[] = () => []
export function configureCacheDeletionBoundary(provider: () => readonly string[]): void { roots = provider }

async function resolved(target: string): Promise<string> {
  try { return await fs.realpath(target) }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    const parent = path.dirname(target)
    return parent === target ? target : path.join(await resolved(parent), path.basename(target))
  }
}

/** Cache owners may remove their own storage, never a managed root or its files.
 * Resolve parent junctions too; lexical path checks alone are insufficient. */
export async function removeUnmanagedCachePath(target: string, options: { recursive?: boolean; force?: boolean } = {}): Promise<void> {
  const key = (value: string): string => process.platform === 'win32' ? value.toLowerCase() : value
  const location = key(await resolved(path.resolve(target)))
  for (const root of roots()) {
    const managed = key(await resolved(path.resolve(root)))
    const inside = (parent: string, child: string): boolean => child === parent || child.startsWith(`${parent}${path.sep}`)
    if (inside(managed, location) || (options.recursive && inside(location, managed))) throw new Error('Cache cleanup cannot delete managed media')
  }
  // media-recycle-allow: cache storage deletion after canonical managed-root exclusion.
  await fs.rm(target, options)
}
