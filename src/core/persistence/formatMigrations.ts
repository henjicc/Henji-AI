import type { PersistenceMigrations } from './migrations'
import { migrateEmbeddedVideoColorGradesV1 } from '../videoEdit/colorGradeMigration'
import { migrateColorGradeParamsV1 } from '../imaging/adjustments/colorGradeMigration'

/**
 * Add N → N+1 here for non-document formats. Document kinds own their own chain.
 * 2026-10-21 兼容起点：此前的开发期版本不再读取，表从空开始；之后每次升版本必须在这里补对应步骤。
 */
export const FORMAT_MIGRATIONS: Readonly<Record<string, PersistenceMigrations>> = {
  // 全能调色参数格式 v2（2026-10-21）：开尔文白平衡、创意分离色调并入色轮。
  'video-preset-package': { 5: value => ({ ...migrateEmbeddedVideoColorGradesV1(value) as object, version: 6 }) },
  'image-working-copy': { 14: value => migrateImageWorkingCopyColorGrades(value, 15) },
  'image-package': { 12: value => ({ ...value as object, packageVersion: 13, document: migrateImageWorkingCopyColorGrades((value as { document?: unknown }).document, 15) }) },
  'canvas-layer-package': { 12: value => ({ ...value as object, version: 13 }) },
  // 片段速度曲线、补帧与变调（2026-10-22）：字幕回填记录里的声音片段只新增可选字段。
  // 跟踪与防抖（2026-10-22）、音频重构 remix（2026-10-22）：同上，只新增可选字段。
  'subtitle-manifest': { 11: value => ({ ...value as object, version: 12 }), 12: value => ({ ...value as object, version: 13 }), 13: value => ({ ...value as object, version: 14 }) },
}
/** Image layers (any depth, including smart-object documents): every `color_grade` adjustment layer's params. */
function migrateImageColorGradeLayers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(migrateImageColorGradeLayers)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const result = Object.fromEntries(Object.entries(record).map(([key, child]) => [key, migrateImageColorGradeLayers(child)]))
  if (record.type === 'adjustment' && record.adjustmentId === 'color_grade' && record.params && typeof record.params === 'object' && !Array.isArray(record.params)) result.params = migrateColorGradeParamsV1(record.params as Record<string, unknown>)
  return result
}
function migrateImageWorkingCopyColorGrades(value: unknown, formatVersion: number): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return { ...migrateImageColorGradeLayers(value) as object, formatVersion }
}
export function formatMigrations(id: string): PersistenceMigrations { return FORMAT_MIGRATIONS[id] ?? {} }
