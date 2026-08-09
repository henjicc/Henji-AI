import {
  fieldDescriptors,
  fieldReadValues,
  type ApplicationEntityProvider,
  type ApplicationEntityRegistration,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
  type ApplicationSchemaRef,
  type JsonValue,
} from '@/core/application-control'
import { normalizeGenerationTaskStatus } from '@/core/assistant/externalWait'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

import { GENERATION_MODEL_FIELDS, getGenerationModelsRevision, type GenerationModelFieldSource } from './generationModelFields'
import {
  getGenerationModelSchema,
  getGenerationModelSchemaRef,
  searchGenerationModelCatalog,
} from './generationPreparationService'
import {
  listGenerationTaskStatusSnapshots,
  readGenerationTaskStatusSnapshot,
  type GenerationTaskStatusSnapshot,
} from './generationTaskStatusRegistry'

export const GENERATION_ENTITY_TYPES = {
  model: 'generation.model',
  task: 'generation.task',
  result: 'generation.result',
} as const

type GenerationEntityType = typeof GENERATION_ENTITY_TYPES[keyof typeof GENERATION_ENTITY_TYPES]

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(kind: 'entity' | 'property', id: string) {
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: digest(`${kind}:${id}`) } as const
}

function property(entityType: GenerationEntityType, suffix: string, title: string, value: ApplicationPropertyDescriptor['value'], nullable = false): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id,
    entityType,
    version: 1,
    title,
    description: `生成${title}。`,
    value,
    nullable,
    dataClass: entityType === GENERATION_ENTITY_TYPES.model ? 'C0' : 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: [entityType === GENERATION_ENTITY_TYPES.model ? 'model_catalog:read' : 'generation:read'], write: [] },
    revisionScopes: [entityType === GENERATION_ENTITY_TYPES.model ? 'models' : 'generation'],
    schemaRef: schemaRef('property', id),
    readOnlyReason: '状态由模型目录或正式生成任务链路维护。',
  }
}

/*
 * model 一支已经迁移到统一字段定义（4.4，见 generationModelFields.ts）——hidden 是这次任务
 * 新增的唯一可写属性，其余四条随迁移一起改成逐属性 readOnlyReason，不再共用整实体
 * writeExclusion。task/result 两支保持原样，仍然全部只读，理由见下方 writeExclusion。
 */
const properties: Record<GenerationEntityType, ApplicationPropertyDescriptor[]> = {
  [GENERATION_ENTITY_TYPES.model]: fieldDescriptors(GENERATION_MODEL_FIELDS),
  [GENERATION_ENTITY_TYPES.task]: [
    property(GENERATION_ENTITY_TYPES.task, 'model_ref', '模型引用', { kind: 'ref', refKinds: [GENERATION_ENTITY_TYPES.model] }),
    property(GENERATION_ENTITY_TYPES.task, 'status', '任务状态', { kind: 'string', maxLength: 40 }),
    property(GENERATION_ENTITY_TYPES.task, 'progress', '任务进度', { kind: 'number', hardRange: { min: 0, max: 100 } }),
    property(GENERATION_ENTITY_TYPES.task, 'cancellable', '可取消', { kind: 'boolean' }),
    property(GENERATION_ENTITY_TYPES.task, 'waiting_external', '等待外部结果', { kind: 'boolean' }),
    property(GENERATION_ENTITY_TYPES.task, 'result_ref', '结果引用', { kind: 'ref', refKinds: [GENERATION_ENTITY_TYPES.result] }, true),
    property(GENERATION_ENTITY_TYPES.task, 'error_message', '错误摘要', { kind: 'string', maxLength: 1000 }, true),
  ],
  [GENERATION_ENTITY_TYPES.result]: [
    property(GENERATION_ENTITY_TYPES.result, 'task_ref', '任务引用', { kind: 'ref', refKinds: [GENERATION_ENTITY_TYPES.task] }),
    property(GENERATION_ENTITY_TYPES.result, 'media_type', '媒体类型', { kind: 'enum', values: ['image', 'video', 'audio'].map((value) => ({ value, label: value })) }),
    property(GENERATION_ENTITY_TYPES.result, 'media_ref', '稳定媒体引用', { kind: 'ref', refKinds: [GENERATION_ENTITY_TYPES.result] }),
  ],
}

function taskRevision(task: GenerationTaskStatusSnapshot): number {
  const seed = JSON.stringify(task)
  return [...seed].reduce((total, character) => (total * 33 + character.charCodeAt(0)) >>> 0, 5381)
}

function taskProperties(task: GenerationTaskStatusSnapshot): Record<string, JsonValue> {
  const status = normalizeGenerationTaskStatus(task.status) ?? task.status
  const active = ['queued', 'pending', 'generating'].includes(status)
  return {
    'generation.task.model_ref': { kind: GENERATION_ENTITY_TYPES.model, id: task.modelId },
    'generation.task.status': status,
    'generation.task.progress': task.progress,
    'generation.task.cancellable': active,
    'generation.task.waiting_external': active,
    'generation.task.result_ref': task.resultAvailable ? { kind: GENERATION_ENTITY_TYPES.result, id: task.taskId } : null,
    'generation.task.error_message': task.errorMessage,
  }
}

class GenerationReflectionProvider implements ApplicationEntityProvider {
  constructor(readonly entityType: GenerationEntityType) {}

  async listEntities(request: { cursor?: string; limit: number }) {
    const refs = this.listRefs()
    const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
    const page = refs.slice(offset, offset + request.limit)
    return {
      refs: page,
      nextCursor: offset + page.length < refs.length ? String(offset + page.length) : null,
      revisions: { [this.entityType === GENERATION_ENTITY_TYPES.model ? 'models' : 'generation']: this.entityType === GENERATION_ENTITY_TYPES.model ? getGenerationModelsRevision() : refs.length },
    }
  }

  async readEntity(ref: ApplicationRef, request: { propertyIds?: string[] }) {
    if (ref.kind !== this.entityType) throw new Error('NOT_FOUND')
    const { values, revision } = this.readValues(ref.id)
    return {
      ref,
      entityType: this.entityType,
      revisions: { [this.entityType === GENERATION_ENTITY_TYPES.model ? 'models' : 'generation']: revision },
      properties: request.propertyIds
        ? Object.fromEntries(Object.entries(values).filter(([id]) => request.propertyIds?.includes(id)))
        : values,
      capturedAt: new Date().toISOString(),
    }
  }

  async getPropertyAvailability(ref: ApplicationRef, propertyIds: string[]) {
    const snapshot = await this.readEntity(ref, {})
    const descriptorMap = new Map(properties[this.entityType].map((item) => [item.id, item]))
    return propertyIds.map((propertyId) => {
      const descriptor = descriptorMap.get(propertyId)
      if (!descriptor) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      const writable = !descriptor.readOnlyReason
      return {
        propertyId,
        readable: true,
        writable,
        reasons: writable ? [] : [descriptor.readOnlyReason ?? '只读状态'],
        requiredPermissions: writable ? descriptor.requiredPermissions.write : descriptor.requiredPermissions.read,
        revisions: snapshot.revisions,
      }
    })
  }

  private listRefs(): ApplicationRef[] {
    if (this.entityType === GENERATION_ENTITY_TYPES.model) {
      return searchGenerationModelCatalog({}).models.map((model) => ({ kind: this.entityType, id: String(model.modelId), label: String(model.name) }))
    }
    return listGenerationTaskStatusSnapshots()
      .filter((task) => this.entityType === GENERATION_ENTITY_TYPES.task || task.resultAvailable)
      .map((task) => ({ kind: this.entityType, id: task.taskId }))
  }

  private readValues(id: string): { values: Record<string, JsonValue>; revision: number } {
    if (this.entityType === GENERATION_ENTITY_TYPES.model) {
      const schema = getGenerationModelSchema(id)
      const source: GenerationModelFieldSource = { modelId: id, meta: schema.meta as Record<string, unknown>, schemaRef: schema.schemaRef }
      return { values: fieldReadValues(GENERATION_MODEL_FIELDS, source), revision: getGenerationModelsRevision() }
    }
    const task = readGenerationTaskStatusSnapshot(id)
    if (!task || (this.entityType === GENERATION_ENTITY_TYPES.result && !task.resultAvailable)) throw new Error('NOT_FOUND')
    if (this.entityType === GENERATION_ENTITY_TYPES.task) return { values: taskProperties(task), revision: taskRevision(task) }
    return { values: {
      'generation.result.task_ref': { kind: GENERATION_ENTITY_TYPES.task, id: task.taskId },
      'generation.result.media_type': task.mediaType,
      'generation.result.media_ref': { kind: GENERATION_ENTITY_TYPES.result, id: task.taskId },
    }, revision: taskRevision(task) }
  }
}

function modelSchemaDocuments(): Array<{ ref: ApplicationSchemaRef; value: JsonValue }> {
  return searchGenerationModelCatalog({}).models.map((model) => {
    const schema = getGenerationModelSchema(String(model.modelId))
    return { ref: getGenerationModelSchemaRef(String(model.modelId)), value: JSON.parse(JSON.stringify(schema)) as JsonValue }
  })
}

export function createGenerationReflectionRegistrations(): ApplicationEntityRegistration[] {
  return (Object.values(GENERATION_ENTITY_TYPES) as GenerationEntityType[]).map((entityType) => ({
    entity: {
      id: entityType,
      domain: entityType === GENERATION_ENTITY_TYPES.model ? 'models' : 'generation',
      version: 1,
      title: entityType === GENERATION_ENTITY_TYPES.model ? '生成模型' : entityType === GENERATION_ENTITY_TYPES.task ? '生成任务' : '生成结果',
      description: '模型配置或可见生成任务的调用方中立状态。',
      refKind: entityType,
      dataClass: entityType === GENERATION_ENTITY_TYPES.model ? 'C0' : 'C1',
      exposures: ['ui', 'assistant', 'local_adapter'],
      parentTypes: entityType === GENERATION_ENTITY_TYPES.result ? [GENERATION_ENTITY_TYPES.task] : [],
      revisionScopes: [entityType === GENERATION_ENTITY_TYPES.model ? 'models' : 'generation'],
      queryCapabilityIds: [entityType === GENERATION_ENTITY_TYPES.model ? 'get_model_schema' : 'get_generation_task'],
      schemaRef: schemaRef('entity', entityType),
      /*
       * model 一支不再整体 writeExclusion（4.4）：hidden 已经可写，provider_id/media_type/
       * name/tags/parameter_schema_ref 各自的 readOnlyReason 由 generationModelFields.ts 的
       * modelDescriptor() 逐条声明。task/result 两支维持整体只读——生成任务与结果由生成链路
       * 创建和维护，发起任务属算法型操作，用 create_visible_generation_task。
       */
      ...(entityType === GENERATION_ENTITY_TYPES.model ? {} : {
        writeExclusion: {
          reason: '生成任务与结果由生成链路创建和维护；发起任务属算法型操作，用 create_visible_generation_task。',
        },
      }),
    },
    properties: properties[entityType],
    provider: new GenerationReflectionProvider(entityType),
    schemaDocuments: entityType === GENERATION_ENTITY_TYPES.model ? [
      { ref: schemaRef('property', 'generation.model.tags.value'), value: { type: 'array', items: { type: 'string' } } as JsonValue },
      { ref: schemaRef('property', 'generation.model.parameter_schema_ref.value'), value: { type: 'object', description: 'ApplicationSchemaRef' } as JsonValue },
      ...modelSchemaDocuments(),
    ] : [],
  }))
}
