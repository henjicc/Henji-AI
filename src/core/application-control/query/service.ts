import {
  applicationStructuredObservationRequestSchema,
  applicationStructuredObservationResponseSchema,
  type ApplicationStructuredObservationInput,
  type ApplicationStructuredObservationItem,
  type ApplicationStructuredObservationRequest,
  type ApplicationStructuredObservationResponse,
} from './contracts'
import type {
  ApplicationControlAccessContext,
  ApplicationReflectionRegistry,
} from '../registry'
import type { ApplicationDataClass, ApplicationRef, JsonValue } from '../identifiers'

export interface ApplicationObservationArtifactInput {
  source: 'application_control_observation'
  dataClasses: ApplicationDataClass[]
  payload: JsonValue
}

export interface ApplicationObservationArtifactSink {
  save(input: ApplicationObservationArtifactInput): Promise<string>
}

export interface ApplicationOperationSummaryProvider {
  list(entityType: string, context: ApplicationControlAccessContext): Promise<JsonValue[]>
}

export interface ApplicationObservationServiceDependencies {
  registry: ApplicationReflectionRegistry
  artifactSink?: ApplicationObservationArtifactSink
  operationSummaryProvider?: ApplicationOperationSummaryProvider
}

function mergeRevisions(
  target: Record<string, number>,
  source: Record<string, number>,
  mode: ApplicationStructuredObservationRequest['consistency']['mode']
): void {
  for (const [scope, revision] of Object.entries(source)) {
    const current = target[scope]
    if (current !== undefined && current !== revision && mode === 'snapshot') {
      throw new Error(`REVISION_CONFLICT:${scope}:${current}/${revision}`)
    }
    target[scope] = Math.max(current ?? revision, revision)
  }
}

function assertExpectedRevisions(
  revisions: Record<string, number>,
  expected: Record<string, number> | undefined
): void {
  for (const [scope, expectedRevision] of Object.entries(expected ?? {})) {
    const current = revisions[scope]
    if (current !== undefined && current !== expectedRevision) {
      throw new Error(`REVISION_CONFLICT:${scope}:${expectedRevision}/${current}`)
    }
  }
}

function cursorOffset(cursor: string | undefined): number {
  if (!cursor) return 0
  const value = Number(cursor.slice(3))
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('INVALID_CURSOR')
  return value
}

function utf8Bytes(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}

function relationRefs(item: ApplicationStructuredObservationItem): ApplicationRef[] {
  if (item.kind !== 'entity_snapshot') return []
  const refs: ApplicationRef[] = []
  for (const value of Object.values(item.snapshot.properties)) {
    const candidates = Array.isArray(value) ? value : [value]
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
      if (typeof candidate.kind === 'string' && typeof candidate.id === 'string') {
        refs.push({
          kind: candidate.kind,
          id: candidate.id,
          ...(typeof candidate.revision === 'number' ? { revision: candidate.revision } : {}),
          ...(typeof candidate.label === 'string' ? { label: candidate.label } : {}),
        })
      }
    }
  }
  return refs
}

function uniqueRefs(refs: ApplicationRef[]): ApplicationRef[] {
  const seen = new Set<string>()
  return refs.filter((ref) => {
    const key = `${ref.kind}:${ref.id}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export class ApplicationObservationQueryService {
  constructor(private readonly dependencies: ApplicationObservationServiceDependencies) {}

  async observe(
    input: ApplicationStructuredObservationInput,
    context: ApplicationControlAccessContext
  ): Promise<ApplicationStructuredObservationResponse> {
    const request = applicationStructuredObservationRequestSchema.parse(input)
    const items: ApplicationStructuredObservationItem[] = []
    const revisions: Record<string, number> = {}
    const filteredPropertyIds = new Set<string>()
    const description = this.dependencies.registry.describe({
      domains: request.domains,
      entityTypes: request.entityTypes,
      propertyIds: request.selection.propertyIds,
    }, context)

    if (request.selection.includeSchemas) {
      items.push(...description.entities.map((descriptor) => ({ kind: 'entity_schema' as const, descriptor })))
      items.push(...description.properties.map((descriptor) => ({ kind: 'property_schema' as const, descriptor })))
    }
    for (const ref of request.schemaRefs) {
      items.push({
        kind: 'schema_document',
        ref,
        value: this.dependencies.registry.resolveSchema(ref, context),
      })
    }
    for (const entityType of request.listEntityTypes) {
      const result = await this.dependencies.registry.listEntities(
        entityType,
        { limit: request.budget.maxItems },
        context
      )
      mergeRevisions(revisions, result.revisions, request.consistency.mode)
      items.push(...result.refs.map((ref) => ({ kind: 'entity_ref' as const, ref })))
    }

    if (request.selection.includeValues || request.selection.includeAvailability) {
      await this.appendEntityItems(
        items,
        uniqueRefs(request.refs),
        request,
        context,
        revisions,
        filteredPropertyIds
      )
    }
    if (request.selection.includeOperations && this.dependencies.operationSummaryProvider) {
      const entityTypes = new Set([
        ...request.entityTypes,
        ...request.refs.map((ref) => ref.kind),
      ])
      for (const entityType of entityTypes) {
        items.push({
          kind: 'operation_summary',
          entityType,
          operations: await this.dependencies.operationSummaryProvider.list(entityType, context),
        })
      }
    }

    assertExpectedRevisions(revisions, request.consistency.expectedRevisions)
    return await this.createResponse(request, context, items, revisions, [...filteredPropertyIds])
  }

  private async appendEntityItems(
    items: ApplicationStructuredObservationItem[],
    initialRefs: ApplicationRef[],
    request: ApplicationStructuredObservationRequest,
    context: ApplicationControlAccessContext,
    revisions: Record<string, number>,
    filteredPropertyIds: Set<string>
  ): Promise<void> {
    let frontier = initialRefs
    const visited = new Set<string>()
    for (let depth = 0; depth <= request.selection.relationDepth && frontier.length > 0; depth += 1) {
      const next: ApplicationRef[] = []
      for (const ref of frontier) {
        if (items.length >= request.budget.maxItems) return
        const refKey = `${ref.kind}:${ref.id}`
        if (visited.has(refKey)) continue
        visited.add(refKey)
        if (request.selection.includeValues) {
          const snapshot = await this.dependencies.registry.readEntity(
            ref,
            request.selection.propertyIds,
            context
          )
          mergeRevisions(revisions, snapshot.revisions, request.consistency.mode)
          for (const propertyId of request.selection.propertyIds ?? []) {
            if (!(propertyId in snapshot.properties)) filteredPropertyIds.add(propertyId)
          }
          const item = { kind: 'entity_snapshot' as const, snapshot }
          items.push(item)
          next.push(...relationRefs(item))
        }
        if (request.selection.includeAvailability) {
          const propertyIds = request.selection.propertyIds
            ?? this.dependencies.registry.listProperties(ref.kind).map((property) => property.id)
          items.push({
            kind: 'property_availability',
            ref,
            availability: await this.dependencies.registry.getPropertyAvailability(ref, propertyIds, context),
          })
        }
      }
      frontier = uniqueRefs(next)
    }
  }

  private async createResponse(
    request: ApplicationStructuredObservationRequest,
    context: ApplicationControlAccessContext,
    allItems: ApplicationStructuredObservationItem[],
    revisions: Record<string, number>,
    filteredPropertyIds: string[]
  ): Promise<ApplicationStructuredObservationResponse> {
    const offset = cursorOffset(request.page.cursor)
    if (offset > allItems.length) throw new Error('INVALID_CURSOR')
    const reasons = new Set<'page_limit' | 'item_budget' | 'byte_budget' | 'artifact_offloaded'>()
    const maxCount = Math.min(request.page.limit, request.budget.maxItems)
    const pageItems: ApplicationStructuredObservationItem[] = []
    let bytes = 0
    for (const item of allItems.slice(offset)) {
      if (pageItems.length >= maxCount) {
        reasons.add(request.page.limit <= request.budget.maxItems ? 'page_limit' : 'item_budget')
        break
      }
      const itemBytes = utf8Bytes(item)
      if (pageItems.length > 0 && bytes + itemBytes > request.budget.maxBytes) {
        reasons.add('byte_budget')
        break
      }
      pageItems.push(item)
      bytes += itemBytes
    }
    const nextOffset = offset + pageItems.length
    const hasMore = nextOffset < allItems.length
    let artifact: ApplicationStructuredObservationResponse['artifact']
    const fullBytes = utf8Bytes(allItems)
    if (hasMore && fullBytes >= request.budget.artifactThresholdBytes && this.dependencies.artifactSink) {
      const artifactRef = await this.dependencies.artifactSink.save({
        source: 'application_control_observation',
        dataClasses: [...context.acceptedDataClasses],
        payload: { requestId: request.requestId, catalogVersion: this.dependencies.registry.catalogVersion, items: allItems } as JsonValue,
      })
      artifact = { artifactRef, source: 'application_control_observation', readCapabilityId: 'read_agent_artifact' }
      reasons.add('artifact_offloaded')
    }
    if (hasMore && reasons.size === 0) reasons.add('page_limit')
    const nextRequests = hasMore
      ? [artifact
          ? `使用 read_agent_artifact 读取 ${artifact.artifactRef} 的后续内容。`
          : `使用 cursor v1:${nextOffset} 继续读取观察结果。`]
      : []
    return applicationStructuredObservationResponseSchema.parse({
      contractVersion: 'application-control/v2',
      requestId: request.requestId,
      catalogVersion: this.dependencies.registry.catalogVersion,
      items: pageItems,
      revisions,
      page: { returnedItems: pageItems.length, nextCursor: hasMore ? `v1:${nextOffset}` : null, hasMore },
      incomplete: { truncated: hasMore, reasons: [...reasons], nextRequests },
      ...(artifact ? { artifact } : {}),
      audit: { dataClasses: [...context.acceptedDataClasses], filteredPropertyIds },
    })
  }
}
