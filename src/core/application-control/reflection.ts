import { z } from 'zod'

import {
  applicationDataClassSchema,
  applicationEntityTypeIdSchema,
  applicationExposureSchema,
  applicationPropertyIdSchema,
  applicationRefSchema,
  applicationRevisionSetSchema,
  applicationSchemaRefSchema,
  applicationScopeIdSchema,
  jsonValueSchema,
} from './identifiers'

export const applicationNumberRangeSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().positive().optional(),
}).strict().refine(
  (range) => range.min === undefined || range.max === undefined || range.min <= range.max,
  { message: '数值范围的最小值不能大于最大值' }
)

export const applicationPropertyValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('boolean') }).strict(),
  z.object({ kind: z.literal('string'), minLength: z.number().int().nonnegative().optional(), maxLength: z.number().int().positive().optional() }).strict(),
  z.object({ kind: z.literal('number'), hardRange: applicationNumberRangeSchema.optional(), softRange: applicationNumberRangeSchema.optional() }).strict(),
  z.object({ kind: z.literal('integer'), hardRange: applicationNumberRangeSchema.optional(), softRange: applicationNumberRangeSchema.optional() }).strict(),
  z.object({ kind: z.literal('enum'), values: z.array(z.object({ value: z.string().min(1), label: z.string().min(1).max(120) }).strict()).min(1).max(256) }).strict(),
  z.object({ kind: z.literal('color'), format: z.enum(['hex', 'rgba']) }).strict(),
  z.object({ kind: z.literal('vector2'), unit: z.string().min(1).max(40).optional(), componentRange: applicationNumberRangeSchema.optional() }).strict(),
  z.object({ kind: z.literal('vector3'), unit: z.string().min(1).max(40).optional(), componentRange: applicationNumberRangeSchema.optional() }).strict(),
  z.object({ kind: z.literal('ref'), refKinds: z.array(applicationEntityTypeIdSchema).min(1).max(32) }).strict(),
  z.object({ kind: z.literal('ref_list'), refKinds: z.array(applicationEntityTypeIdSchema).min(1).max(32), maxItems: z.number().int().positive().optional() }).strict(),
  z.object({ kind: z.literal('json'), schemaRef: applicationSchemaRefSchema }).strict(),
])
export type ApplicationPropertyValue = z.infer<typeof applicationPropertyValueSchema>

export const applicationEntityTypeDescriptorSchema = z.object({
  id: applicationEntityTypeIdSchema,
  domain: applicationEntityTypeIdSchema,
  version: z.number().int().positive(),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  refKind: applicationEntityTypeIdSchema,
  dataClass: applicationDataClassSchema,
  exposures: z.array(applicationExposureSchema).min(1).max(3),
  parentTypes: z.array(applicationEntityTypeIdSchema).max(16),
  revisionScopes: z.array(applicationScopeIdSchema).min(1).max(16),
  queryCapabilityIds: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)).min(1).max(16),
  schemaRef: applicationSchemaRefSchema,
}).strict()
export type ApplicationEntityTypeDescriptor = z.infer<typeof applicationEntityTypeDescriptorSchema>

export const applicationPropertyDescriptorSchema = z.object({
  id: applicationPropertyIdSchema,
  entityType: applicationEntityTypeIdSchema,
  version: z.number().int().positive(),
  title: z.string().min(1).max(120),
  description: z.string().min(1).max(1_000),
  value: applicationPropertyValueSchema,
  unit: z.string().min(1).max(40).optional(),
  nullable: z.boolean(),
  defaultValue: jsonValueSchema.optional(),
  dataClass: applicationDataClassSchema,
  exposures: z.array(applicationExposureSchema).min(1).max(3),
  requiredPermissions: z.object({
    read: z.array(z.string().min(1).max(120)).max(12),
    write: z.array(z.string().min(1).max(120)).max(12),
  }).strict(),
  revisionScopes: z.array(applicationScopeIdSchema).min(1).max(16),
  schemaRef: applicationSchemaRefSchema,
  readOnlyReason: z.string().min(1).max(500).optional(),
  relation: z.object({
    targetEntityTypes: z.array(applicationEntityTypeIdSchema).min(1).max(32),
    cardinality: z.enum(['one', 'optional', 'many']),
  }).strict().optional(),
}).strict()
export type ApplicationPropertyDescriptor = z.infer<typeof applicationPropertyDescriptorSchema>

export const applicationPropertyAvailabilitySchema = z.object({
  propertyId: applicationPropertyIdSchema,
  readable: z.boolean(),
  writable: z.boolean(),
  reasons: z.array(z.string().min(1).max(500)).max(12),
  requiredPermissions: z.array(z.string().min(1).max(120)).max(12),
  revisions: applicationRevisionSetSchema,
}).strict()
export type ApplicationPropertyAvailability = z.infer<typeof applicationPropertyAvailabilitySchema>

export const applicationEntitySnapshotSchema = z.object({
  ref: applicationRefSchema,
  entityType: applicationEntityTypeIdSchema,
  revisions: applicationRevisionSetSchema,
  properties: z.record(applicationPropertyIdSchema, jsonValueSchema),
  capturedAt: z.string().datetime(),
}).strict()
export type ApplicationEntitySnapshot = z.infer<typeof applicationEntitySnapshotSchema>

export const applicationSchemaQuerySchema = z.object({
  entityTypes: z.array(applicationEntityTypeIdSchema).max(64),
  propertyIds: z.array(applicationPropertyIdSchema).max(256),
  includeUnavailable: z.boolean().default(false),
  catalogVersion: z.string().regex(/^application-capabilities\/v[1-9][0-9]*$/),
}).strict()
export type ApplicationSchemaQuery = z.infer<typeof applicationSchemaQuerySchema>
