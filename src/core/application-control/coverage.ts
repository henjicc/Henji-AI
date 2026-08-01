import { z } from 'zod'

import {
  applicationDataClassSchema,
  applicationEntityTypeIdSchema,
  applicationMediaModalitySchema,
  applicationPropertyIdSchema,
  applicationStableIdSchema,
  applicationSurfaceIdSchema,
} from './identifiers'

export const APPLICATION_CONTROL_COVERAGE_VERSION = 'application-control-coverage/v1' as const

export const applicationCapabilityMigrationSchema = z.object({
  capabilityId: z.string().regex(/^[a-z][a-z0-9_]{1,63}$/),
  domain: applicationStableIdSchema,
  source: z.string().min(1).max(500),
  disposition: z.enum(['retain', 'migrate', 'merge', 'delete']),
  targetIds: z.array(applicationStableIdSchema).min(1).max(16),
  targetKind: z.enum(['query', 'property', 'operation', 'runtime']),
  migrationTask: z.string().regex(/^[1-7]\.[1-9][0-9]*$/),
  deleteWhen: z.string().min(1).max(1_000),
  verification: z.array(z.string().min(1).max(500)).min(1).max(16),
}).strict()
export type ApplicationCapabilityMigration = z.infer<typeof applicationCapabilityMigrationSchema>

export const applicationDomainCoverageSchema = z.object({
  domain: applicationStableIdSchema,
  migrationTask: z.string().regex(/^[1-7]\.[1-9][0-9]*$/),
  formalService: z.string().min(1).max(500),
  entityTypes: z.array(applicationEntityTypeIdSchema).min(1).max(64),
  propertySources: z.array(z.string().min(1).max(500)).min(1).max(32),
  operationSource: z.string().min(1).max(500),
  querySource: z.string().min(1).max(500),
  observationSource: z.string().min(1).max(500),
  verificationSource: z.string().min(1).max(500),
  surfaceIds: z.array(applicationSurfaceIdSchema).max(32),
}).strict()
export type ApplicationDomainCoverage = z.infer<typeof applicationDomainCoverageSchema>

export const applicationSurfaceObservationCoverageSchema = z.object({
  surfaceId: applicationSurfaceIdSchema,
  providerId: applicationStableIdSchema,
  implementationStatus: z.enum(['available', 'planned']),
  resultModalities: z.array(applicationMediaModalitySchema).min(1).max(3),
  dataClass: applicationDataClassSchema,
  captureScope: z.string().min(1).max(500),
  maskPolicyId: applicationStableIdSchema,
  verification: z.string().min(1).max(500),
  migrationTask: z.string().regex(/^[1-7]\.[1-9][0-9]*$/),
}).strict()
export type ApplicationSurfaceObservationCoverage = z.infer<typeof applicationSurfaceObservationCoverageSchema>

export const applicationPublicControlCoverageSchema = z.object({
  kind: z.enum(['setting', 'surface', 'model', 'image_edit_tool', 'camera_stage_property', 'canvas_node']),
  id: z.string().min(1).max(500),
  source: z.string().min(1).max(500),
  targetEntityType: applicationEntityTypeIdSchema,
  targetPropertyId: applicationPropertyIdSchema.optional(),
  migrationTask: z.string().regex(/^[1-7]\.[1-9][0-9]*$/),
  status: z.enum(['covered', 'excluded']),
  exclusionReason: z.string().min(1).max(1_000).optional(),
}).strict().refine(
  (item) => item.status === 'covered' || Boolean(item.exclusionReason),
  { message: '排除项必须说明原因' }
)
export type ApplicationPublicControlCoverage = z.infer<typeof applicationPublicControlCoverageSchema>

export const applicationControlCoverageManifestSchema = z.object({
  version: z.literal(APPLICATION_CONTROL_COVERAGE_VERSION),
  catalogVersion: z.string().regex(/^application-capabilities\/v[1-9][0-9]*$/),
  domains: z.array(applicationDomainCoverageSchema).min(1).max(64),
  capabilityMigrations: z.array(applicationCapabilityMigrationSchema).min(1).max(512),
  surfaceObservations: z.array(applicationSurfaceObservationCoverageSchema).min(1).max(128),
  publicControls: z.array(applicationPublicControlCoverageSchema).min(1).max(2_000),
}).strict()
export type ApplicationControlCoverageManifest = z.infer<typeof applicationControlCoverageManifestSchema>
