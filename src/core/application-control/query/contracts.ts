import { z } from 'zod'

import {
  APPLICATION_CONTROL_CONTRACT_VERSION,
  applicationDataClassSchema,
  applicationEntityTypeIdSchema,
  applicationPropertyIdSchema,
  applicationRefSchema,
  applicationRevisionSetSchema,
  applicationSchemaRefSchema,
  jsonValueSchema,
} from '../identifiers'
import {
  applicationEntitySnapshotSchema,
  applicationEntityTypeDescriptorSchema,
  applicationPropertyAvailabilitySchema,
  applicationPropertyDescriptorSchema,
} from '../reflection'

const applicationObservationSelectionSchema = z.object({
  propertyIds: z.array(applicationPropertyIdSchema).max(256).optional(),
  includeSchemas: z.boolean().default(true),
  includeValues: z.boolean().default(true),
  includeAvailability: z.boolean().default(false),
  includeOperations: z.boolean().default(false),
  relationDepth: z.number().int().min(0).max(3).default(0),
}).strict()

const applicationObservationBudgetSchema = z.object({
  maxItems: z.number().int().min(1).max(1_000).default(100),
  maxBytes: z.number().int().min(512).max(4 * 1024 * 1024).default(64 * 1024),
  artifactThresholdBytes: z.number().int().min(1_024).max(4 * 1024 * 1024).default(48 * 1024),
}).strict().refine(
  (budget) => budget.artifactThresholdBytes <= budget.maxBytes,
  { message: 'Artifact 卸载阈值不能大于观察字节预算' }
)

export const applicationStructuredObservationRequestSchema = z.object({
  contractVersion: z.literal(APPLICATION_CONTROL_CONTRACT_VERSION),
  requestId: z.string().min(1).max(200),
  domains: z.array(applicationEntityTypeIdSchema).max(32).default([]),
  entityTypes: z.array(applicationEntityTypeIdSchema).max(64).default([]),
  refs: z.array(applicationRefSchema).max(256).default([]),
  listEntityTypes: z.array(applicationEntityTypeIdSchema).max(64).default([]),
  schemaRefs: z.array(applicationSchemaRefSchema).max(256).default([]),
  selection: applicationObservationSelectionSchema.default({
    includeSchemas: true,
    includeValues: true,
    includeAvailability: false,
    includeOperations: false,
    relationDepth: 0,
  }),
  page: z.object({
    cursor: z.string().regex(/^v1:[0-9]+$/).optional(),
    limit: z.number().int().min(1).max(256).default(64),
  }).strict().default({ limit: 64 }),
  budget: applicationObservationBudgetSchema.default({
    maxItems: 100,
    maxBytes: 64 * 1024,
    artifactThresholdBytes: 48 * 1024,
  }),
  consistency: z.object({
    mode: z.enum(['snapshot', 'best_effort']).default('snapshot'),
    expectedRevisions: applicationRevisionSetSchema.optional(),
  }).strict().default({ mode: 'snapshot' }),
}).strict()
export type ApplicationStructuredObservationInput = z.input<
  typeof applicationStructuredObservationRequestSchema
>
export type ApplicationStructuredObservationRequest = z.infer<
  typeof applicationStructuredObservationRequestSchema
>

export const applicationStructuredObservationItemSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('entity_schema'), descriptor: applicationEntityTypeDescriptorSchema }).strict(),
  z.object({ kind: z.literal('property_schema'), descriptor: applicationPropertyDescriptorSchema }).strict(),
  z.object({ kind: z.literal('entity_ref'), ref: applicationRefSchema }).strict(),
  z.object({ kind: z.literal('entity_snapshot'), snapshot: applicationEntitySnapshotSchema }).strict(),
  z.object({
    kind: z.literal('property_availability'),
    ref: applicationRefSchema,
    availability: z.array(applicationPropertyAvailabilitySchema).max(256),
  }).strict(),
  z.object({
    kind: z.literal('operation_summary'),
    entityType: applicationEntityTypeIdSchema,
    operations: z.array(jsonValueSchema).max(256),
  }).strict(),
  z.object({ kind: z.literal('schema_document'), ref: applicationSchemaRefSchema, value: jsonValueSchema }).strict(),
])
export type ApplicationStructuredObservationItem = z.infer<
  typeof applicationStructuredObservationItemSchema
>

export const applicationStructuredObservationResponseSchema = z.object({
  contractVersion: z.literal(APPLICATION_CONTROL_CONTRACT_VERSION),
  requestId: z.string().min(1).max(200),
  catalogVersion: z.string().regex(/^application-capabilities\/v[1-9][0-9]*$/),
  items: z.array(applicationStructuredObservationItemSchema).max(1_000),
  revisions: applicationRevisionSetSchema,
  page: z.object({
    returnedItems: z.number().int().nonnegative(),
    nextCursor: z.string().regex(/^v1:[0-9]+$/).nullable(),
    hasMore: z.boolean(),
  }).strict(),
  incomplete: z.object({
    truncated: z.boolean(),
    reasons: z.array(z.enum(['page_limit', 'item_budget', 'byte_budget', 'artifact_offloaded'])).max(4),
    nextRequests: z.array(z.string().min(1).max(500)).max(12),
  }).strict(),
  artifact: z.object({
    artifactRef: z.string().min(1).max(500),
    source: z.literal('application_control_observation'),
    readCapabilityId: z.literal('read_agent_artifact'),
  }).strict().optional(),
  audit: z.object({
    dataClasses: z.array(applicationDataClassSchema).min(1).max(4),
    filteredPropertyIds: z.array(applicationPropertyIdSchema).max(512),
  }).strict(),
}).strict()
export type ApplicationStructuredObservationResponse = z.infer<
  typeof applicationStructuredObservationResponseSchema
>
