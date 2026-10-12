import { backupPersistenceSnapshot } from '@/core/persistence/backup'
import { videoEditSubtitleManifestSchema } from '@/core/persistence/storedSchemas'
import { SUBTITLE_MANIFEST_VERSION } from '@/core/persistence/preferenceSchemas'
import { formatMigrations } from '@/core/persistence/formatMigrations'
import { migratePersistenceContent } from '@/core/persistence/migrations'
import { getPlatform } from '@/platform/runtime'
import type { z } from 'zod'

/** Reading never rewrites the original; version preflight precedes exclusive backup. */
export async function readVideoEditSubtitleManifest(path: string): Promise<z.infer<typeof videoEditSubtitleManifestSchema>> {
  const fs = getPlatform().system.fs
  const text = await fs.readTextFile(path)
  const raw: unknown = JSON.parse(text)
  const version = raw && typeof raw === 'object' && 'version' in raw ? raw.version : 1
  const contract = { id: 'subtitle-manifest', name: '字幕回填记录', version: SUBTITLE_MANIFEST_VERSION, migrations: formatMigrations('subtitle-manifest') }
  const sourceVersion = typeof version === 'number' ? version : 0
  const backup = await backupPersistenceSnapshot(path, contract, sourceVersion, new TextEncoder().encode(text), fs)
  return videoEditSubtitleManifestSchema.parse(migratePersistenceContent(contract, raw, sourceVersion, backup))
}
