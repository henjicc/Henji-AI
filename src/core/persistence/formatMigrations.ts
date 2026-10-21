import type { PersistenceMigrations } from './migrations'

/**
 * Add N → N+1 here for non-document formats. Document kinds own their own chain.
 * 2026-10-21 兼容起点：此前的开发期版本不再读取，表从空开始；之后每次升版本必须在这里补对应步骤。
 */
export const FORMAT_MIGRATIONS: Readonly<Record<string, PersistenceMigrations>> = {}
export function formatMigrations(id: string): PersistenceMigrations { return FORMAT_MIGRATIONS[id] ?? {} }
