import type { PersistenceMigrations } from './migrations'
import { WEB_RECORDING_MIGRATIONS } from '../webReplay/schema'
import { migrateEmbeddedVideoColorGradesV1 } from '../videoEdit/colorGradeMigration'
import { migrateColorGradeParamsV1 } from '../imaging/adjustments/colorGradeMigration'

/**
 * Add N → N+1 here for non-document formats. Document kinds own their own chain.
 * 2026-10-21 兼容起点：此前的开发期版本不再读取，表从空开始；之后每次升版本必须在这里补对应步骤。
 */
export const FORMAT_MIGRATIONS: Readonly<Record<string, PersistenceMigrations>> = {
  // 版本位置支持 git:；纯格式迁移保留已有位置，磁盘导入由显式项目操作执行。
  'code-version': { 1: value => structuredClone(value), 2: value => structuredClone(value) },
  'code-asset': { 6: value => ({ ...structuredClone(value) as object, version: 7, minReaderVersion: 7 }) },
  project: { 1: value => ({ ...value as object, version: 2, minReaderVersion: 1 }) },
  // 2 → 3：样片画布放宽到 3840×2160、60 帧，旧内容原样有效。
  // 3 → 4：样片时长放宽到 30 秒、锚点 10 张，旧内容原样有效。
  'video-style-library': { 1: value => value, 2: value => value, 3: value => value },
  'video-style-package': { 1: value => value, 2: value => value, 3: value => value },
  'recording-setup': { 1: value => value, 2: value => { const { microphoneId: _legacyDevice, ...rest } = value as Record<string, unknown>; return rest }, 3: value => value, 4: value => value },
  'screen-capture': { 1: value => ({ ...value as object, version: 2, minReaderVersion: 1 }) },
  'audio-capture-recovery': { 1: value => ({ ...value as object, version: 2 }) },
  // 实验性功能开关 experimentalWebAppRecording（2026-10-23）：只新增可选字段，缺省即关闭。
  // 剪辑片段缩略图模式 videoEditClipThumbnails（2026-10-24）：只新增可选字段，缺省即“只在开头”。
  settings: { 14: value => value, 15: value => value },
  // 网页录制：步骤与 `.hjweb` 文档类型共用（同一份 recording.json）。
  'web-recording': WEB_RECORDING_MIGRATIONS,
  // 全能调色参数格式 v2（2026-10-21）：开尔文白平衡、创意分离色调并入色轮。
  'video-preset-package': { 5: value => ({ ...migrateEmbeddedVideoColorGradesV1(value) as object, version: 6 }) },
  'image-working-copy': { 14: value => migrateImageWorkingCopyColorGrades(value, 15) },
  'image-package': { 12: value => ({ ...value as object, packageVersion: 13, document: migrateImageWorkingCopyColorGrades((value as { document?: unknown }).document, 15) }) },
  'canvas-layer-package': { 12: value => ({ ...value as object, version: 13 }) },
  // 片段速度曲线、补帧与变调（2026-10-22）：字幕回填记录里的声音片段只新增可选字段。
  // 跟踪与防抖（2026-10-22）、音频重构 remix（2026-10-22）：同上，只新增可选字段。
  // 原生模板实例标记（2026-10-22）：字幕回填记录里的声音片段只新增可选的 templateId。
  // 非等比缩放（2026-10-24）：字幕回填记录里的声音片段只新增可选的 scaleAspect。
  'subtitle-manifest': { 19: value => ({ ...value as object, version: 20 }), 18: value => ({ ...value as object, version: 19 }), 17: value => ({ ...value as object, version: 18 }), 16: value => ({ ...value as object, version: 17 }), 15: value => ({ ...value as object, version: 16 }), 11: value => ({ ...value as object, version: 12 }), 12: value => ({ ...value as object, version: 13 }), 13: value => ({ ...value as object, version: 14 }), 14: value => ({ ...value as object, version: 15 }) },
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
