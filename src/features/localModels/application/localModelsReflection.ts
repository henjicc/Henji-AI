import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import {
  applyWriterTable,
  fieldDescriptors,
  fieldReadValues,
  fieldWriterTable,
  propertyOperations,
  unrestrictedCollectionAvailability,
  writableProperties,
  type ApplicationCompletedStepResult,
  type ApplicationEntityRegistration,
  type ApplicationFieldDefinition,
  type ApplicationMutationExecutor,
  type ApplicationPlannedStep,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
} from '@/core/application-control'
import {
  ensureLocalModel,
  getLocalModelsState,
  removeLocalModel,
  setLocalModelDownloadSource,
} from '@/commands/localModels'
import {
  isLocalModelId,
  LOCAL_MODEL_DOWNLOAD_SOURCES,
  type LocalModelDownloadSource,
  type LocalModelId,
  type LocalModelInfo,
  type LocalModelsState,
} from '@/platform/contracts/localModels'

/*
 * 本地模型的助手覆盖（任务 4.11）：模型列表与状态可读；下载 / 删除是对 `downloaded` 属性的普通写入，
 * 下载源是设置实体的一条属性。全部走通用实体读改，不写专用能力。
 *
 * 真相源是主进程 LocalModelService，经 `src/commands/localModels.ts` 访问；设置页与助手共用同一组命令。
 */

export const LOCAL_MODEL_ENTITY_TYPE = 'local_model.item'
export const LOCAL_MODEL_SETTINGS_ENTITY_TYPE = 'local_model.settings'
const DOMAIN = 'local_models'
const REVISION_SCOPE = 'local_models'
const SETTINGS_REF: ApplicationRef = { kind: LOCAL_MODEL_SETTINGS_ENTITY_TYPE, id: 'singleton' }
const PERMISSIONS = { read: ['settings:read'], write: ['settings:write'] }
/** 下载在后台进行；写入时最多等这么久，等不到就返回“正在下载”，之后读 status 看结果。 */
const DOWNLOAD_WAIT_MS = 20_000

const STATUS_LABELS: Record<LocalModelInfo['status'], string> = {
  not_downloaded: '未下载',
  downloading: '正在下载',
  ready: '已下载',
  corrupt: '校验失败，需要重新下载',
  unavailable: '暂不可下载',
}

const SOURCE_LABELS: Record<LocalModelDownloadSource, string> = {
  auto: '自动选择',
  domestic: '国内（ModelScope）',
  global: '国外（Hugging Face / GitHub）',
}

function schemaRef(kind: 'entity' | 'property', id: string) {
  const value = [...`${kind}:${id}`].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${value.padEnd(64, value).slice(0, 64)}` } as const
}

function descriptor(
  entityType: string,
  suffix: string,
  title: string,
  description: string,
  value: ApplicationPropertyDescriptor['value'],
  extra: Partial<ApplicationPropertyDescriptor> = {},
): ApplicationPropertyDescriptor {
  const id = `${entityType}.${suffix}`
  return {
    id, entityType, version: 1, title, description, value, nullable: false, dataClass: 'C0',
    exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: PERMISSIONS,
    revisionScopes: [REVISION_SCOPE], schemaRef: schemaRef('property', id), ...extra,
  }
}

const READ_ONLY = '由本地模型清单与下载服务维护。'

interface ModelDraft { downloaded?: boolean }

const modelFields: ApplicationFieldDefinition<LocalModelInfo, ModelDraft>[] = [
  {
    propertyId: `${LOCAL_MODEL_ENTITY_TYPE}.title`,
    descriptor: descriptor(LOCAL_MODEL_ENTITY_TYPE, 'title', '模型名称', '模型的显示名称。', { kind: 'string', maxLength: 120 }, { readOnlyReason: READ_ONLY }),
    read: (model) => model.title.zh, storeActions: [],
  },
  {
    propertyId: `${LOCAL_MODEL_ENTITY_TYPE}.purpose`,
    descriptor: descriptor(LOCAL_MODEL_ENTITY_TYPE, 'purpose', '用途', '这个模型用来做什么（人脸、抠像、文字区域、物体跟踪等）。', { kind: 'string', maxLength: 200 }, { readOnlyReason: READ_ONLY }),
    read: (model) => model.purpose.zh, storeActions: [],
  },
  {
    propertyId: `${LOCAL_MODEL_ENTITY_TYPE}.status`,
    descriptor: descriptor(LOCAL_MODEL_ENTITY_TYPE, 'status', '状态',
      '未下载 / 正在下载 / 已下载 / 校验失败（文件被改动或不完整，把 downloaded 设为 true 会重新下载）/ 暂不可下载。',
      { kind: 'enum', values: Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })) },
      { readOnlyReason: '由下载服务按本地文件校验结果给出；要下载或删除请写 downloaded。', verificationStrategy: 'execution' }),
    read: (model) => model.status, storeActions: [],
  },
  {
    propertyId: `${LOCAL_MODEL_ENTITY_TYPE}.size_mb`,
    descriptor: descriptor(LOCAL_MODEL_ENTITY_TYPE, 'size_mb', '下载大小', '全部文件合计大小。', { kind: 'number', hardRange: { min: 0 } }, { unit: 'MB', readOnlyReason: READ_ONLY }),
    read: (model) => Math.round(model.sizeBytes / 10_000) / 100, storeActions: [],
  },
  {
    propertyId: `${LOCAL_MODEL_ENTITY_TYPE}.license`,
    descriptor: descriptor(LOCAL_MODEL_ENTITY_TYPE, 'license', '许可证', '模型的开源许可证。', { kind: 'string', maxLength: 40 }, { readOnlyReason: READ_ONLY }),
    read: (model) => model.license, storeActions: [],
  },
  {
    propertyId: `${LOCAL_MODEL_ENTITY_TYPE}.downloaded`,
    descriptor: descriptor(LOCAL_MODEL_ENTITY_TYPE, 'downloaded', '已下载',
      '设为 true：下载并校验这个模型（已下载则不变；需要时也会自动下载，一般不必提前做）。下载在后台进行，'
        + '较大的模型写入后可能仍是“正在下载”，之后读 status 确认变为已下载。设为 false：删除本地文件，下次用到时重新下载。',
      { kind: 'boolean' }, { verificationStrategy: 'execution' }),
    read: (model) => model.status === 'ready',
    writer: { write(draft, mutation) { if (typeof mutation.value !== 'boolean') throw new Error('INVALID_INPUT:downloaded 只接受 true 或 false'); draft.downloaded = mutation.value } },
    storeActions: [],
  },
]

interface SettingsDraft { downloadSource?: LocalModelDownloadSource }

const settingsFields: ApplicationFieldDefinition<LocalModelsState, SettingsDraft>[] = [{
  propertyId: `${LOCAL_MODEL_SETTINGS_ENTITY_TYPE}.download_source`,
  descriptor: descriptor(LOCAL_MODEL_SETTINGS_ENTITY_TYPE, 'download_source', '模型下载源',
    '本地模型从哪里下载：auto 自动探测哪边快；domestic 国内（ModelScope）优先；global 国外（Hugging Face / GitHub）优先。'
      + '选定的一边失败时仍会自动换另一边。对应设置“文件与下载 › 本地模型”。',
    { kind: 'enum', values: LOCAL_MODEL_DOWNLOAD_SOURCES.map((value) => ({ value, label: SOURCE_LABELS[value] })) }),
  read: (state) => state.downloadSource,
  writer: {
    write(draft, mutation) {
      if (typeof mutation.value !== 'string' || !(LOCAL_MODEL_DOWNLOAD_SOURCES as readonly string[]).includes(mutation.value)) {
        throw new Error(`INVALID_INPUT:download_source 只接受 ${LOCAL_MODEL_DOWNLOAD_SOURCES.join(' / ')}`)
      }
      draft.downloadSource = mutation.value as LocalModelDownloadSource
    },
  },
  storeActions: [],
}]

const modelWriters = fieldWriterTable(modelFields)
const settingsWriters = fieldWriterTable(settingsFields)
const revisions = (state: LocalModelsState) => ({ [REVISION_SCOPE]: state.revision })

function filterProperties(values: Record<string, ReturnType<typeof fieldReadValues>[string]>, propertyIds?: string[]) {
  return propertyIds ? Object.fromEntries(Object.entries(values).filter(([id]) => propertyIds.includes(id))) : values
}

function findModel(state: LocalModelsState, ref: ApplicationRef): LocalModelInfo {
  const model = ref.kind === LOCAL_MODEL_ENTITY_TYPE && isLocalModelId(ref.id) ? state.models.find((item) => item.id === ref.id) : undefined
  if (!model) throw new Error(`NOT_FOUND:没有这个本地模型，可用的有 ${state.models.map((item) => item.id).join('、')}`)
  return model
}

function modelRef(model: LocalModelInfo): ApplicationRef {
  return { kind: LOCAL_MODEL_ENTITY_TYPE, id: model.id, label: model.title.zh }
}

export function createLocalModelRegistrations(): ApplicationEntityRegistration[] {
  return [
    {
      entity: {
        id: LOCAL_MODEL_ENTITY_TYPE, domain: DOMAIN, version: 1, title: '本地模型',
        description: '在本机运行的小模型（人脸检测、人物抠像、人像分割、文字检测、物体跟踪），第一次用到时自动下载，'
          + '也可以提前下载或删除。读 status 看是否可用，写 downloaded 下载或删除。',
        refKind: LOCAL_MODEL_ENTITY_TYPE, dataClass: 'C0', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [],
        revisionScopes: [REVISION_SCOPE], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', LOCAL_MODEL_ENTITY_TYPE),
      },
      properties: fieldDescriptors(modelFields),
      provider: {
        entityType: LOCAL_MODEL_ENTITY_TYPE,
        async listEntities(request) {
          const state = await getLocalModelsState()
          const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
          const page = state.models.slice(offset, offset + request.limit)
          return { refs: page.map(modelRef), nextCursor: offset + page.length < state.models.length ? String(offset + page.length) : null, revisions: revisions(state) }
        },
        async readEntity(ref, request) {
          const state = await getLocalModelsState()
          const model = findModel(state, ref)
          return { ref: modelRef(model), entityType: LOCAL_MODEL_ENTITY_TYPE, revisions: revisions(state), properties: filterProperties(fieldReadValues(modelFields, model), request.propertyIds), capturedAt: new Date().toISOString() }
        },
        async getPropertyAvailability(ref, propertyIds) {
          const state = await getLocalModelsState()
          const model = findModel(state, ref)
          return propertyIds.map((propertyId) => {
            const field = modelFields.find((item) => item.propertyId === propertyId)
            if (!field) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}，可用的有 ${modelFields.map((item) => item.propertyId).join('、')}`)
            const unavailable = field.writer !== undefined && model.status === 'unavailable'
            const writable = field.writer !== undefined && !unavailable
            return {
              propertyId, readable: true, writable,
              reasons: writable ? [] : [unavailable ? '这个模型暂时没有可下载的文件。' : field.descriptor.readOnlyReason ?? READ_ONLY],
              requiredPermissions: PERMISSIONS.write, revisions: revisions(state),
            }
          })
        },
        async getCollectionAvailability(request) { return unrestrictedCollectionAvailability(LOCAL_MODEL_ENTITY_TYPE, request, {}, PERMISSIONS.write) },
      },
    },
    {
      entity: {
        id: LOCAL_MODEL_SETTINGS_ENTITY_TYPE, domain: DOMAIN, version: 1, title: '本地模型设置',
        description: '本地模型的下载设置（下载源）。',
        refKind: LOCAL_MODEL_SETTINGS_ENTITY_TYPE, dataClass: 'C0', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [],
        revisionScopes: [REVISION_SCOPE], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', LOCAL_MODEL_SETTINGS_ENTITY_TYPE),
      },
      properties: fieldDescriptors(settingsFields),
      provider: {
        entityType: LOCAL_MODEL_SETTINGS_ENTITY_TYPE,
        async listEntities() { const state = await getLocalModelsState(); return { refs: [SETTINGS_REF], nextCursor: null, revisions: revisions(state) } },
        async readEntity(ref, request) {
          if (ref.kind !== LOCAL_MODEL_SETTINGS_ENTITY_TYPE || ref.id !== SETTINGS_REF.id) throw new Error('NOT_FOUND:本地模型设置只有一个实例 singleton')
          const state = await getLocalModelsState()
          return { ref: SETTINGS_REF, entityType: LOCAL_MODEL_SETTINGS_ENTITY_TYPE, revisions: revisions(state), properties: filterProperties(fieldReadValues(settingsFields, state), request.propertyIds), capturedAt: new Date().toISOString() }
        },
        async getPropertyAvailability(_ref, propertyIds) {
          const state = await getLocalModelsState()
          return propertyIds.map((propertyId) => ({ propertyId, readable: true, writable: true, reasons: [], requiredPermissions: PERMISSIONS.write, revisions: revisions(state) }))
        },
        async getCollectionAvailability(request) { return unrestrictedCollectionAvailability(LOCAL_MODEL_SETTINGS_ENTITY_TYPE, request, {}, PERMISSIONS.write) },
      },
    },
  ]
}

type MutationStep = Extract<ApplicationPlannedStep, { kind: 'mutation' }>

async function waitForDownload(id: LocalModelId): Promise<boolean> {
  const download = ensureLocalModel(id).then(() => true)
  // 后台下载失败由下载服务记录原因并反映在 status 上，这里不让未处理的拒绝冒出来。
  download.catch(() => undefined)
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), DOWNLOAD_WAIT_MS) })
  try {
    return await Promise.race([download, timeout])
  } finally {
    clearTimeout(timer)
  }
}

/** 按目标状态下载或删除；返回给人看的结果说明。 */
async function applyDownloaded(id: LocalModelId, downloaded: boolean): Promise<string> {
  if (!downloaded) {
    await removeLocalModel(id)
    return '本地文件已删除。'
  }
  return (await waitForDownload(id)) ? '已下载并校验通过。' : '正在后台下载，稍后读 status 确认。'
}

export class LocalModelMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = LOCAL_MODEL_ENTITY_TYPE
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties = writableProperties(modelWriters)
  readonly propertyOperations = propertyOperations(modelWriters)

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    const before = findModel(await getLocalModelsState(), step.target)
    const draft: ModelDraft = {}
    await applyWriterTable(modelWriters, draft, step.mutations)
    if (draft.downloaded === undefined) throw new Error('INVALID_INPUT:没有可写的属性')
    const fact = await applyDownloaded(before.id, draft.downloaded)
    const after = await getLocalModelsState()
    const ref = modelRef(findModel(after, step.target))
    const changed = (before.status === 'ready') !== draft.downloaded
    return {
      status: 'completed', resultingRevisions: revisions(after), directRefs: [ref],
      evidence: [{ kind: 'entity_state', target: ref, fact: `${before.title.zh}：${fact}`, capturedAt: new Date().toISOString() }],
      undoToken: changed ? JSON.stringify({ id: before.id, downloaded: before.status === 'ready' }) : undefined,
    }
  }

  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const parsed = JSON.parse(token) as { id: unknown; downloaded: unknown }
    if (!isLocalModelId(parsed.id) || typeof parsed.downloaded !== 'boolean') throw new Error('INVALID_UNDO_TOKEN')
    const fact = await applyDownloaded(parsed.id, parsed.downloaded)
    const after = await getLocalModelsState()
    const ref = modelRef(findModel(after, { kind: LOCAL_MODEL_ENTITY_TYPE, id: parsed.id }))
    return { status: 'completed', resultingRevisions: revisions(after), directRefs: [ref], evidence: [{ kind: 'entity_state', target: ref, fact, capturedAt: new Date().toISOString() }] }
  }

  async compensate(_step: MutationStep, result: ApplicationCompletedStepResult) {
    return result.undoToken ? (await this.undo(result.undoToken)).evidence : []
  }
}

export class LocalModelSettingsMutationExecutor implements ApplicationMutationExecutor {
  readonly entityType = LOCAL_MODEL_SETTINGS_ENTITY_TYPE
  readonly effectContract = { direct: [], cascades: [] }
  readonly writableProperties = writableProperties(settingsWriters)
  readonly propertyOperations = propertyOperations(settingsWriters)

  async apply(step: MutationStep): Promise<ApplicationCompletedStepResult> {
    if (step.target.kind !== LOCAL_MODEL_SETTINGS_ENTITY_TYPE || step.target.id !== SETTINGS_REF.id) throw new Error('NOT_FOUND:本地模型设置只有一个实例 singleton')
    const before = await getLocalModelsState()
    const draft: SettingsDraft = {}
    await applyWriterTable(settingsWriters, draft, step.mutations)
    const next = draft.downloadSource ?? before.downloadSource
    await setLocalModelDownloadSource(next)
    const after = await getLocalModelsState()
    return {
      status: 'completed', resultingRevisions: revisions(after), directRefs: [SETTINGS_REF],
      evidence: [{ kind: 'entity_state', target: SETTINGS_REF, fact: `模型下载源已设为${SOURCE_LABELS[next]}。`, capturedAt: new Date().toISOString() }],
      undoToken: JSON.stringify({ downloadSource: before.downloadSource }),
    }
  }

  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const parsed = JSON.parse(token) as { downloadSource: unknown }
    if (typeof parsed.downloadSource !== 'string' || !(LOCAL_MODEL_DOWNLOAD_SOURCES as readonly string[]).includes(parsed.downloadSource)) throw new Error('INVALID_UNDO_TOKEN')
    await setLocalModelDownloadSource(parsed.downloadSource as LocalModelDownloadSource)
    const after = await getLocalModelsState()
    return { status: 'completed', resultingRevisions: revisions(after), directRefs: [SETTINGS_REF], evidence: [{ kind: 'entity_state', target: SETTINGS_REF, fact: '模型下载源已恢复。', capturedAt: new Date().toISOString() }] }
  }

  async compensate(_step: MutationStep, result: ApplicationCompletedStepResult) {
    return result.undoToken ? (await this.undo(result.undoToken)).evidence : []
  }
}
