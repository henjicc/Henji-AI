import type { PersistenceMigrations } from './migrations'
import { migrateThemePayloadV1 } from '../theme/themeMigration'

/** Add N → N+1 here for non-document formats. Document kinds own their own chain. */
export const FORMAT_MIGRATIONS: Readonly<Record<string, PersistenceMigrations>> = {
  // Reuse the existing theme migration; t94 does not invent migrations for old development projects.
  'theme-payload': { 1: content => migrateThemePayloadV1(content) },
}
export function formatMigrations(id: string): PersistenceMigrations { return FORMAT_MIGRATIONS[id] ?? {} }
