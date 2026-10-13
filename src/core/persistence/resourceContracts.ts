import { z } from 'zod'
import { captureLogPageSchema } from '../captureLog/events'
import { creativeIntentPageSchema } from '../creativeIntent/pageSchema'
import { storedMotionCandidateSchema } from '../creativeIntent/persistence'
import { imageLayoutPageSchema, imageLayoutCandidateSchema } from '../imageEdit/v3/layoutDraft'
import { formatMigrations } from './formatMigrations'
import { upgradePersistenceContent } from './migrations'
import type { PersistenceFormat } from './formats'

const resourceSchemas = {
  'capture-log-page': captureLogPageSchema,
  'creative-intent-page': creativeIntentPageSchema,
  'creative-intent-candidate': storedMotionCandidateSchema,
  'image-layout-page': imageLayoutPageSchema,
  'image-layout-candidate': imageLayoutCandidateSchema,
}
export type PersistenceResourceId = keyof typeof resourceSchemas
const resourceVersions: Readonly<Record<PersistenceResourceId, number>> = {
  'capture-log-page': 1,
  'creative-intent-page': 1,
  'creative-intent-candidate': 1,
  'image-layout-page': 1,
  'image-layout-candidate': 1,
}

function createResourceContract(id: PersistenceResourceId): PersistenceFormat {
  const schema = resourceSchemas[id]
  return { id, name: id.startsWith('image-layout') ? '随手摆原稿' : '创作意图原稿', version: resourceVersions[id],
    schema, schemas: { content: schema }, migrations: formatMigrations(id), storage: 'file',
    versionSource: 'resource.version', readEntry: 'src/core/persistence/resourceContracts.ts::decodePersistenceResource',
    migrationEntry: 'src/core/persistence/formatMigrations.ts' }
}

/** 调用方先校验原始字节摘要；资源不可变，升级仅在内存，显式保存发布新资源与引用。 */
export function decodePersistenceResource<Id extends PersistenceResourceId>(id: Id, raw: unknown): z.infer<(typeof resourceSchemas)[Id]> {
  const version = raw && typeof raw === 'object' && 'version' in raw ? raw.version : undefined
  return upgradePersistenceContent(resourcePersistenceContract(id), raw, typeof version === 'number' ? version : 0) as z.infer<(typeof resourceSchemas)[Id]>
}

export function decodeImageLayoutResource(raw: unknown): unknown {
  const kind = raw && typeof raw === 'object' && 'kind' in raw ? raw.kind : undefined
  return decodePersistenceResource(kind === 'image-layout' ? 'image-layout-page' : typeof kind === 'string' ? 'creative-intent-page' : 'image-layout-candidate', raw)
}

export const RESOURCE_PERSISTENCE_FORMATS = (Object.keys(resourceSchemas) as PersistenceResourceId[]).map(createResourceContract)

export function resourcePersistenceContract(id: PersistenceResourceId): PersistenceFormat {
  return RESOURCE_PERSISTENCE_FORMATS.find(format => format.id === id)!
}
