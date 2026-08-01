import { createHash } from 'node:crypto'

import type { HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentToolCatalogEntry } from '../../../../../src/core/assistant/toolContracts'
import {
  APPLICATION_CAPABILITY_DISCOVERY_VERSION,
  applicationCapabilityDiscoveryInputSchema,
  applicationCapabilityDiscoveryOutputSchema,
  applicationSchemaReadInputSchema,
  applicationSchemaReadOutputSchema,
  type ApplicationCapabilityDiscoveryFacet,
  type ApplicationCapabilityDiscoveryInput,
  type ApplicationCapabilityDiscoveryMatch,
  type ApplicationCapabilityDiscoveryOutput,
  type ApplicationSchemaReadInput,
  type ApplicationSchemaReadOutput,
} from '../../../../../src/core/assistant/capabilityDiscovery'
import {
  APPLICATION_CAPABILITY_CATALOG_VERSION,
} from '../../../../../src/core/assistant/applicationCapabilities'
import type { ApplicationSchemaRef } from '../../../../../src/core/application-control'
import type { AgentToolRegistry } from '../tools/registry'

const surfaceIdsByDomain: Readonly<Record<string, string[]>> = {
  application: [],
  navigation: [],
  models: ['settings.models', 'workspace.generation'],
  generation: ['workspace.generation'],
  canvas: ['workspace.canvas'],
  toolbox: ['workspace.tools'],
  camera_stage: ['tool.camera_stage'],
  storyboard: ['workspace.canvas'],
  image_edit: ['tool.image_edit'],
  assets: ['workspace.assets', 'overlay.assets'],
  workflows: ['workspace.canvas'],
  settings: ['settings.general'],
}

interface IndexedCapability {
  entry: AgentToolCatalogEntry
  definition: AgentToolDefinitionLike
  match: ApplicationCapabilityDiscoveryMatch
}

type AgentToolDefinitionLike = ReturnType<AgentToolRegistry['allDefinitions']>[number]

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => [key, stableValue(item)]))
}

function digest(value: unknown): string {
  return `sha256:${createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex')}`
}

function unique(values: string[]): string[] {
  return [...new Set(values)]
}

function operationSchemaRef(definition: AgentToolDefinitionLike): ApplicationSchemaRef {
  return {
    catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
    kind: 'operation',
    id: definition.name,
    version: definition.version,
    digest: digest(definition.aiInputSchema),
  }
}

function entityTypes(definition: AgentToolDefinitionLike, entry: AgentToolCatalogEntry): string[] {
  const capability = definition.capability
  return unique([
    ...entry.acceptsRefs,
    ...entry.producesRefs,
    ...(capability?.control?.impacts.flatMap((impact) => impact.entityTypes) ?? []),
  ])
}

function propertyIds(definition: AgentToolDefinitionLike): string[] {
  return unique(definition.capability?.control?.impacts.flatMap((impact) => impact.propertyIds) ?? [])
}

function surfaceIds(entry: AgentToolCatalogEntry): string[] {
  return unique([
    ...(surfaceIdsByDomain[entry.domain] ?? []),
    ...(surfaceIdsByDomain[entry.category] ?? []),
  ])
}

function capabilityKindMatches(
  facet: ApplicationCapabilityDiscoveryFacet,
  indexed: IndexedCapability
): boolean {
  if (facet.capabilityKinds.length === 0) return true
  return facet.capabilityKinds.some((kind) => {
    if (kind === 'observe' || kind === 'query') return indexed.entry.readOnly
    if (kind === 'navigate') return indexed.entry.category === 'navigation'
    if (kind === 'plan') {
      return indexed.entry.readOnly && (
        indexed.entry.supportsPreview
        || /^(?:plan|prepare|search|get|list)_/.test(indexed.entry.name)
      )
    }
    if (kind === 'mutate') return !indexed.entry.readOnly
    return !indexed.entry.readOnly || indexed.entry.completionKind === 'submitted'
  })
}

function structuralMatch(
  facet: ApplicationCapabilityDiscoveryFacet,
  indexed: IndexedCapability
): boolean {
  const domainMatches = facet.domains.length === 0
    || facet.domains.includes(indexed.entry.domain)
    || facet.domains.includes(indexed.entry.category)
  if (!domainMatches || !capabilityKindMatches(facet, indexed)) return false
  if (
    facet.entityTypes.length > 0
    && !facet.entityTypes.some((entityType) => indexed.match.entityTypes.includes(entityType))
  ) return false
  if (
    facet.targetSurfaceIds.length > 0
    && !facet.targetSurfaceIds.some((surfaceId) => indexed.match.surfaceIds.includes(surfaceId))
    && indexed.entry.category !== 'navigation'
  ) return false
  return true
}

function observationSuggestions(facet: ApplicationCapabilityDiscoveryFacet): string[] {
  return unique([
    ...(facet.entityTypes.length > 0
      ? [`先按 schemaRef 读取 ${facet.entityTypes.join('、')} 的控制结构，再观察当前实体 revision。`]
      : []),
    ...(facet.targetSurfaceIds.length > 0
      ? [`仅在用户要求查看或定位时打开 ${facet.targetSurfaceIds.join('、')}。`]
      : []),
  ])
}

export class AgentCapabilityDiscoveryCatalog {
  private readonly cache = new Map<string, ApplicationCapabilityDiscoveryOutput>()

  constructor(private readonly registry: AgentToolRegistry) {}

  discover(
    runId: string,
    rawInput: ApplicationCapabilityDiscoveryInput,
    context: HostContextSnapshot | null
  ): ApplicationCapabilityDiscoveryOutput {
    const input = applicationCapabilityDiscoveryInputSchema.parse(rawInput)
    const fingerprint = digest({
      input,
      catalogRevision: context?.catalogRevision ?? null,
      availableCapabilities: [...(context?.availableCapabilities ?? [])].sort(),
    })
    const cacheKey = `${runId}:${fingerprint}`
    const cached = this.cache.get(cacheKey)
    if (cached) return applicationCapabilityDiscoveryOutputSchema.parse({ ...cached, reused: true })

    const indexed = this.index(context)
    const facetResults = input.facets.map((facet) => this.matchFacet(facet, indexed, context))
    const capabilityNames = unique(facetResults.flatMap((item) => item.names))
    const allMatches = capabilityNames.flatMap((name) => {
      const item = indexed.find((candidate) => candidate.entry.name === name)
      return item ? [item.match] : []
    })
    const capabilities = allMatches.slice(input.cursor, input.cursor + input.limit)
    const nextCursor = input.cursor + capabilities.length < allMatches.length
      ? input.cursor + capabilities.length
      : null
    const output = applicationCapabilityDiscoveryOutputSchema.parse({
      discoveryVersion: APPLICATION_CAPABILITY_DISCOVERY_VERSION,
      catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
      fingerprint,
      reused: false,
      capabilities,
      facets: facetResults.map((item) => ({
        facetId: item.facet.facetId,
        capabilityNames: item.names,
        schemaRefs: item.schemaRefs,
        observationSuggestions: observationSuggestions(item.facet),
      })),
      missing: facetResults.flatMap((item) => item.names.length > 0 ? [] : [{
        facetId: item.facet.facetId,
        reason: item.missingReason,
        requestedDomains: item.facet.domains,
        requestedEntityTypes: item.facet.entityTypes,
      }]),
      addedToolNames: unique([
        'read_application_schemas',
        ...capabilities.map((capability) => capability.name),
      ]).filter((name) => ![
        'discover_application_capabilities', 'search_application_capabilities',
      ].includes(name)).slice(0, 20),
      page: {
        returnedItems: capabilities.length,
        nextCursor,
        hasMore: nextCursor !== null,
      },
    })
    this.cache.set(cacheKey, output)
    return output
  }

  readSchemas(rawInput: ApplicationSchemaReadInput): ApplicationSchemaReadOutput {
    const input = applicationSchemaReadInputSchema.parse(rawInput)
    const definitions = new Map(this.registry.allDefinitions().map((definition) => [definition.name, definition]))
    const documents: ApplicationSchemaReadOutput['documents'] = []
    const missing: ApplicationSchemaRef[] = []
    for (const ref of input.refs) {
      const definition = definitions.get(ref.id)
      if (!definition || ref.kind !== 'operation') {
        missing.push(ref)
        continue
      }
      const expected = operationSchemaRef(definition)
      if (expected.catalogVersion !== ref.catalogVersion
        || expected.version !== ref.version
        || expected.digest !== ref.digest) {
        missing.push(ref)
        continue
      }
      documents.push({ ref: expected, inputSchema: definition.aiInputSchema })
    }
    return applicationSchemaReadOutputSchema.parse({
      catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION,
      documents,
      missing,
    })
  }

  private index(context: HostContextSnapshot | null): IndexedCapability[] {
    const definitions = new Map(this.registry.allDefinitions().map((definition) => [definition.name, definition]))
    return this.registry.list(context).flatMap((entry) => {
      const definition = definitions.get(entry.name)
      if (!definition || entry.risk === 'R4') return []
      return [{
        entry,
        definition,
        match: {
          name: entry.name,
          capabilityId: entry.capabilityId,
          version: entry.version,
          title: entry.title,
          description: entry.description,
          domain: entry.domain,
          category: entry.category,
          readOnly: entry.readOnly,
          risk: entry.risk,
          entityTypes: entityTypes(definition, entry),
          propertyIds: propertyIds(definition),
          surfaceIds: surfaceIds(entry),
          schemaRef: operationSchemaRef(definition),
        },
      }]
    })
  }

  private matchFacet(
    facet: ApplicationCapabilityDiscoveryFacet,
    indexed: IndexedCapability[],
    context: HostContextSnapshot | null
  ): {
    facet: ApplicationCapabilityDiscoveryFacet
    names: string[]
    schemaRefs: ApplicationSchemaRef[]
    missingReason: 'no_matching_capability' | 'permission_filtered' | 'unsupported_domain'
  } {
    const semanticNames = new Set(facet.queries.flatMap((query) => (
      this.registry.search(query, undefined, context, 100).map((entry) => entry.name)
    )))
    const hasStructuralFilter = facet.domains.length > 0
      || facet.entityTypes.length > 0
      || facet.capabilityKinds.length > 0
      || facet.targetSurfaceIds.length > 0
    const matches = indexed.filter((item) => (
      structuralMatch(facet, item)
      && (facet.queries.length === 0 || hasStructuralFilter || semanticNames.has(item.entry.name))
    )).sort((left, right) => (
      Number(semanticNames.has(right.entry.name)) - Number(semanticNames.has(left.entry.name))
      || left.entry.name.localeCompare(right.entry.name)
    ))
    const knownDomains = new Set(this.registry.allDefinitions().flatMap((definition) => [
      definition.category,
      definition.capability?.domain ?? definition.category,
    ]))
    const unsupported = facet.domains.length > 0 && facet.domains.every((domain) => !knownDomains.has(domain))
    const unavailableExists = matches.length === 0 && this.registry.allDefinitions().some((definition) => (
      facet.domains.length === 0
      || facet.domains.includes(definition.category)
      || facet.domains.includes(definition.capability?.domain ?? '')
    ))
    return {
      facet,
      names: matches.map((item) => item.entry.name),
      schemaRefs: matches.map((item) => item.match.schemaRef),
      missingReason: unsupported
        ? 'unsupported_domain'
        : unavailableExists ? 'permission_filtered' : 'no_matching_capability',
    }
  }
}
