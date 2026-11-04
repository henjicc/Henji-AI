import { v4 as uuidv4 } from 'uuid'
import {
  unrestrictedCollectionAvailability,
  type ApplicationCollectionExecutor, type ApplicationCompletedStepResult, type ApplicationEntityProvider,
  type ApplicationEntityRegistration, type ApplicationEvidence, type ApplicationPlannedStep,
  type ApplicationPropertyDescriptor, type ApplicationRef, type JsonValue,
} from '@/core/application-control'
import { rollbackStepWrites } from '@/core/application-control/execution/persistence'
import { webReplayTakeNameSchema } from '@/core/webReplay/director'
import { getPlatform } from '@/platform'
import { sha256HexString } from '@/utils/save/hash'
import { WEB_RECORDING_TYPE } from './webAppRecordingCollectionExecutor'
import { webAppSchemaRef } from './webAppRecordingFields'

export const WEB_REPLAY_TAKE_TYPE = 'screen_recording.web_replay_take'
const reason = '版本内容由 render_web_app_replay 生成；删除用 change_application_entities 的集合删除，父级为所属 screen_recording.web_recording。删除进入回收区，可恢复；重演中的录制需先等待或取消重演。'
const SCOPE = 'screen_recording.web_replay_takes'
type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>

/** 基线由权威集合内容决定；同名重演使它变化，失败补偿恢复原集合时仍能沿原撤销回执重试。 */
async function state() {
  const recordings = await getPlatform().webReplay.recordings()
  const next = JSON.stringify(recordings.map(recording => ({ id: recording.id, takes: [...recording.takes ?? []].sort((a, b) => a.name.localeCompare(b.name)) })).sort((a, b) => a.id.localeCompare(b.id)))
  const revision = Number.parseInt((await sha256HexString(next)).slice(0, 13), 16)
  return { recordings, revisions: { [SCOPE]: revision } }
}

function takeRef(recordingId: string, name: string): ApplicationRef {
  return { kind: WEB_REPLAY_TAKE_TYPE, id: `${recordingId}:${name}`, label: name }
}

function parseRef(ref: ApplicationRef): { recordingId: string; name: string } {
  const separator = ref.id.indexOf(':')
  if (ref.kind !== WEB_REPLAY_TAKE_TYPE || separator < 1) throw new Error('网页重演版本引用无效，请重新列出 screen_recording.web_replay_take')
  const name = webReplayTakeNameSchema.parse(ref.id.slice(separator + 1))
  return { recordingId: ref.id.slice(0, separator), name }
}

const properties: ApplicationEntityRegistration['properties'] = ([
  ['name', '版本名称', { kind: 'string' }],
  ['recording_ref', '所属录制', { kind: 'ref', refKinds: [WEB_RECORDING_TYPE] }],
  ['video', '视频文件', { kind: 'string' }],
] satisfies Array<[string, string, ApplicationPropertyDescriptor['value']]>).map(([suffix, title, value]) => ({
  id: `${WEB_REPLAY_TAKE_TYPE}.${suffix}`, entityType: WEB_REPLAY_TAKE_TYPE, version: 1,
  title, description: title, value: { ...value },
  nullable: suffix === 'video', dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
  revisionScopes: [SCOPE], requiredPermissions: { read: ['screen_recording:read'], write: [] },
  schemaRef: webAppSchemaRef('property', `${WEB_REPLAY_TAKE_TYPE}.${suffix}`), readOnlyReason: reason,
}))

const provider: ApplicationEntityProvider = {
  entityType: WEB_REPLAY_TAKE_TYPE,
  async listEntities(request) {
    const offset = Number(request.cursor ?? 0)
    if (!Number.isSafeInteger(offset) || offset < 0) throw new Error('分页位置无效')
    const { recordings, revisions } = await state()
    const refs = recordings.flatMap(recording => (recording.takes ?? []).map(take => takeRef(recording.id, take.name)))
    return { refs: refs.slice(offset, offset + request.limit), nextCursor: offset + request.limit < refs.length ? String(offset + request.limit) : null, revisions }
  },
  async readEntity(ref, request) {
    const { recordingId, name } = parseRef(ref)
    const { recordings, revisions } = await state()
    const recording = recordings.find(item => item.id === recordingId)
    const take = recording?.takes?.find(item => item.name === name)
    if (!take) throw new Error(`NOT_FOUND:这段录制没有叫“${name}”的版本，请重新列出 screen_recording.web_replay_take`)
    const values: Record<string, JsonValue> = { name, recording_ref: { kind: WEB_RECORDING_TYPE, id: recordingId }, video: take.video }
    return {
      ref, entityType: WEB_REPLAY_TAKE_TYPE, revisions, capturedAt: new Date().toISOString(),
      properties: Object.fromEntries(Object.entries(values).map(([key, value]) => [`${WEB_REPLAY_TAKE_TYPE}.${key}`, value]).filter(([key]) => !request.propertyIds || request.propertyIds.includes(key as string))),
    }
  },
  async getPropertyAvailability(ref, propertyIds) {
    const { revisions } = await this.readEntity(ref, {})
    return propertyIds.map(propertyId => {
      if (!properties.some(property => property.id === propertyId)) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}`)
      return { propertyId, readable: true, writable: false, reasons: [reason], requiredPermissions: ['screen_recording:read'], revisions }
    })
  },
  async getCollectionAvailability(parent) {
    const { recordings, revisions } = await state()
    if (parent.kind !== WEB_RECORDING_TYPE || !recordings.some(recording => recording.id === parent.id)) throw new Error('没有找到所属网页录制，请重新列出 screen_recording.web_recording')
    return unrestrictedCollectionAvailability(WEB_REPLAY_TAKE_TYPE, parent, revisions, [])
  },
}

export function webReplayTakeRegistration(): ApplicationEntityRegistration {
  return {
    entity: {
      id: WEB_REPLAY_TAKE_TYPE, domain: 'screen_recording', version: 1, title: '网页重演版本', description: reason,
      refKind: WEB_REPLAY_TAKE_TYPE, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [WEB_RECORDING_TYPE],
      revisionScopes: [SCOPE], queryCapabilityIds: ['read_application_entity'], schemaRef: webAppSchemaRef('entity', WEB_REPLAY_TAKE_TYPE),
      collectionWrite: { creatable: false, removable: true, requiredPropertyIds: [], maxItemsPerChange: 32 },
    },
    properties, provider,
  }
}

/** 只保存回收副本身份供补偿，文件移动与恢复均委托网页录制领域服务。 */
export class WebReplayTakeCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = WEB_REPLAY_TAKE_TYPE
  readonly effectContract = { direct: [], cascades: [] }
  private readonly undoRecords = new Map<string, Array<{ ref: ApplicationRef; trashId: string }>>()

  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    if (step.operation.kind === 'create') throw new Error('网页重演版本请用 render_web_app_replay 生成')
    const targets = step.operation.targets.map(ref => ({ ref, ...parseRef(ref) }))
    if (step.parent.kind !== WEB_RECORDING_TYPE || targets.some(target => target.recordingId !== step.parent.id)) throw new Error('删除版本的父级必须是它所属的网页录制')
    const removed: Array<{ ref: ApplicationRef; trashId: string }> = []
    try {
      for (const target of targets) removed.push({ ref: target.ref, trashId: await getPlatform().webReplay.removeTake(target.recordingId, target.name) })
    } catch (error) {
      // 恢复不了的版本留在回收区，作为这一步仍然生效的删除报告，不能声称没有写入。
      return rollbackStepWrites(error, async () => {
        while (removed.length > 0) {
          await getPlatform().webReplay.restore(removed[removed.length - 1].trashId)
          removed.pop()
        }
      }, async () => ({ status: 'completed', resultingRevisions: (await state()).revisions, directRefs: removed.map(item => item.ref), evidence: [] }))
    }
    const undoToken = `web-replay-take-undo:${uuidv4()}`
    this.undoRecords.set(undoToken, removed)
    return { status: 'completed', resultingRevisions: (await state()).revisions, directRefs: removed.map(item => item.ref), undoToken,
      evidence: [{ kind: 'operation_result', target: step.parent, fact: `已将 ${removed.length} 个网页重演版本移到回收区。`, capturedAt: new Date().toISOString() }] }
  }

  async compensate(_step: CollectionStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    return result.undoToken ? (await this.undo(result.undoToken)).evidence : []
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const removed = this.undoRecords.get(undoToken)
    if (!removed) throw new Error('没有找到这次网页重演版本删除的撤销记录')
    const restored: typeof removed = []
    try {
      for (const item of removed) { await getPlatform().webReplay.restore(item.trashId); restored.push(item) }
    } catch (error) {
      // 一步撤销必须保持整组原子性，否则公共事务的删除后基线会失效，不能用同一回执重试。
      // 重新删不掉的版本已经恢复，作为这一步撤销的部分结果报告。
      return rollbackStepWrites(error, async () => {
        while (restored.length > 0) {
          const item = restored[restored.length - 1]
          const { recordingId, name } = parseRef(item.ref)
          item.trashId = await getPlatform().webReplay.removeTake(recordingId, name)
          restored.pop()
        }
      }, async () => ({ status: 'completed', resultingRevisions: (await state()).revisions, directRefs: restored.map(item => item.ref), evidence: [] }))
    }
    this.undoRecords.delete(undoToken)
    return { status: 'completed', resultingRevisions: (await state()).revisions, directRefs: removed.map(item => item.ref),
      evidence: removed.map(item => ({ kind: 'entity_state', target: item.ref, fact: '网页重演版本已恢复。', capturedAt: new Date().toISOString() })) }
  }
}
