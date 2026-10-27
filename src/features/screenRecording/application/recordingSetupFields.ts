import { z } from 'zod'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import { applyWriterTable, fieldDescriptors, fieldReadValues, fieldWriterTable, propertyOperations, unrestrictedCollectionAvailability, writableProperties,
  type ApplicationCompletedStepResult, type ApplicationEntityRegistration, type ApplicationFieldDefinition, type ApplicationMutationExecutor, type ApplicationPlannedStep, type ApplicationPropertyDescriptor, type ApplicationRef } from '@/core/application-control'
import { recordingEncodingFields } from '@/core/screenRecording/encoding'
import { recordingOutput } from '../recordingSetupModel'
import { readRecordingVideoSetup, recordingVideoSetupRevision, writeRecordingVideoSetup, type RecordingVideoSetup } from '../recordingSetupSync'

export const RECORDING_SETUP_ENTITY = 'screen_recording.setup'
const SCOPE = 'screen_recording_setup'
const target: ApplicationRef = { kind: RECORDING_SETUP_ENTITY, id: 'singleton', label: '录屏视频设置' }
const PLACE = '界面位置：屏幕录制页 › 画面'
function schemaRef(kind: 'entity' | 'property', id: string) {
  const seed = [...id].reduce((hash, char) => (hash * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${seed.padEnd(64, seed).slice(0, 64)}` } as const
}
const enums = (values: readonly string[]): ApplicationPropertyDescriptor['value'] => ({ kind: 'enum', values: values.map(value => ({ value, label: value })) })
type Field = ApplicationFieldDefinition<RecordingVideoSetup, RecordingVideoSetup>
type Key = keyof RecordingVideoSetup
interface FieldSpec<K extends Key> { key: K; suffix: string; title: string; description: string; value: ApplicationPropertyDescriptor['value']; parse: z.ZodType<RecordingVideoSetup[K] | null>; read: (setup: RecordingVideoSetup) => RecordingVideoSetup[K] | null; nullable?: boolean }
function field<K extends Key>(spec: FieldSpec<K>): Field {
  const id = `${RECORDING_SETUP_ENTITY}.${spec.suffix}`
  return {
    propertyId: id, storeActions: [], read: setup => spec.read(setup) ?? null,
    writer: { write: (draft, mutation) => {
      const parsed = spec.parse.safeParse(mutation.value)
      if (!parsed.success) throw new Error(`${id} 取值无效：${spec.description}`)
      if (parsed.data === null) delete draft[spec.key]
      else draft[spec.key] = parsed.data as RecordingVideoSetup[K]
    } },
    descriptor: { id, entityType: RECORDING_SETUP_ENTITY, version: 1, title: spec.title, description: `${spec.description}。${PLACE}`, value: spec.value, nullable: spec.nullable ?? false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'],
      requiredPermissions: { read: ['settings:read'], write: ['settings:write'] }, revisionScopes: [SCOPE], schemaRef: schemaRef('property', id) },
  }
}
const output = (setup: RecordingVideoSetup) => recordingOutput({ ...setup, quality: setup.quality ?? '1080p', fps: setup.fps ?? 60 })
/** One declaration per field: descriptor, read and writer together. Reads give the values the next recording will use. */
export const recordingSetupFields: Field[] = [
  field({ key: 'quality', suffix: 'quality', title: '画质', description: '屏幕录制分辨率：1080p、1440p（2K）、2160p（4K）；没固定码率时码率随之取默认值', value: enums(['1080p', '1440p', '2160p']), parse: z.enum(['1080p', '1440p', '2160p']), read: setup => setup.quality ?? '1080p' }),
  field({ key: 'fps', suffix: 'fps', title: '帧率', description: '每秒帧数，只能是 30 或 60', value: { kind: 'integer', hardRange: { min: 30, max: 60, step: 30 } }, parse: z.union([z.literal(30), z.literal(60)]), read: setup => setup.fps ?? 60 }),
  field({ key: 'codec', suffix: 'codec', title: '视频编码', description: 'h264 兼容性最好；hevc（H.265）同画质文件更小，默认码率按 0.7 倍', value: enums(['h264', 'hevc']), parse: recordingEncodingFields.codec.unwrap(), read: setup => output(setup).codec }),
  field({ key: 'encoder', suffix: 'encoder', title: '编码器', description: 'auto 自动选显卡硬件编码；也可指定 nvidia、intel、amd、apple 或 software（软件编码）；本机没有所选硬件时录制自动回退', value: enums(['auto', 'nvidia', 'intel', 'amd', 'apple', 'software']), parse: recordingEncodingFields.encoder.unwrap(), read: setup => output(setup).encoder }),
  field({ key: 'rateControl', suffix: 'rate_control', title: '码率控制', description: 'quality 按画质恒定质量、vbr 可变码率、cbr 恒定码率', value: enums(['quality', 'vbr', 'cbr']), parse: recordingEncodingFields.rateControl.unwrap(), read: setup => output(setup).rateControl }),
  field({ key: 'bitrate', suffix: 'bitrate', title: '码率', description: '目标码率，单位 bps，1000000–100000000；没设过时按画质、帧率和编码给出默认值，写入后固定、不再随画质变化', value: { kind: 'integer', hardRange: { min: 1_000_000, max: 100_000_000 } }, parse: recordingEncodingFields.bitrate.unwrap(), read: setup => output(setup).bitrate }),
  field({ key: 'keyframeFrames', suffix: 'keyframe_frames', title: '关键帧间隔', description: '固定关键帧间隔帧数：10、15、30、60 或 120；null 为自动（最长 30 帧，画面突变时补关键帧）', value: { kind: 'integer', hardRange: { min: 10, max: 120 } }, parse: recordingEncodingFields.keyframeFrames.unwrap().nullable(), read: setup => setup.keyframeFrames ?? null, nullable: true }),
]

function assertRef(ref: ApplicationRef): void {
  if (ref.kind !== RECORDING_SETUP_ENTITY || ref.id !== target.id) throw new Error(`录屏视频设置只有一个本机实例：{ kind: '${RECORDING_SETUP_ENTITY}', id: 'singleton' }`)
}
export function recordingSetupRegistration(): ApplicationEntityRegistration {
  return {
    entity: { id: RECORDING_SETUP_ENTITY, domain: 'screen_recording', version: 1, title: '录屏视频设置', description: `录屏页的画质、帧率、编码与码率；人在录制页上改与助手经通用属性改的是同一份本机设置，只影响之后的录制。${PLACE}`,
      refKind: RECORDING_SETUP_ENTITY, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes: [], revisionScopes: [SCOPE], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', RECORDING_SETUP_ENTITY) },
    properties: fieldDescriptors(recordingSetupFields),
    provider: {
      entityType: RECORDING_SETUP_ENTITY,
      async listEntities() { return { refs: [target], nextCursor: null, revisions: { [SCOPE]: recordingVideoSetupRevision() } } },
      async readEntity(ref, request) {
        assertRef(ref)
        const setup = readRecordingVideoSetup()
        const all = fieldReadValues(recordingSetupFields, setup)
        return { ref: target, entityType: RECORDING_SETUP_ENTITY, revisions: { [SCOPE]: recordingVideoSetupRevision(setup) }, capturedAt: new Date().toISOString(),
          properties: request.propertyIds ? Object.fromEntries(Object.entries(all).filter(([id]) => request.propertyIds!.includes(id))) : all }
      },
      async getPropertyAvailability(ref, ids) {
        assertRef(ref)
        const revision = recordingVideoSetupRevision()
        return ids.map(propertyId => {
          if (!recordingSetupFields.some(item => item.propertyId === propertyId)) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}；可用属性：${recordingSetupFields.map(item => item.propertyId).join('、')}`)
          return { propertyId, readable: true, writable: true, reasons: [], requiredPermissions: ['settings:read', 'settings:write'], revisions: { [SCOPE]: revision } }
        })
      },
      async getCollectionAvailability(parent) { return unrestrictedCollectionAvailability(RECORDING_SETUP_ENTITY, parent, { [SCOPE]: recordingVideoSetupRevision() }, ['settings:write']) },
    },
  }
}

type Step = Extract<ApplicationPlannedStep, { kind: 'mutation' }>
/** Generic property writes on the recording video settings; undo restores what was there, unless the page changed it since. */
export class RecordingSetupMutation implements ApplicationMutationExecutor {
  readonly entityType = RECORDING_SETUP_ENTITY
  readonly effectContract = { direct: [], cascades: [] }
  private readonly table = fieldWriterTable(recordingSetupFields)
  readonly writableProperties = writableProperties(this.table)
  readonly propertyOperations = propertyOperations(this.table)
  private readonly undos = new Map<string, { before: RecordingVideoSetup; after: RecordingVideoSetup }>()
  private completed(setup: RecordingVideoSetup, undoToken?: string): ApplicationCompletedStepResult {
    return { status: 'completed', directRefs: [target], resultingRevisions: { [SCOPE]: recordingVideoSetupRevision(setup) }, ...(undoToken ? { undoToken } : {}),
      evidence: [{ kind: 'entity_state', target, fact: '录屏视频设置已保存并读回，之后的录制生效。', capturedAt: new Date().toISOString() }] }
  }
  async apply(step: Step): Promise<ApplicationCompletedStepResult> {
    assertRef(step.target)
    const before = readRecordingVideoSetup()
    const draft = { ...before }
    await applyWriterTable(this.table, draft, step.mutations)
    const after = writeRecordingVideoSetup(draft)
    const token = crypto.randomUUID()
    this.undos.set(token, { before, after })
    while (this.undos.size > 128) this.undos.delete(this.undos.keys().next().value!)
    return this.completed(after, token)
  }
  async undo(token: string): Promise<ApplicationCompletedStepResult> {
    const undo = this.undos.get(token)
    if (!undo) throw new Error('录屏视频设置的撤销记录已失效')
    if (recordingVideoSetupRevision() !== recordingVideoSetupRevision(undo.after)) throw new Error('录屏视频设置已在录制页上改过，请读取当前设置后再调整')
    const restored = writeRecordingVideoSetup(undo.before)
    this.undos.delete(token)
    return this.completed(restored)
  }
  async compensate(_step: Step, result: ApplicationCompletedStepResult): Promise<[]> { if (result.undoToken) await this.undo(result.undoToken); return [] }
  forget(token: string): void { this.undos.delete(token) }
}
