import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/application-control/applicationCapabilities'
import {
  fieldDescriptors,
  fieldReadValues,
  unrestrictedCollectionAvailability,
  type ApplicationCollectionExecutor,
  type ApplicationCompletedStepResult,
  type ApplicationEntityRegistration,
  type ApplicationFieldDefinition,
  type ApplicationPlannedStep,
  type ApplicationPropertyDescriptor,
  type ApplicationRef,
} from '@/core/application-control'
import { soundBrightnessLabel } from '@/core/soundLibrary/soundFeatures'
import { getSoundLibraryState, listSoundLibrarySounds, locateSoundLibrarySound, removeSoundLibraryFolder } from '@/commands/soundLibrary'
import type { SoundLibraryFolderInfo, SoundLibrarySoundSummary, SoundLibraryState } from '@/platform/contracts/soundLibrary'

/*
 * 音效库的助手覆盖：音效库（单例）→ 登记的文件夹 → 整理出的音效，三级只读实体；
 * 文件夹可按通用集合删除（只取消登记，不删文件）。登记新文件夹走 add_sound_library_folder（可直接给路径，省略时弹选择框）；
 * 检索与卡点是算法操作，走 search_sound_effects 与 place_video_edit_sound_effects。
 * 真相源是主进程 SoundLibraryService，经 `src/commands/soundLibrary.ts` 访问；设置页与助手共用。
 */

export const SOUND_LIBRARY_ENTITY = 'sound_library.library'
export const SOUND_LIBRARY_FOLDER_ENTITY = 'sound_library.folder'
export const SOUND_LIBRARY_SOUND_ENTITY = 'sound_library.sound'
const DOMAIN = 'sound_library'
const LIBRARY_REF: ApplicationRef = { kind: SOUND_LIBRARY_ENTITY, id: 'singleton', label: '音效库' }
const READ = { read: ['video_edit:read'], write: [] as string[] }
const FOLDER_PERMISSIONS = { read: ['video_edit:read'], write: ['settings:write'] }
const revisions = (revision: number) => ({ [DOMAIN]: revision })

function schemaRef(kind: 'entity' | 'property', id: string) {
  const value = [...`${kind}:${id}`].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind, id, version: 1, digest: `sha256:${value.padEnd(64, value).slice(0, 64)}` } as const
}

function field<T>(entityType: string, suffix: string, title: string, description: string, value: ApplicationPropertyDescriptor['value'], read: (source: T) => ReturnType<ApplicationFieldDefinition<T, never>['read']>, readOnlyReason: string, extra: Partial<ApplicationPropertyDescriptor> = {}): ApplicationFieldDefinition<T, never> {
  const id = `${entityType}.${suffix}`
  return {
    propertyId: id, read, storeActions: [],
    descriptor: { id, entityType, version: 1, title, description, value, nullable: false, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], requiredPermissions: READ, revisionScopes: [DOMAIN], schemaRef: schemaRef('property', id), readOnlyReason, ...extra },
  }
}

const LIBRARY_READ_ONLY = '由登记的音效文件夹与后台整理维护；登记用 add_sound_library_folder，取消登记删除 sound_library.folder。'
const FOLDER_READ_ONLY = '由后台整理按文件夹里的实际文件给出；文件变化后下一次检索会自动增量整理。'
const SOUND_READ_ONLY = '音效来自登记文件夹里的文件，测量值由整理自动算出，不能手改；用 search_sound_effects 挑选、place_video_edit_sound_effects 放进剪辑。'
const STATUS_VALUES = [{ value: 'not_indexed', label: '尚未整理' }, { value: 'indexing', label: '正在整理' }, { value: 'ready', label: '已整理' }, { value: 'failed', label: '整理失败' }]

const libraryFields = [
  field<SoundLibraryState>(SOUND_LIBRARY_ENTITY, 'folder_count', '文件夹数', '登记的音效文件夹数量。', { kind: 'integer', hardRange: { min: 0 } }, state => state.folders.length, LIBRARY_READ_ONLY),
  field<SoundLibraryState>(SOUND_LIBRARY_ENTITY, 'sound_count', '音效数', '已整理、可检索的音效总数。', { kind: 'integer', hardRange: { min: 0 } }, state => state.folders.reduce((sum, folder) => sum + folder.soundCount, 0), LIBRARY_READ_ONLY),
  field<SoundLibraryState>(SOUND_LIBRARY_ENTITY, 'listening_ready', '听音可用', '听音模型 audio_understanding_clap 是否已下载；为 false 时检索只按名字，可写 local_model.item downloaded=true 下载。', { kind: 'boolean' }, state => state.listeningModelReady, LIBRARY_READ_ONLY, { verificationStrategy: 'execution' }),
]

const folderFields = [
  field<SoundLibraryFolderInfo>(SOUND_LIBRARY_FOLDER_ENTITY, 'name', '文件夹名', '登记文件夹的名字（不含上级路径）。', { kind: 'string', maxLength: 260 }, folder => folder.name, FOLDER_READ_ONLY),
  field<SoundLibraryFolderInfo>(SOUND_LIBRARY_FOLDER_ENTITY, 'path', '路径', '登记文件夹的本机绝对路径。', { kind: 'string', maxLength: 4096 }, folder => folder.path, FOLDER_READ_ONLY),
  field<SoundLibraryFolderInfo>(SOUND_LIBRARY_FOLDER_ENTITY, 'status', '整理状态', '尚未整理 / 正在整理 / 已整理 / 整理失败（原因见 last_error）。检索会自动整理，不必提前等待。', { kind: 'enum', values: STATUS_VALUES }, folder => folder.status, FOLDER_READ_ONLY, { verificationStrategy: 'execution' }),
  field<SoundLibraryFolderInfo>(SOUND_LIBRARY_FOLDER_ENTITY, 'sound_count', '音效数', '可检索的音效数量。', { kind: 'integer', hardRange: { min: 0 } }, folder => folder.soundCount, FOLDER_READ_ONLY, { verificationStrategy: 'execution' }),
  field<SoundLibraryFolderInfo>(SOUND_LIBRARY_FOLDER_ENTITY, 'listening_count', '已听音数', '已算出听音向量的音效数量；听音模型下载后下一次检索自动补齐。', { kind: 'integer', hardRange: { min: 0 } }, folder => folder.listeningCount, FOLDER_READ_ONLY, { verificationStrategy: 'execution' }),
  field<SoundLibraryFolderInfo>(SOUND_LIBRARY_FOLDER_ENTITY, 'skipped_files', '跳过的文件', '因损坏或无法解码而跳过的文件（相对路径与原因）；没有为空字符串。', { kind: 'string', maxLength: 2000 }, folder => folder.skipped.map(file => `${file.relativePath}（${file.reason}）`).join('；').slice(0, 2000), FOLDER_READ_ONLY, { verificationStrategy: 'execution' }),
  field<SoundLibraryFolderInfo>(SOUND_LIBRARY_FOLDER_ENTITY, 'last_error', '整理失败原因', '最近一次整理失败的原因；成功后为空字符串。', { kind: 'string', maxLength: 500 }, folder => folder.lastError ?? '', FOLDER_READ_ONLY, { verificationStrategy: 'execution' }),
]

const soundFields = [
  field<SoundLibrarySoundSummary>(SOUND_LIBRARY_SOUND_ENTITY, 'name', '文件名', '去掉扩展名的原文件名。', { kind: 'string', maxLength: 260 }, sound => sound.label, SOUND_READ_ONLY),
  field<SoundLibrarySoundSummary>(SOUND_LIBRARY_SOUND_ENTITY, 'english_name', '英文名', '文件名里的英文部分（通常比机翻中文可靠）；没有为空字符串。', { kind: 'string', maxLength: 260 }, sound => sound.english ?? '', SOUND_READ_ONLY),
  field<SoundLibrarySoundSummary>(SOUND_LIBRARY_SOUND_ENTITY, 'chinese_name', '中文名', '文件名里的中文部分（常是机翻，可能不准）；没有为空字符串。', { kind: 'string', maxLength: 260 }, sound => sound.chinese ?? '', SOUND_READ_ONLY),
  field<SoundLibrarySoundSummary>(SOUND_LIBRARY_SOUND_ENTITY, 'relative_path', '位置', '在登记文件夹里的相对位置。', { kind: 'string', maxLength: 1000 }, sound => sound.relativePath, SOUND_READ_ONLY),
  field<SoundLibrarySoundSummary & { path?: string }>(SOUND_LIBRARY_SOUND_ENTITY, 'path', '文件路径', '音效文件的本机绝对路径。', { kind: 'string', maxLength: 4096 }, sound => sound.path ?? '', SOUND_READ_ONLY),
  field<SoundLibrarySoundSummary>(SOUND_LIBRARY_SOUND_ENTITY, 'folder', '所属文件夹', '所在的登记文件夹。', { kind: 'ref', refKinds: [SOUND_LIBRARY_FOLDER_ENTITY] }, sound => ({ kind: SOUND_LIBRARY_FOLDER_ENTITY, id: sound.folderId }), SOUND_READ_ONLY),
  field<SoundLibrarySoundSummary>(SOUND_LIBRARY_SOUND_ENTITY, 'duration_seconds', '时长', '声音总时长。', { kind: 'number', hardRange: { min: 0 } }, sound => sound.features.durationSeconds, SOUND_READ_ONLY, { unit: '秒' }),
  field<SoundLibrarySoundSummary>(SOUND_LIBRARY_SOUND_ENTITY, 'attack_seconds', '起音点', '声音第一次进入峰值 -20 dB 以内的时刻（从文件开头算）。', { kind: 'number', hardRange: { min: 0 } }, sound => sound.features.attackSeconds, SOUND_READ_ONLY, { unit: '秒' }),
  field<SoundLibrarySoundSummary>(SOUND_LIBRARY_SOUND_ENTITY, 'hit_seconds', '击中点', '声音最响的时刻（从文件开头算）；卡点时把它对齐到切点或节拍。', { kind: 'number', hardRange: { min: 0 } }, sound => sound.features.hitSeconds, SOUND_READ_ONLY, { unit: '秒' }),
  field<SoundLibrarySoundSummary>(SOUND_LIBRARY_SOUND_ENTITY, 'loudness_lufs', '响度', '最大瞬时响度（BS.1770，400 毫秒窗）；静音为 null。', { kind: 'number' }, sound => sound.features.loudnessLufs, SOUND_READ_ONLY, { unit: 'LUFS', nullable: true }),
  field<SoundLibrarySoundSummary>(SOUND_LIBRARY_SOUND_ENTITY, 'brightness', '明暗', 'dark 低沉、neutral 适中、bright 清脆明亮（按频谱重心）；静音为 null。', { kind: 'enum', values: [{ value: 'dark', label: '低沉' }, { value: 'neutral', label: '适中' }, { value: 'bright', label: '清脆明亮' }] }, sound => soundBrightnessLabel(sound.features.brightnessHz), SOUND_READ_ONLY, { nullable: true }),
  field<SoundLibrarySoundSummary>(SOUND_LIBRARY_SOUND_ENTITY, 'listening', '已听音', '是否已有听音向量（参与按描述检索）。', { kind: 'boolean' }, sound => sound.hasListening, SOUND_READ_ONLY, { verificationStrategy: 'execution' }),
]

function filter(values: ReturnType<typeof fieldReadValues>, propertyIds?: string[]) {
  return propertyIds ? Object.fromEntries(Object.entries(values).filter(([id]) => propertyIds.includes(id))) : values
}
function folderRef(folder: SoundLibraryFolderInfo): ApplicationRef { return { kind: SOUND_LIBRARY_FOLDER_ENTITY, id: folder.id, label: folder.name } }
function soundRef(sound: SoundLibrarySoundSummary): ApplicationRef { return { kind: SOUND_LIBRARY_SOUND_ENTITY, id: sound.id, label: sound.label } }
function findFolder(state: SoundLibraryState, ref: ApplicationRef): SoundLibraryFolderInfo {
  const folder = ref.kind === SOUND_LIBRARY_FOLDER_ENTITY ? state.folders.find(value => value.id === ref.id) : undefined
  if (!folder) throw new Error(`NOT_FOUND:没有这个音效文件夹，已登记的有 ${state.folders.map(value => `${value.id}（${value.name}）`).join('、') || '（无，用 add_sound_library_folder 登记）'}`)
  return folder
}
function readOnly(fields: ReadonlyArray<ApplicationFieldDefinition<never, never>>, propertyIds: string[], revision: number, reason: string) {
  return propertyIds.map(propertyId => {
    if (!fields.some(value => value.propertyId === propertyId)) throw new Error(`PROPERTY_NOT_FOUND:${propertyId}，可用的有 ${fields.map(value => value.propertyId).join('、')}`)
    return { propertyId, readable: true, writable: false, reasons: [reason], requiredPermissions: [], revisions: revisions(revision) }
  })
}

export function createSoundLibraryRegistrations(): ApplicationEntityRegistration[] {
  const descriptor = (id: string, title: string, description: string, parentTypes: string[], extra: Partial<ApplicationEntityRegistration['entity']> = {}): ApplicationEntityRegistration['entity'] => ({
    id, domain: DOMAIN, version: 1, title, description, refKind: id, dataClass: 'C1', exposures: ['ui', 'assistant', 'local_adapter'], parentTypes,
    revisionScopes: [DOMAIN], queryCapabilityIds: ['read_application_entity'], schemaRef: schemaRef('entity', id), ...extra,
  })
  return [
    {
      entity: descriptor(SOUND_LIBRARY_ENTITY, '音效库', '用户登记的音效文件夹汇总（单例 singleton）。登记文件夹用 add_sound_library_folder（用户给了路径就传 path，否则弹出选择框）；按意图找音效用 search_sound_effects；卡点放进剪辑用 place_video_edit_sound_effects。', [], { writeExclusion: { reason: LIBRARY_READ_ONLY } }),
      properties: fieldDescriptors(libraryFields),
      provider: {
        entityType: SOUND_LIBRARY_ENTITY,
        async listEntities() { const state = await getSoundLibraryState(); return { refs: [LIBRARY_REF], nextCursor: null, revisions: revisions(state.revision) } },
        async readEntity(ref, request) {
          if (ref.kind !== SOUND_LIBRARY_ENTITY || ref.id !== LIBRARY_REF.id) throw new Error('NOT_FOUND:音效库只有一个实例 singleton')
          const state = await getSoundLibraryState()
          return { ref: LIBRARY_REF, entityType: SOUND_LIBRARY_ENTITY, revisions: revisions(state.revision), properties: filter(fieldReadValues(libraryFields, state), request.propertyIds), capturedAt: new Date().toISOString() }
        },
        async getPropertyAvailability(_ref, propertyIds) { return readOnly(libraryFields as never, propertyIds, (await getSoundLibraryState()).revision, LIBRARY_READ_ONLY) },
        async getCollectionAvailability(request) { return unrestrictedCollectionAvailability(SOUND_LIBRARY_ENTITY, request, revisions((await getSoundLibraryState()).revision), FOLDER_PERMISSIONS.write) },
      },
    },
    {
      entity: descriptor(SOUND_LIBRARY_FOLDER_ENTITY, '音效文件夹', '一个登记的音效文件夹及其整理状态。删除只取消登记，不删除任何文件；新登记用 add_sound_library_folder。', [SOUND_LIBRARY_ENTITY], { collectionWrite: { creatable: false, removable: true, requiredPropertyIds: [], maxItemsPerChange: 8 } }),
      properties: fieldDescriptors(folderFields),
      provider: {
        entityType: SOUND_LIBRARY_FOLDER_ENTITY,
        async listEntities(request) {
          const state = await getSoundLibraryState()
          const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
          const page = state.folders.slice(offset, offset + request.limit)
          return { refs: page.map(folderRef), nextCursor: offset + page.length < state.folders.length ? String(offset + page.length) : null, revisions: revisions(state.revision) }
        },
        async readEntity(ref, request) {
          const state = await getSoundLibraryState()
          const folder = findFolder(state, ref)
          return { ref: folderRef(folder), entityType: SOUND_LIBRARY_FOLDER_ENTITY, revisions: revisions(state.revision), properties: filter(fieldReadValues(folderFields, folder), request.propertyIds), capturedAt: new Date().toISOString() }
        },
        async getPropertyAvailability(ref, propertyIds) { const state = await getSoundLibraryState(); findFolder(state, ref); return readOnly(folderFields as never, propertyIds, state.revision, FOLDER_READ_ONLY) },
        async getCollectionAvailability(request) {
          const available = unrestrictedCollectionAvailability(SOUND_LIBRARY_FOLDER_ENTITY, request, revisions((await getSoundLibraryState()).revision), FOLDER_PERMISSIONS.write)
          available.create = { ...available.create, available: false, reasons: ['登记新文件夹请用 add_sound_library_folder（可直接给路径）。'] }
          if (request.kind !== SOUND_LIBRARY_ENTITY) available.remove = { ...available.remove, available: false, reasons: ['音效文件夹挂在音效库 sound_library.library/singleton 下。'] }
          return available
        },
      },
    },
    {
      entity: descriptor(SOUND_LIBRARY_SOUND_ENTITY, '音效', '登记文件夹里整理出的一个音效：名字、时长、起音点、击中点、响度、明暗。按意图挑选请用 search_sound_effects（比逐条列出快得多）。', [SOUND_LIBRARY_FOLDER_ENTITY], { writeExclusion: { reason: SOUND_READ_ONLY } }),
      properties: fieldDescriptors(soundFields),
      provider: {
        entityType: SOUND_LIBRARY_SOUND_ENTITY,
        async listEntities(request) {
          const offset = Math.max(0, Number.parseInt(request.cursor ?? '0', 10) || 0)
          const page = await listSoundLibrarySounds(offset, Math.min(200, request.limit))
          return { refs: page.sounds.map(soundRef), nextCursor: offset + page.sounds.length < page.total ? String(offset + page.sounds.length) : null, revisions: revisions(page.revision) }
        },
        async readEntity(ref, request) {
          if (ref.kind !== SOUND_LIBRARY_SOUND_ENTITY) throw new Error('NOT_FOUND:请使用 search_sound_effects 或列表返回的音效引用')
          const sound = await locateSoundLibrarySound(ref.id).catch(() => { throw new Error('NOT_FOUND:这个音效已不在登记的文件夹里，请重新检索') })
          const state = await getSoundLibraryState()
          return { ref: soundRef(sound), entityType: SOUND_LIBRARY_SOUND_ENTITY, revisions: revisions(state.revision), properties: filter(fieldReadValues(soundFields, sound), request.propertyIds), capturedAt: new Date().toISOString() }
        },
        async getPropertyAvailability(_ref, propertyIds) { return readOnly(soundFields as never, propertyIds, (await getSoundLibraryState()).revision, SOUND_READ_ONLY) },
        async getCollectionAvailability(request) {
          const available = unrestrictedCollectionAvailability(SOUND_LIBRARY_SOUND_ENTITY, request, revisions((await getSoundLibraryState()).revision), [])
          available.create = { ...available.create, available: false, reasons: [SOUND_READ_ONLY] }
          available.remove = { ...available.remove, available: false, reasons: [SOUND_READ_ONLY] }
          return available
        },
      },
    },
  ]
}

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>

/** 取消登记文件夹：只改登记表，不删除文件；重新登记用 add_sound_library_folder，所以不提供撤销。 */
export class SoundLibraryFolderCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = SOUND_LIBRARY_FOLDER_ENTITY
  readonly effectContract = { direct: [], cascades: [] }
  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    if (step.parent.kind !== SOUND_LIBRARY_ENTITY || step.operation.kind !== 'remove') throw new Error('INVALID_INPUT:音效文件夹只能删除（取消登记）；登记新文件夹请用 add_sound_library_folder')
    const before = await getSoundLibraryState()
    const targets = step.operation.targets.map(target => findFolder(before, target))
    for (const folder of targets) await removeSoundLibraryFolder(folder.id)
    const after = await getSoundLibraryState()
    const refs = targets.map(folderRef)
    return { status: 'completed', directRefs: refs, resultingRevisions: revisions(after.revision),
      evidence: refs.map(target => ({ kind: 'operation_result' as const, target, fact: after.folders.some(folder => folder.id === target.id) ? '文件夹仍在登记表里。' : '已取消登记，文件夹里的文件未改动。', capturedAt: new Date().toISOString() })) }
  }
}
