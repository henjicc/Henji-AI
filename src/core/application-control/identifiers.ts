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

export function createKnownApplicationPropertyIdSchema<const TId extends string>(
  knownPropertyIds: readonly TId[]
): z.ZodType<TId> {
  const known = new Set<string>(knownPropertyIds)
  return applicationPropertyIdSchema.refine(
    (propertyId): propertyId is TId => known.has(propertyId),
    { message: '属性未在应用控制注册表中声明' }
  ) as z.ZodType<TId>
}
