import { z } from 'zod'
import { APPLICATION_CAPABILITY_CATALOG_VERSION, applicationCapabilityDescriptorSchema } from '../application-control/applicationCapabilities'
import { AGENT_DISCOVERY_LEASE_TOOL_LIMIT } from './toolBudget'

export const applicationCapabilitySearchResultSchema = z.object({
  catalogVersion: z.literal(APPLICATION_CAPABILITY_CATALOG_VERSION),
  capabilities: z.array(applicationCapabilityDescriptorSchema),
  leasedToolNames: z.array(z.string().min(1)).max(AGENT_DISCOVERY_LEASE_TOOL_LIMIT),
  deferredCount: z.number().int().nonnegative(),
  nextCursor: z.number().int().nonnegative().nullable(),
}).strict()
