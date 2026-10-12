import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { expect, it } from 'vitest'
import { configureCacheDeletionBoundary, removeUnmanagedCachePath } from './cache-deletion'

it('blocks cache cleanup of managed files, their parent and junction aliases; allows separate cache files', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-cache-boundary-'))
  const managed = path.join(root, 'generated')
  try {
    await fs.mkdir(managed)
    const file = path.join(managed, 'result.png')
    await fs.writeFile(file, 'result')
    configureCacheDeletionBoundary(() => [managed])
    await expect(removeUnmanagedCachePath(file)).rejects.toThrow('managed media')
    await expect(removeUnmanagedCachePath(root, { recursive: true })).rejects.toThrow('managed media')
    const alias = path.join(root, 'alias')
    await fs.symlink(managed, alias, 'junction')
    await expect(removeUnmanagedCachePath(path.join(alias, 'result.png'))).rejects.toThrow('managed media')
    const cache = path.join(root, 'cache')
    await fs.writeFile(cache, 'cache')
    await removeUnmanagedCachePath(cache)
    expect(await fs.readFile(file, 'utf8')).toBe('result')
  } finally { configureCacheDeletionBoundary(() => []); await fs.rm(root, { recursive: true, force: true }) }
})
