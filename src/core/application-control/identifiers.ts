import { z } from 'zod'

export const APPLICATION_CONTROL_CONTRACT_VERSION = 'application-control/v1' as const
export const APPLICATION_CAPABILITY_CATALOG_VERSION_PATTERN = /^application-capabilities\/v[1-9][0-9]*$/

const stableIdPattern = /^[a-z][a-z0-9_.-]{1,127}$/
const propertyIdPattern = /^[a-z][a-z0-9_-]*(\.[a-z0-9][a-z0-9_-]*){1,15}$/

export const applicationStableIdSchema = z.string().regex(stableIdPattern)
export const applicationEntityTypeIdSchema = applicationStableIdSchema
export const applicationPropertyIdSchema = z.string().regex(propertyIdPattern)
export const applicationScopeIdSchema = applicationStableIdSchema
export const applicationSurfaceIdSchema = applicationStableIdSchema
export const applicationCapabilityCatalogVersionSchema = z.string()
  .regex(APPLICATION_CAPABILITY_CATALOG_VERSION_PATTERN)

export const applicationDataClassSchema = z.enum(['C0', 'C1', 'C2', 'C3'])
export const applicationExposureSchema = z.enum(['ui', 'assistant', 'local_adapter'])
export const applicationMediaModalitySchema = z.enum(['image', 'video', 'audio'])
export type ApplicationDataClass = z.infer<typeof applicationDataClassSchema>
export type ApplicationExposure = z.infer<typeof applicationExposureSchema>
export type ApplicationMediaModality = z.infer<typeof applicationMediaModalitySchema>

export type JsonValue = null | boolean | number | string | JsonValue[] | {
  [key: string]: JsonValue
}

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() => z.union([
  z.null(),
  z.boolean(),
  z.number(),
  z.string(),
  z.array(jsonValueSchema),
  z.record(z.string(), jsonValueSchema),
]))

export const applicationRefSchema = z.object({
  kind: applicationStableIdSchema,
  id: z.string().min(1).max(500),
  revision: z.number().int().nonnegative().optional(),
  label: z.string().min(1).max(200).optional(),
}).strict()
export type ApplicationRef = z.infer<typeof applicationRefSchema>

export const applicationMediaRefSchema = applicationRefSchema.extend({
  kind: z.enum(['media.image', 'media.video', 'media.audio', 'generation.result']),
}).strict()
export type ApplicationMediaRef = z.infer<typeof applicationMediaRefSchema>

export const applicationSchemaRefSchema = z.object({
  catalogVersion: applicationCapabilityCatalogVersionSchema,
  kind: z.enum(['entity', 'property', 'operation', 'surface']),
  id: applicationStableIdSchema,
  version: z.number().int().positive(),
  digest: z.string().regex(/^sha256:[a-f0-9]{64}$/),
}).strict()
export type ApplicationSchemaRef = z.infer<typeof applicationSchemaRefSchema>

export const applicationRevisionSetSchema = z.record(
  applicationScopeIdSchema,
  z.number().int().nonnegative()
)
export type ApplicationRevisionSet = z.infer<typeof applicationRevisionSetSchema>

export const applicationOpaqueRefSchema = z.string()
  .regex(/^[a-z][a-z0-9_-]{1,31}:[A-Za-z0-9_-]{16,256}$/)

const STABLE_ID_SEGMENT_ALLOWED = new Set('abcdefghijklmnopqrstuvwxyz0123456789_.-')
const STABLE_ID_SEGMENT_MAX_SLUG_LENGTH = 64

function stableIdSegmentDigest(raw: string): string {
  let hash = 5381
  for (const character of raw) hash = (hash * 33 + (character.codePointAt(0) ?? 0)) >>> 0
  return hash.toString(16).padStart(8, '0')
}

function trimSeparators(value: string): string {
  let result = value
  while (result.length > 0 && (result.startsWith('-') || result.startsWith('.'))) result = result.slice(1)
  while (result.length > 0 && (result.endsWith('-') || result.endsWith('.'))) result = result.slice(0, -1)
  return result
}

/**
 * 把**外部来源的自由文本**（供应商模型 id、文件名、用户输入……）转成可以安全嵌进稳定 id
 * 的片段。凡是要把不受本项目控制的字符串拼进 `applicationStableIdSchema` 的地方，都必须
 * 经过这里。
 *
 * 稳定 id 受 `^[a-z][a-z0-9_.-]{1,127}$` 约束，外部 id 不受任何约束——ModelScope 的
 * `black-forest-labs/FLUX.1-Krea-dev` 同时带斜杠和大写。直接拼进去的后果实测过：反射注册表
 * 整个建不起来，而它又是惰性构建的，于是错误落在用户任务执行到一半的时候，信息里只有一句
 * 正则不匹配，跟当时正在做的事毫无关系。
 *
 * 规范化必然丢信息（大小写折叠、非法字符统一变成 `-`），所以结尾一定要带上按**原文**算出的
 * 摘要，否则 `a/b` 与 `a_b` 会折叠成同一个 id，在注册表里撞成 `SCHEMA_REF_DUPLICATE`。
 */
export function toApplicationStableIdSegment(raw: string): string {
  let slug = ''
  for (const character of raw.normalize('NFC').toLowerCase()) {
    const mapped = STABLE_ID_SEGMENT_ALLOWED.has(character) ? character : '-'
    if (mapped === '-' && slug.endsWith('-')) continue
    slug += mapped
  }
  slug = trimSeparators(slug)
  if (slug.length > STABLE_ID_SEGMENT_MAX_SLUG_LENGTH) {
    slug = trimSeparators(slug.slice(0, STABLE_ID_SEGMENT_MAX_SLUG_LENGTH))
  }
  const head = slug.charCodeAt(0)
  if (!(head >= 97 && head <= 122)) slug = slug ? `x-${slug}` : 'x'
  return `${slug}-${stableIdSegmentDigest(raw)}`
}

export function createKnownApplicationPropertyIdSchema<const TId extends string>(
  knownPropertyIds: readonly TId[]
): z.ZodType<TId> {
  const known = new Set<string>(knownPropertyIds)
  return applicationPropertyIdSchema.refine(
    (propertyId): propertyId is TId => known.has(propertyId),
    { message: '属性未在应用控制注册表中声明' }
  ) as z.ZodType<TId>
}
