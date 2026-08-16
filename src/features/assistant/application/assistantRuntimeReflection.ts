import {
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
  type JsonValue,
  unrestrictedCollectionAvailability,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import {
  listAssistantRunSummaries,
  readAssistantRun,
  type AssistantRunApplicationSnapshot,
} from './assistantRuntimeApplicationService'

export const ASSISTANT_RUNTIME_ENTITY_TYPES = {
  run: 'assistant.run',
  artifact: 'assistant.artifact',
} as const

type AssistantRuntimeEntityType = typeof ASSISTANT_RUNTIME_ENTITY_TYPES[keyof typeof ASSISTANT_RUNTIME_ENTITY_TYPES]

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(kind: 'entity' | 'property', id: string) {
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: digest(`${kind}:${id}`) } as const
}

function property(
  entityType: AssistantRuntimeEntityType,
  suffix: string,
  title: string,
  value: ApplicationPropertyDescriptor['value'],
  nullable = false,
): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: `助手运行时${title}。`,
    value,
    nullable,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: [entityType === ASSISTANT_RUNTIME_ENTITY_TYPES.run ? 'assistant_run:read' : 'artifact:read'], write: [] },
    revisionScopes: ['assistant_runtime'],
    schemaRef: schemaRef('property', id),
    readOnlyReason: '状态由持久化助手运行时唯一维护。',
  }
}

const ARTIFACT_REFS_VALUE = schemaRef('property', 'assistant.run.artifact_refs.value')
const ERROR_VALUE = schemaRef('property', 'assistant.run.error.value')

const properties: Record<AssistantRuntimeEntityType, ApplicationPropertyDescriptor[]> = {
  [ASSISTANT_RUNTIME_ENTITY_TYPES.run]: [
    property(ASSISTANT_RUNTIME_ENTITY_TYPES.run, 'thread_id', '会话标识', { kind: 'string', maxLength: 200 }),
    property(ASSISTANT_RUNTIME_ENTITY_TYPES.run, 'status', '运行状态', { kind: 'string', maxLength: 40 }),
    property(ASSISTANT_RUNTIME_ENTITY_TYPES.run, 'sequence', '事件游标', { kind: 'number', hardRange: { min: 0, max: Number.MAX_SAFE_INTEGER } }),
    property(ASSISTANT_RUNTIME_ENTITY_TYPES.run, 'waiting_external', '等待外部结果', { kind: 'boolean' }),
    property(ASSISTANT_RUNTIME_ENTITY_TYPES.run, 'cancellable', '可取消', { kind: 'boolean' }),
    property(ASSISTANT_RUNTIME_ENTITY_TYPES.run, 'resumable', '可恢复', { kind: 'boolean' }),
    property(ASSISTANT_RUNTIME_ENTITY_TYPES.run, 'retryable', '可重试', { kind: 'boolean' }),
    property(ASSISTANT_RUNTIME_ENTITY_TYPES.run, 'artifact_refs', '产物引用', { kind: 'json', schemaRef: ARTIFACT_REFS_VALUE }),
    property(ASSISTANT_RUNTIME_ENTITY_TYPES.run, 'error', '错误摘要', { kind: 'json', schemaRef: ERROR_VALUE }, true),
  ],
  [ASSISTANT_RUNTIME_ENTITY_TYPES.artifact]: [
    property(ASSISTANT_RUNTIME_ENTITY_TYPES.artifact, 'run_ref', '所属运行', { kind: 'ref', refKinds: [ASSISTANT_RUNTIME_ENTITY_TYPES.run] }),
    property(ASSISTANT_RUNTIME_ENTITY_TYPES.artifact, 'content_ref', '分页内容引用', { kind: 'ref', refKinds: [ASSISTANT_RUNTIME_ENTITY_TYPES.artifact] }),
    property(ASSISTANT_RUNTIME_ENTITY_TYPES.artifact, 'paged', '需要分页读取', { kind: 'boolean' }),
  ],
}

function runValues(run: AssistantRunApplicationSnapshot): Record<string, JsonValue> {
  return {
    'assistant.run.thread_id': run.threadId,
    'assistant.run.status': run.status,
    'assistant.run.sequence': run.sequence,
    'assistant.run.waiting_external': run.waitingExternal,
    'assistant.run.cancellable': run.cancellable,
    'assistant.run.resumable': run.resumable,
    'assistant.run.retryable': run.retryable,
    'assistant.run.artifact_refs': run.artifactRefs.map((id) => ({ kind: ASSISTANT_RUNTIME_ENTITY_TYPES.artifact, id })),
    'assistant.run.error': run.error ? JSON.parse(JSON.stringify(run.error)) as JsonValue : null,
  }
}

class AssistantRuntimeReflectionProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: AssistantRuntimeEntityType) {}

  async listEntities(request: { cursor?: string; limit: number }) {
    const summaries = await listAssistantRunSummaries(undefined, 100)
    const runRefs = summaries.map((run) => ({ kind: ASSISTANT_RUNTIME_ENTITY_TYPES.run, id: run.runId }))
    const refs = this.entityType === ASSISTANT_RUNTIME_ENTITY_TYPES.run
      ? runRefs
      : (await Promise.all(summaries.map((run) => readAssistantRun(run.runId))))
        .flatMap((run) => run.artifactRefs.map((id) => ({ kind: ASSISTANT_RUNTIME_ENTITY_TYPES.artifact, id })))
    const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
    const page = refs.slice(offset, offset + request.limit)
    return {
      refs: page,
      nextCursor: offset + page.length < refs.length ? String(offset + page.length) : null,
      revisions: { assistant_runtime: summaries.length },
    }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    const run = this.entityType === ASSISTANT_RUNTIME_ENTITY_TYPES.run
      ? await readAssistantRun(ref.id)
      : await this.findArtifactRun(ref.id)
    const values = this.entityType === ASSISTANT_RUNTIME_ENTITY_TYPES.run
      ? runValues(run)
      : {
          'assistant.artifact.run_ref': { kind: ASSISTANT_RUNTIME_ENTITY_TYPES.run, id: run.runId },
          'assistant.artifact.content_ref': { kind: ASSISTANT_RUNTIME_ENTITY_TYPES.artifact, id: ref.id },
          'assistant.artifact.paged': true,
        }
    return {
      ref,
      entityType: this.entityType,
      revisions: { assistant_runtime: run.sequence },
      properties: request.propertyIds
        ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds?.includes(id)))
        : values,
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    const snapshot = await this.readEntity(ref, {})
    const known = new Map(properties[this.entityType].map((item) => [item.id, item]))
    return propertyIds.map((propertyId) => {
      const descriptor = known.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return { propertyId, readable: true, writable: false, reasons: ['只读状态'], requiredPermissions: descriptor.requiredPermissions.read, revisions: snapshot.revisions }
    })
  }

  async getCollectionAvailability(parent: ApplicationRef) {
    return unrestrictedCollectionAvailability(this.entityType, parent, { assistant_runtime: 0 }, ['assistant_runtime:write'])
  }

  private async findArtifactRun(artifactRef: string): Promise<AssistantRunApplicationSnapshot> {
    const summaries = await listAssistantRunSummaries(undefined, 100)
    for (const summary of summaries) {
      const run = await readAssistantRun(summary.runId)
      if (run.artifactRefs.includes(artifactRef)) return run
    }
    throw new Error('NOT_FOUND')
  }
}

export function createAssistantRuntimeReflectionRegistrations(): ApplicationEntityRegistration[] {
  return (Object.values(ASSISTANT_RUNTIME_ENTITY_TYPES) as AssistantRuntimeEntityType[]).map((entityType) => ({
    entity: {
      id: entityType,
      domain: entityType === ASSISTANT_RUNTIME_ENTITY_TYPES.run ? 'assistant_runtime' : 'artifacts',
      version: 1,
      title: entityType === ASSISTANT_RUNTIME_ENTITY_TYPES.run ? '助手运行' : '助手产物',
      description: entityType === ASSISTANT_RUNTIME_ENTITY_TYPES.run
        ? '持久化助手运行的统一长任务状态。'
        : '助手运行产生的稳定分页产物引用。',
      refKind: entityType,
      dataClass: 'C1',
      exposures: ['ui', 'assistant', 'local_adapter'],
      parentTypes: entityType === ASSISTANT_RUNTIME_ENTITY_TYPES.artifact ? [ASSISTANT_RUNTIME_ENTITY_TYPES.run] : [],
      revisionScopes: ['assistant_runtime'],
      queryCapabilityIds: [entityType === ASSISTANT_RUNTIME_ENTITY_TYPES.run ? 'get_current_application_context' : 'read_agent_artifact'],
      schemaRef: schemaRef('entity', entityType),
      writeExclusion: {
        reason: '助手运行与产物由 Agent 运行时自身维护，让助手改写自己的运行状态会破坏结算与证据链。',
      },
    },
    properties: properties[entityType],
    provider: new AssistantRuntimeReflectionProvider(entityType),
    schemaDocuments: entityType === ASSISTANT_RUNTIME_ENTITY_TYPES.run ? [
      { ref: ARTIFACT_REFS_VALUE, value: { type: 'array', items: { type: 'object' } } as JsonValue },
      { ref: ERROR_VALUE, value: { type: ['object', 'null'] } as JsonValue },
    ] : [],
  }))
}
