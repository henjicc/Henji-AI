import type { PersistenceMigrations } from './migrations'
import { migrateThemePayloadV1 } from '../theme/themeMigration'

/** Add N → N+1 here for non-document formats. Document kinds own their own chain. */
export const FORMAT_MIGRATIONS: Readonly<Record<string, PersistenceMigrations>> = {
  // Reuse the existing theme migration; t94 does not invent migrations for old development projects.
  'theme-payload': { 1: content => migrateThemePayloadV1(content) },
  // 1 → 2（t187）：字幕回填记录新增可选 sourceText，旧记录原样可读。
  'subtitle-manifest': { 1: content => content && typeof content === 'object' && !Array.isArray(content) ? { ...content, version: 2 } : content },
  // 19 → 20（t189）：真实变更由 db-migrations 的 SQLite 迁移完成；这些记录行内容不变，随共享版本号原样升级。
  'setting-records': { 19: content => content, 20: content => content },
  'asset-records': { 19: content => content, 20: content => content },
  'generation-presets': { 19: content => content, 20: content => content },
  'sqlite': { 19: content => content, 20: content => content },
  // 1 → 2（f6）：文字样式说明补充“未提供字段使用默认值”，存储内容不变，原样升级。
  'title-templates': { 1: content => content },
}
export function formatMigrations(id: string): PersistenceMigrations { return FORMAT_MIGRATIONS[id] ?? {} }
