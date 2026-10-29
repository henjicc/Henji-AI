import type { PersistenceMigrations } from './migrations'
import { WEB_RECORDING_MIGRATIONS } from '../webReplay/schema'
import { migrateEmbeddedVideoColorGradesV1 } from '../videoEdit/colorGradeMigration'
import { migrateColorGradeParamsV1 } from '../imaging/adjustments/colorGradeMigration'

/**
 * Add N → N+1 here for non-document formats. Document kinds own their own chain.
 * 2026-10-21 兼容起点：此前的开发期版本不再读取，表从空开始；之后每次升版本必须在这里补对应步骤。
 */
export const FORMAT_MIGRATIONS: Readonly<Record<string, PersistenceMigrations>> = {
  // 1 → 2：转写选择缺省为空，保留供应商及全部已有模型选择；只读迁移不改写原键。
  'model-defaults': { 1: value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const record = value as Record<string, unknown>
    if (!record.models || typeof record.models !== 'object' || Array.isArray(record.models)) return value
    const models = record.models as Record<string, unknown>
    return { ...record, version: 2, models: { ...models, transcription: models.transcription === undefined ? '' : models.transcription } }
  } },
  // 版本位置支持 git:；纯格式迁移保留已有位置，磁盘导入由显式项目操作执行。
  // 3 → 4：新增可选内置库 libraries，并接受作者接口 v5；旧记录原样有效，没有 libraries 的按第一套内置库运行。
  // 4 → 5：接受作者接口 v6；旧记录的源码、接口与库版本原样保留。
  'code-version': { 1: value => structuredClone(value), 2: value => structuredClone(value), 3: value => structuredClone(value), 4: value => structuredClone(value) },
  // 作者宿主接口 4 → 5：v5 起可声明片子数据参数与使用内置库；宿主按 apiVersion 保持 v4 代码原行为，不迁移源码。
  // 5 → 6：新增版本化排版库；迁移不把旧素材提升到新作者接口。
  'code-author-api': { 4: value => structuredClone(value), 5: value => structuredClone(value) },
  // 7 → 8：代码视频参数新增可选取帧时间表 spans，旧资产原样有效，最低可读版本仍为 7。
  // 8 → 9：源码版本新增可选内置库 libraries 并接受作者接口 v5；资产不携带片子数据，不能引用它。旧资产原样有效，最低可读版本仍为 7。
  // 9 → 10：资产可携带作者接口 v6；只升容器版本，保留 sourceVersion。
  'code-asset': { 6: value => ({ ...structuredClone(value) as object, version: 7, minReaderVersion: 7 }), 7: value => ({ ...structuredClone(value) as object, version: 8, minReaderVersion: 7 }), 8: value => ({ ...structuredClone(value) as object, version: 9, minReaderVersion: 7 }), 9: value => ({ ...structuredClone(value) as object, version: 10, minReaderVersion: 10 }) },
  project: { 1: value => ({ ...value as object, version: 2, minReaderVersion: 1 }) },
  // 2 → 3：样片画布放宽到 3840×2160、60 帧，旧内容原样有效。
  // 3 → 4：样片时长放宽到 30 秒、锚点 10 张，旧内容原样有效。
  'video-style-library': { 1: value => value, 2: value => value, 3: value => value },
  // 1 → 2：模板里的代码视频参数新增可选取帧时间表 spans，旧内容原样有效。
  // 2 → 3：原生模板片段新增可选 enabled:false；代码参数值新增片子数据引用 {kind:'scene'}（模板不携带片子数据，实际不会出现）。
  // 旧内容原样有效；旧程序会把停用的模板片段当成启用，最低可读版本提高到 3。
  'video-template-library': { 1: value => value, 2: value => value },
  // 6 → 7：本机标题模板里的代码视频参数新增可选取帧时间表 spans，旧内容原样有效。
  // 7 → 8：代码参数值新增片子数据引用 {kind:'scene'}（标题模板不携带片子数据，实际不会出现），旧内容原样有效。
  'title-templates': { 6: value => value, 7: value => value },
  // 4 → 5：成员模板里的代码视频参数新增可选取帧时间表 spans，旧内容原样有效。
  // 5 → 6：成员原生模板的片段新增可选 enabled:false；代码参数值新增片子数据引用 {kind:'scene'}（风格包不携带片子数据，实际不会出现）。
  // 旧内容原样有效；旧程序会把停用的模板片段当成启用，最低可读版本提高到 6。
  'video-style-package': { 1: value => value, 2: value => value, 3: value => value, 4: value => value, 5: value => value },
  'recording-setup': { 1: value => value, 2: value => { const { microphoneId: _legacyDevice, ...rest } = value as Record<string, unknown>; return rest }, 3: value => value, 4: value => value },
  'screen-capture': { 1: value => ({ ...value as object, version: 2, minReaderVersion: 1 }) },
  'audio-capture-recovery': { 1: value => ({ ...value as object, version: 2 }) },
  // 实验性功能开关 experimentalWebAppRecording（2026-10-23）：只新增可选字段，缺省即关闭。
  // 剪辑片段缩略图模式 videoEditClipThumbnails（2026-10-24）：只新增可选字段，缺省即“只在开头”。
  settings: { 14: value => value, 15: value => value },
  // 网页录制：步骤与 `.hjweb` 文档类型共用（同一份 recording.json）。
  'web-recording': WEB_RECORDING_MIGRATIONS,
  // 全能调色参数格式 v2（2026-10-21）：开尔文白平衡、创意分离色调并入色轮。
  // 6 → 7：代码视频参数新增可选取帧时间表 spans，旧内容原样有效。
  // 7 → 8：代码参数值新增片子数据引用 {kind:'scene'}（预设不携带片子数据，实际不会出现），旧内容原样有效。
  'video-preset-package': { 5: value => ({ ...migrateEmbeddedVideoColorGradesV1(value) as object, version: 6 }), 6: value => ({ ...value as object, version: 7 }), 7: value => ({ ...value as object, version: 8 }) },
  'image-working-copy': { 14: value => migrateImageWorkingCopyColorGrades(value, 15) },
  'image-package': { 12: value => ({ ...value as object, packageVersion: 13, document: migrateImageWorkingCopyColorGrades((value as { document?: unknown }).document, 15) }) },
  'canvas-layer-package': { 12: value => ({ ...value as object, version: 13 }) },
  // 片段速度曲线、补帧与变调（2026-10-22）：字幕回填记录里的声音片段只新增可选字段。
  // 跟踪与防抖（2026-10-22）、音频重构 remix（2026-10-22）：同上，只新增可选字段。
  // 原生模板实例标记（2026-10-22）：字幕回填记录里的声音片段只新增可选的 templateId。
  // 非等比缩放（2026-10-24）：字幕回填记录里的声音片段只新增可选的 scaleAspect。
  // 代码视频参数取帧时间表（2026-10-28）：声音片段的代码参数只新增可选的 spans。
  // 片段启用开关（2026-10-28）：声音片段新增可选 enabled:false，代码参数值新增片子数据引用；旧记录原样有效。
  'subtitle-manifest': { 21: value => ({ ...value as object, version: 22 }), 20: value => ({ ...value as object, version: 21 }), 19: value => ({ ...value as object, version: 20 }), 18: value => ({ ...value as object, version: 19 }), 17: value => ({ ...value as object, version: 18 }), 16: value => ({ ...value as object, version: 17 }), 15: value => ({ ...value as object, version: 16 }), 11: value => ({ ...value as object, version: 12 }), 12: value => ({ ...value as object, version: 13 }), 13: value => ({ ...value as object, version: 14 }), 14: value => ({ ...value as object, version: 15 }) },
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
