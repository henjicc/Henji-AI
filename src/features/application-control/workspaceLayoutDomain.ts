import { ApplicationPersistenceBoundaryFailure, ApplicationPersistenceFailure } from '@/core/application-control/execution/persistence'
import { z } from 'zod'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import {
  applyWriterTable, fieldDescriptors, fieldReadValues, fieldWriterTable, propertyOperations, writableProperties, unrestrictedCollectionAvailability,
  type ApplicationEntityRegistration, type ApplicationFieldDefinition, type ApplicationPropertyDescriptor, type ApplicationRef,
  type ApplicationMutationExecutor, type ApplicationCollectionExecutor, type ApplicationPlannedStep, type ApplicationCompletedStepResult,
} from '@/core/application-control'
import { WorkspaceLayoutSaveError, listWorkspaceLayoutControllers, workspaceLayoutController, type WorkspaceLayoutController, type WorkspaceLayoutState } from '@/services/workspaceLayouts/workspaceLayoutService'
import type { ApplicationDomainModule } from './domainModule'

const WORKSPACE = 'workspace_layout.workspace'
const PRESET = 'workspace_layout.preset'
const DOMAIN = 'workspace_layout'
const activePresetCascade = { declarationId: 'workspace_layout.active_preset_changed', effect: 'update' as const, entityType: WORKSPACE,
  propertyIds: [`${WORKSPACE}.active_id`, `${WORKSPACE}.modified`], revisionScopes: [DOMAIN] }
type Source = { controller: WorkspaceLayoutController; presetId?: string }
type Step = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>
const schemaRef = (kind: 'property' | 'entity', id: string): ApplicationPropertyDescriptor['schemaRef'] => ({
  kind, id, version: 1, catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, digest: `sha256:${'8d'.repeat(32)}`,
})
const ref = (controller: WorkspaceLayoutController, presetId?: string): ApplicationRef => ({ kind: presetId ? PRESET : WORKSPACE, id: presetId ? `${controller.registration.workspaceId}/${presetId}` : controller.registration.workspaceId })
const revisions = (): Record<string, number> => ({ workspace_layout: listWorkspaceLayoutControllers().reduce((sum, controller) => sum + controller.getSnapshot().revision, 0) })
function field(entity: string, name: string, title: string, value: ApplicationPropertyDescriptor['value'], read: ApplicationFieldDefinition<Source, Source>['read'], write?: ApplicationFieldDefinition<Source, Source>['writer']): ApplicationFieldDefinition<Source, Source> {
  const id = `${entity}.${name}`
  return { propertyId: id, read, writer: write, storeActions: [], descriptor: {
    id, entityType: entity, version: 1, title, description: title, value, nullable: false, dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: { read: ['settings:read'], write: write ? ['settings:write'] : [] },
    revisionScopes: [DOMAIN], schemaRef: schemaRef('property', id), ...(write ? {} : { readOnlyReason: '由共享工作区布局服务维护，随预设操作自动更新。' }),
  } }
}
const workspaceFields = [
  field(WORKSPACE, 'saved', '布局是否保存成功；设为 true 仅重试保存，不重复原操作', { kind: 'boolean' }, s => s.controller.getSnapshot().error === null,
    { write: async (s, m) => { z.literal(true).parse(m.value); await s.controller.retrySave() } }),
  field(WORKSPACE, 'active_id', '当前布局预设标识；从预设列表选取，切换会加载该预设保存的布局', { kind: 'string' }, s => s.controller.getSnapshot().activeId,
    { write: async (s, m) => { await s.controller.apply(z.string().parse(m.value)) } }),
  field(WORKSPACE, 'modified', '当前布局是否已修改；设为 false 重置为当前预设', { kind: 'boolean' }, s => s.controller.getSnapshot().dirty,
    { write: async (s, m) => { z.literal(false).parse(m.value); await s.controller.resetActive() } }),
  field(WORKSPACE, 'presets', '可用布局预设', { kind: 'ref_list', refKinds: [PRESET] }, s => s.controller.getSnapshot().presets.map(p => ref(s.controller, p.id))),
]
const presetFields = [
  field(PRESET, 'name', '布局名称', { kind: 'string', minLength: 1, maxLength: 80 }, s => s.controller.getSnapshot().presets.find(p => p.id === s.presetId)!.name,
    { write: async (s, m) => { await s.controller.rename(s.presetId!, z.string().parse(m.value)) } }),
  field(PRESET, 'builtin', '内置预设不可修改或删除', { kind: 'boolean' }, s => s.controller.getSnapshot().presets.find(p => p.id === s.presetId)!.builtin),
  field(PRESET, 'matches_current', '是否等于当前布局；设为 true 用当前布局覆盖这个用户预设', { kind: 'boolean' }, s => JSON.stringify(s.controller.getSnapshot().current) === JSON.stringify(s.controller.getSnapshot().presets.find(p => p.id === s.presetId)!.layout),
    { write: async (s, m) => { z.literal(true).parse(m.value); await s.controller.overwrite(s.presetId!) } }),
]
async function source(target: ApplicationRef): Promise<Source> {
  if (target.kind !== WORKSPACE && target.kind !== PRESET) throw new Error('布局引用类型无效')
  const slash = target.id.lastIndexOf('/')
  const controller = workspaceLayoutController(target.kind === PRESET ? target.id.slice(0, slash) : target.id)
  await controller.load()
  const presetId = target.kind === PRESET ? target.id.slice(slash + 1) : undefined
  if (presetId && !controller.getSnapshot().presets.some(p => p.id === presetId)) throw new Error('NOT_FOUND:布局预设已不存在，请重新读取列表')
  return { controller, presetId }
}
function registrations(): ApplicationEntityRegistration[] {
  return [WORKSPACE, PRESET].map(entityType => {
    const fields = entityType === WORKSPACE ? workspaceFields : presetFields
    return {
      entity: { id: entityType, domain: DOMAIN, version: 1, title: entityType === WORKSPACE ? '工作区布局' : '布局预设',
        description: '共享布局预设。读取工作区的 presets 获取预设引用，active_id 用预设引用末段标识。新建预设保存当前布局；内置预设只读。图片宿主第一次打开后登记，布局只影响面板排列。',
        refKind: entityType, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: entityType === PRESET ? [WORKSPACE] : [],
        revisionScopes: [DOMAIN], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', entityType),
        ...(entityType === PRESET ? { collectionWrite: { creatable: true, removable: true, requiredPropertyIds: [`${PRESET}.name`], maxItemsPerChange: 16 } } : {}),
      },
      properties: fieldDescriptors(fields),
      provider: {
        entityType,
        async listEntities(request) {
          const controllers = listWorkspaceLayoutControllers()
          await Promise.all(controllers.map(controller => controller.load()))
          const all = controllers.flatMap(controller => entityType === WORKSPACE ? [ref(controller)] : controller.getSnapshot().presets.map(p => ref(controller, p.id)))
          const offset = Number(request.cursor ?? 0)
          const page = all.slice(offset, offset + request.limit)
          return { refs: page, nextCursor: offset + page.length < all.length ? String(offset + page.length) : null, revisions: revisions() }
        },
        async readEntity(target, request) {
          const s = await source(target)
          const properties = fieldReadValues(fields, s)
          return { ref: target, entityType, properties: request.propertyIds ? Object.fromEntries(Object.entries(properties).filter(([id]) => request.propertyIds!.includes(id))) : properties, revisions: revisions(), capturedAt: new Date().toISOString() }
        },
        async getPropertyAvailability(target, ids) {
          const s = await source(target)
          const builtin = s.presetId && s.controller.getSnapshot().presets.find(p => p.id === s.presetId)?.builtin
          return ids.map(propertyId => {
            const definition = fields.find(f => f.propertyId === propertyId)
            if (!definition) throw new Error(`未知布局属性：${propertyId}`)
            const writable = !!definition.writer && !builtin
            return { propertyId, readable: true, writable, reasons: builtin ? ['内置预设只读，请先另存为用户预设'] : [], requiredPermissions: ['settings:read'], revisions: revisions() }
          })
        },
        async getCollectionAvailability(parent) {
          await source(parent)
          const result = unrestrictedCollectionAvailability(entityType, parent, revisions(), ['settings:write'])
          if (parent.kind !== WORKSPACE) {
            result.create = { ...result.create, available: false, reasons: ['预设必须创建在工作区布局下'] }
            result.remove = { ...result.remove, available: false, reasons: ['预设必须从所属工作区删除'] }
          }
          return result
        },
      },
    }
  })
}

const undos = new Map<string, { controller: WorkspaceLayoutController; before: WorkspaceLayoutState; refs: ApplicationRef[] }>()
function completed(refs: ApplicationRef[], undoToken?: string): ApplicationCompletedStepResult {
  return { status: 'completed', directRefs: refs, resultingRevisions: revisions(), ...(undoToken ? { undoToken } : {}), evidence: [{ kind: 'entity_state', fact: '布局预设已从共享状态源读回并保存。', capturedAt: new Date().toISOString() }] }
}
async function edit(controller: WorkspaceLayoutController, action: () => Promise<ApplicationRef[]>, collection = false, failureRefs: ApplicationRef[] = [ref(controller)]): Promise<ApplicationCompletedStepResult> {
  const { activeId, current, users } = controller.getSnapshot()
  const before = structuredClone({ activeId, current, users })
  try {
    const refs = await action(), token = crypto.randomUUID()
    undos.set(token, { controller, before, refs })
    while (undos.size > 128) undos.delete(undos.keys().next().value!)
    const result = completed(refs, token)
    if (collection && before.activeId !== controller.getSnapshot().activeId) result.cascadeEffects = [{
      effect: 'update', entityType: WORKSPACE, refs: [ref(controller)], propertyIds: [...activePresetCascade.propertyIds],
      origin: { kind: 'cascade', declarationId: activePresetCascade.declarationId },
    }]
    return result
  } catch (error) {
    if (error instanceof WorkspaceLayoutSaveError) {
      const afterIds = controller.getSnapshot().users.map(p => p.id), beforeIds = before.users.map(p => p.id)
      const changedIds = [...afterIds.filter(id => !beforeIds.includes(id)), ...beforeIds.filter(id => !afterIds.includes(id))]
      const token = crypto.randomUUID(), refs = collection ? changedIds.map(id => ref(controller, id)) : failureRefs
      undos.set(token, { controller, before, refs })
      const result = completed(refs, token)
      result.evidence = [{ kind: 'entity_state', fact: '布局修改已保留在内存，保存尚未确认。读取 saved 后可设为 true 重试保存。', capturedAt: new Date().toISOString() }]
      throw new ApplicationPersistenceBoundaryFailure(new ApplicationPersistenceFailure('布局修改已保留，保存失败；请读取当前布局，不要重复创建或切换。', {
        memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'projection', recovery: { capabilityId: 'read_application_entity', target: ref(controller), replayMutation: false },
      }, error), [result])
    }
    const after = controller.getSnapshot()
    if (JSON.stringify({ activeId: after.activeId, current: after.current, users: after.users }) !== JSON.stringify(before)) await controller.restore(before)
    throw error
  }
}
async function undo(token: string): Promise<ApplicationCompletedStepResult> {
  const entry = undos.get(token)
  if (!entry) throw new Error('布局撤销记录已失效')
  await entry.controller.restore(entry.before); undos.delete(token)
  return completed(entry.refs)
}
class LayoutMutationExecutor implements ApplicationMutationExecutor {
  readonly effectContract = { direct: [], cascades: [] }
  readonly table
  readonly writableProperties
  readonly propertyOperations
  constructor(readonly entityType: string) {
    this.table = fieldWriterTable(entityType === WORKSPACE ? workspaceFields : presetFields)
    this.writableProperties = writableProperties(this.table)
    this.propertyOperations = propertyOperations(this.table)
  }
  async apply(step: Step): Promise<ApplicationCompletedStepResult> {
    const s = await source(step.target)
    return edit(s.controller, async () => { await applyWriterTable(this.table, s, step.mutations); return [step.target] }, false, [step.target])
  }
  undo = undo
  async compensate(_step: Step, result: ApplicationCompletedStepResult) { if (result.undoToken) await undo(result.undoToken); return [] }
  forget(token: string): void { undos.delete(token) }
}
class LayoutCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = PRESET
  readonly effectContract = { direct: [], cascades: [activePresetCascade] }
  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    if (step.parent.kind !== WORKSPACE) throw new Error('预设需要所属工作区')
    const { controller } = await source(step.parent)
    return edit(controller, async () => {
      const refs: ApplicationRef[] = []
      if (step.operation.kind === 'create') for (const item of step.operation.items) {
        const id = await controller.saveAs(z.string().parse(item.properties[`${PRESET}.name`]))
        refs.push(ref(controller, id))
      } else for (const target of step.operation.targets) {
        const s = await source(target)
        if (s.controller !== controller || !s.presetId) throw new Error('不能删除其他工作区的预设')
        await controller.remove(s.presetId); refs.push(target)
      }
      return refs
    }, true)
  }
  undo = undo
  async compensate(_step: CollectionStep, result: ApplicationCompletedStepResult) { if (result.undoToken) await undo(result.undoToken); return [] }
  forget(token: string): void { undos.delete(token) }
}
export const workspaceLayoutApplicationDomain: ApplicationDomainModule = {
  id: DOMAIN, entities: registrations,
  registerExecutors(engine) {
    engine.registerMutationExecutor(new LayoutMutationExecutor(WORKSPACE))
    engine.registerMutationExecutor(new LayoutMutationExecutor(PRESET))
    engine.registerCollectionExecutor(new LayoutCollectionExecutor())
  },
  registerCapabilities() {},
}
