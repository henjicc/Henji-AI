import fs from 'node:fs/promises'
import { removePath, writeFileBytes } from '../system'
import { VideoEditExportJobRegistry } from './jobRegistry'

export const videoEditExportJobRegistry = new VideoEditExportJobRegistry({
  createExclusive: target => writeFileBytes(target, new Uint8Array(), { exclusive: true }),
  async identify(target) {
    try {
      const stats = await fs.lstat(target, { bigint: true })
      return stats.isFile() ? { dev: stats.dev, ino: stats.ino, birthtimeNs: stats.birthtimeNs } : null
    } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error }
  },
  remove: target => removePath(target),
})

