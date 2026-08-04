import { z } from 'zod'

import { applicationSchemaRefSchema } from '../application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from './applicationCapabilities'
import { agentTaskCapabilityKindSchema } from './taskGraph'
import type { AgentTaskGraph } from './taskGraph'
import {
  AGENT_DISCOVERY_LEASE_TOOL_LIMIT,
  AGENT_LEASE_FRONTIER_FACET_LIMIT,
} from './toolBudget'

export const APPLICATION_CAPABILITY_DISCOVERY_VERSION = 'application-capability-discovery/v2' as const

export const applicationCapabilityDiscoveryFacetSchema = z.object({
  facetId: z.string().regex(/^[a-z][a-z0-9_-]{1,63}$/),
  queries: z.array(z.string().min(1).max(500)).max(8).default([]),
  domains: z.array(z.string().min(1).max(128)).max(8).default([]),
  entityTypes: z.array(z.string().min(1).max(128)).max(16).default([]),
  capabilityKinds: z.array(agentTaskCapabilityKindSchema).max(6).default([]),
  targetSurfaceIds: z.array(z.string().min(1).max(128)).max(8).default([]),
}).strict()
export type ApplicationCapabilityDiscoveryFacet = z.infer<
  typeof applicationCapabilityDiscoveryFacetSchema
>

export const applicationCapabilityDiscoveryInputSchema = z.object({
  discoveryVersion: z.literal(APPLICATION_CAPABILITY_DISCOVERY_VERSION)
    .default(APPLICATION_CAPABILITY_DISCOVERY_VERSION),
  facets: z.array(applicationCapabilityDiscoveryFacetSchema).min(1).max(AGENT_LEASE_FRONTIER_FACET_LIMIT),
  cursor: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(20).default(20),
}).strict()
export type ApplicationCapabilityDiscoveryInput = z.infer<
  typeof applicationCapabilityDiscoveryInputSchema
>

export const applicationCapabilityDiscoveryMatchSchema = z.object({
  name: z.string().min(1).max(128),
  capabilityId: z.string().min(1).max(128),
  version: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(1_000),
  domain: z.string().min(1).max(128),
  category: z.string().min(1).max(128),
  readOnly: z.boolean(),
  risk: z.enum(['R0', 'R1', 'R2', 'R3']),
  entityTypes: z.array(z.string().min(1).max(128)).max(32),
  propertyIds: z.array(z.string().min(1).max(128)).max(128),
  surfaceIds: z.array(z.string().min(1).max(128)).max(16),
  schemaRef: applicationSchemaRefSchema,
}).strict()
export type ApplicationCapabilityDiscoveryMatch = z.infer<
  typeof applicationCapabilityDiscoveryMatchSchema
>

const facetDiscoveryResultSchema = z.object({
  facetId: z.string().min(1).max(64),
  capabilityNames: z.array(z.string().min(1).max(128)).max(100),
  schemaRefs: z.array(applicationSchemaRefSchema).max(100),
  observationSuggestions: z.array(z.string().min(1).max(500)).max(16),
}).strict()

const missingFacetSchema = z.object({
  facetId: z.string().min(1).max(64),
  reason: z.enum(['no_matching_capability', 'permission_filtered', 'unsupported_domain']),
  requestedDomains: z.array(z.string().min(1).max(128)).max(8),
  requestedEntityTypes: z.array(z.string().min(1).max(128)).max(16),
}).strict()

export const applicationCapabilityDiscoveryOutputSchema = z.object({
  discoveryVersion: z.literal(APPLICATION_CAPABILITY_DISCOVERY_VERSION),
  catalogVersion: z.literal(APPLICATION_CAPABILITY_CATALOG_VERSION),
  fingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  reused: z.boolean(),
  capabilities: z.array(applicationCapabilityDiscoveryMatchSchema).max(20),
  facets: z.array(facetDiscoveryResultSchema).max(16),
  missing: z.array(missingFacetSchema).max(16),
  leasedToolNames: z.array(z.string().min(1).max(128)).max(AGENT_DISCOVERY_LEASE_TOOL_LIMIT),
  deferredToolNames: z.array(z.string().min(1).max(128)).max(100),
  deferredCount: z.number().int().nonnegative(),
  page: z.object({
    returnedItems: z.number().int().nonnegative(),
    nextCursor: z.number().int().nonnegative().nullable(),
    hasMore: z.boolean(),
  }).strict(),
}).strict()
export type ApplicationCapabilityDiscoveryOutput = z.infer<
  typeof applicationCapabilityDiscoveryOutputSchema
>

export const applicationSchemaReadInputSchema = z.object({
  refs: z.array(applicationSchemaRefSchema).min(1).max(20),
}).strict()
export type ApplicationSchemaReadInput = z.infer<typeof applicationSchemaReadInputSchema>

export const applicationSchemaReadOutputSchema = z.object({
  catalogVersion: z.literal(APPLICATION_CAPABILITY_CATALOG_VERSION),
  documents: z.array(z.object({
    ref: applicationSchemaRefSchema,
    inputSchema: z.record(z.string(), z.unknown()),
  }).strict()).max(20),
  missing: z.array(applicationSchemaRefSchema).max(20),
}).strict()
export type ApplicationSchemaReadOutput = z.infer<typeof applicationSchemaReadOutputSchema>

export function createCapabilityDiscoveryInputFromTaskGraph(
  taskGraph: AgentTaskGraph
): ApplicationCapabilityDiscoveryInput | null {
  const completed = new Set(taskGraph.facets
    .filter((facet) => facet.status === 'completed')
    .map((facet) => facet.facetId))
  const frontier = taskGraph.facets.filter((facet) => (
    !['completed', 'blocked', 'waiting_user'].includes(facet.status)
    && facet.dependsOn.every((dependency) => completed.has(dependency))
  )).slice(0, AGENT_LEASE_FRONTIER_FACET_LIMIT)
  if (frontier.length === 0) return null
  return applicationCapabilityDiscoveryInputSchema.parse({
    discoveryVersion: APPLICATION_CAPABILITY_DISCOVERY_VERSION,
    facets: frontier.map((facet) => ({
      facetId: facet.facetId,
      queries: [facet.goal],
      domains: [facet.domain],
      entityTypes: facet.targetEntityTypes,
      capabilityKinds: facet.capabilityKinds,
      targetSurfaceIds: facet.targetSurfaceId ? [facet.targetSurfaceId] : [],
    })),
    cursor: 0,
    limit: AGENT_DISCOVERY_LEASE_TOOL_LIMIT,
  })
}
