import { getHiddenModels, saveHiddenModels } from '@/config/providers'
import {
  type ApplicationFieldDefinition,
  type ApplicationPropertyDescriptor,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'

export const GENERATION_MODEL_ENTITY_TYPE = 'generation.model' as const

const MODEL_VISIBILITY_CHANGED_EVENT = 'modelVisibilityChanged'

/*
 * hidden 的 revision 来源：读取路径此前一直用静态 revision:1 占位（模型目录当年整支只读，
 * 没有写入所以无所谓）。现在 hidden 会变，需要一个会动的 revision 供 mutation 执行器的
 * expectedRevisions 校验与撤销使用。监听 Settings 面板写入时已经在发的同一个
 * modelVisibilityChanged 事件，不新开广播通道。
 */
let modelsRevision = 0
if (typeof window !== 'undefined') {
  window.addEventListener(MODEL_VISIBILITY_CHANGED_EVENT, () => { modelsRevision += 1 })
}

export function getGenerationModelsRevision(): number {
  return modelsRevision
}

/** 供 GenerationModelMutationExecutor 使用：只改 hidden_models 这一个集合，不碰供应商/类型级隐藏。 */
export function setModelHidden(key: string, hidden: boolean): void {
  const hiddenModels = getHiddenModels()
  if (hidden) hiddenModels.add(key)
  else hiddenModels.delete(key)
  saveHiddenModels(hiddenModels)
  window.dispatchEvent(new Event(MODEL_VISIBILITY_CHANGED_EVENT))
}

export function isModelHidden(key: string): boolean {
  return getHiddenModels().has(key)
}

export function buildModelKey(providerId: string, modelId: string): string {
  return `${providerId}-${modelId}`
}

/** 反射层读取用的模型快照：读函数需要 modelId 拼 hidden 的 key，光靠 meta 不够。 */
export interface GenerationModelFieldSource {
  modelId: string
  meta: Record<string, unknown>
  schemaRef: unknown
}

/** 目前只有 hidden 可写，草稿只需要携带这一个字段。 */
export interface GenerationModelDraft {
  hidden?: boolean
}

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(id: string) {
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind: 'property' as const, id, version: 1, digest: digest(`property:${id}`) }
}

function modelDescriptor(
  suffix: string,
  title: string,
  value: ApplicationPropertyDescriptor['value'],
  readOnlyReason?: string,
): ApplicationPropertyDescriptor {
  const id = `${GENERATION_MODEL_ENTITY_TYPE}.${suffix}`
  return {
    id,
    entityType: GENERATION_MODEL_ENTITY_TYPE,
    version: 1,
    title,
    description: `生成${title}。`,
    value,
    nullable: false,
    dataClass: 'C0',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['model_catalog:read'], write: readOnlyReason ? [] : ['model_catalog:write'] },
    revisionScopes: ['models'],
    schemaRef: schemaRef(id),
    ...(readOnlyReason ? { readOnlyReason } : {}),
  }
}

const CATALOG_READONLY_REASON = '模型目录由 src/models/** 的静态定义生成，不是用户数据。'

/*
 * generation.model 只有 hidden 一条可写属性，其余四条保持只读——这是从"整实体
 * writeExclusion"改成"逐属性 readOnlyReason"的迁移（4.4），做法与 storyboardReflection.ts
 * 当年把 readOnlyReason 从写死改成可选参数是同一类修复。
 */
export const GENERATION_MODEL_FIELDS: ApplicationFieldDefinition<GenerationModelFieldSource, GenerationModelDraft>[] = [
  {
    propertyId: `${GENERATION_MODEL_ENTITY_TYPE}.provider_id`,
    descriptor: modelDescriptor('provider_id', '供应商', { kind: 'string', maxLength: 120 }, CATALOG_READONLY_REASON),
    read: (source) => String(source.meta.provider),
    storeActions: [],
  },
  {
    propertyId: `${GENERATION_MODEL_ENTITY_TYPE}.media_type`,
    descriptor: modelDescriptor('media_type', '媒体类型', {
      kind: 'enum', values: ['image', 'video', 'audio'].map((value) => ({ value, label: value })),
    }, CATALOG_READONLY_REASON),
    read: (source) => String(source.meta.type),
    storeActions: [],
  },
  {
    propertyId: `${GENERATION_MODEL_ENTITY_TYPE}.name`,
    descriptor: modelDescriptor('name', '模型名称', { kind: 'string', maxLength: 200 }, CATALOG_READONLY_REASON),
    read: (source) => (typeof source.meta.name === 'string' ? source.meta.name : JSON.stringify(source.meta.name)),
    storeActions: [],
  },
  {
    propertyId: `${GENERATION_MODEL_ENTITY_TYPE}.tags`,
    descriptor: modelDescriptor('tags', '能力标签', { kind: 'json', schemaRef: schemaRef(`${GENERATION_MODEL_ENTITY_TYPE}.tags.value`) }, CATALOG_READONLY_REASON),
    read: (source) => JSON.parse(JSON.stringify(source.meta.tags ?? [])) as JsonValue,
    storeActions: [],
  },
  {
    propertyId: `${GENERATION_MODEL_ENTITY_TYPE}.parameter_schema_ref`,
    descriptor: modelDescriptor('parameter_schema_ref', '参数结构引用', { kind: 'json', schemaRef: schemaRef(`${GENERATION_MODEL_ENTITY_TYPE}.parameter_schema_ref.value`) }, CATALOG_READONLY_REASON),
    read: (source) => JSON.parse(JSON.stringify(source.schemaRef)) as JsonValue,
    storeActions: [],
  },
  /*
   * hidden 是 4.4 松绑 models.visibility 的实际落地：读写都接 src/config/providers.ts 的
   * getHiddenModels/saveHiddenModels（Settings 里"模型管理"面板用的同一套函数），不碰任何
   * store（门禁禁止能力层 setState）。只管这一个模型自己是否被单独加入隐藏名单，不反映供应商
   * 级/媒体类型级的批量隐藏——后两者仍然只能在设置页操作，判断依据见 4.4 执行记录。
   */
  {
    propertyId: `${GENERATION_MODEL_ENTITY_TYPE}.hidden`,
    descriptor: modelDescriptor('hidden', '已隐藏', { kind: 'boolean' }),
    read: (source) => isModelHidden(buildModelKey(String(source.meta.provider), source.modelId)),
    writer: {
      write(draft, mutation) {
        if (typeof mutation.value !== 'boolean') throw new Error('INVALID_INPUT')
        draft.hidden = mutation.value
      },
    },
    storeActions: [],
  },
]
