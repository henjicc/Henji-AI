import { z } from 'zod'

import { applicationCapabilityCatalogVersionSchema } from './identifiers'

export const applicationCatalogMigrationPolicySchema = z.object({
  fromVersion: applicationCapabilityCatalogVersionSchema,
  toVersion: applicationCapabilityCatalogVersionSchema,
  historicalCalls: z.literal('read_only'),
  replay: z.literal('forbidden'),
  removedCapabilityIds: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,63}$/)).max(512),
  migrationCompletedDomains: z.array(z.string().regex(/^[a-z][a-z0-9_.-]{1,63}$/)).max(64),
}).strict().refine(
  (policy) => policy.fromVersion !== policy.toVersion,
  { message: '目录迁移的起止版本不能相同' }
)
export type ApplicationCatalogMigrationPolicy = z.infer<typeof applicationCatalogMigrationPolicySchema>

