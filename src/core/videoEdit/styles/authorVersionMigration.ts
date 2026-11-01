import { HISTORICAL_PREVIEW_AUTHOR } from '../codeMaterial/authorVersion'

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
function pin(value: unknown): unknown {
  if (!record(value)) return value
  return { ...value, ...(value.apiVersion === undefined ? { apiVersion: HISTORICAL_PREVIEW_AUTHOR.apiVersion } : {}), ...(value.libraries === undefined ? { libraries: { ...HISTORICAL_PREVIEW_AUTHOR.libraries } } : {}) }
}
/** 只补历史解释字段，不改内容版本、摘要、源码或已渲染媒体。 */
export function migrateStyleAuthor(value: unknown): unknown {
  const copy: unknown = structuredClone(value)
  return record(copy) ? { ...copy, sample: pin(copy.sample) } : copy
}
export function migrateTemplateAuthor(value: unknown): unknown {
  const copy: unknown = structuredClone(value)
  return record(copy) && record(copy.body) && copy.body.kind === 'code' ? { ...copy, body: pin(copy.body) } : copy
}
export function migrateStylePackageAuthor(value: unknown): unknown {
  const copy: unknown = structuredClone(value)
  return record(copy) ? { ...copy, style: migrateStyleAuthor(copy.style), templates: Array.isArray(copy.templates) ? copy.templates.map(migrateTemplateAuthor) : copy.templates } : copy
}
export function migrateVideoAuthor(value: unknown): unknown {
  const copy: unknown = structuredClone(value)
  return record(copy) && Array.isArray(copy.styles) ? { ...copy, styles: copy.styles.map(migrateStyleAuthor) } : copy
}
/** 录制快照可能嵌套在基线和调用结果中，每份剪辑沿同一个纯迁移入口读取。 */
export function migrateRecordingAuthor(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(migrateRecordingAuthor)
  if (!record(value)) return value
  if (value.format === 'henji-video-project') return migrateVideoAuthor(value)
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, migrateRecordingAuthor(child)]))
}
