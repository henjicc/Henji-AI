// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ApplicationOperationCoordinator } from '../../../electron/main/services/application-runtime/operationCoordinator'
import { ApplicationOperationStore, type OperationRecord } from '../../../electron/main/services/application-runtime/operationStore'
import { ApplicationHostBridge } from '../../../electron/main/services/application-runtime/applicationHostBridge'
import { ApplicationToolDispatcher } from '../../../electron/main/services/application-runtime/applicationToolDispatcher'
import type { ApplicationHostPlatform, LocalHostRequest } from '@/core/application-control/localHostContracts'
import { applicationInvocationId } from '@/core/application-control/operationIdentity'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage, harnessDocumentStore } from '@/tests/harnessNativeStorage'
import { videoEditContentSchema } from '@/core/documents/kinds/videoEdit'
import { createVideoEditTestProject, closeAllVideoEdits, failVideoEditSaves, savedVideoEdit, reopenVideoEdit } from '@/features/videoEdit/application/videoEditDocumentTestKit'
import { attachLocalApplicationHost } from './localApplicationHost'
import { getPlatform } from '@/platform/runtime'
import { titleGraphic } from '@/core/videoEdit/titleGraphics'
import { editVideoProject, requireVideoEditInstance } from '@/features/videoEdit/application/videoEditService'
import { videoEditStyleLibrary } from '@/features/videoEdit/application/videoEditStyleLibrary'
import { addTestTitleTemplate, createTestStyleLibraryIo } from '@/features/videoEdit/application/videoEditStyleTestKit'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'

// 只替换持久账本、IPC/媒体解码边界；公共 dispatcher、宿主、能力、文档 schema 与验证走正式实现。
class MemoryOperations extends ApplicationOperationStore {
  records = new Map<string, OperationRecord>()
  constructor() { super(undefined as never) }
  override recoverInterrupted(): void {}
  override get(id: string, caller: string): OperationRecord | undefined { return this.records.get(`${caller}:${id}`) }
  override save(record: OperationRecord): void { this.records.set(`${record.callerId}:${record.operationId}`, structuredClone(record)) }
  override prepare(record: OperationRecord): OperationRecord { this.save(record); return record }
  override claim(record: OperationRecord, requestId: string, rendererEpoch: string): void { this.save({ ...record, requestId, rendererEpoch, state: 'executing' }) }
  override beginPreparation(record: OperationRecord): boolean { this.save({ ...record, state: 'preparing' }); return true }
  override byRequest(requestId: string, epoch: string): OperationRecord | undefined { return [...this.records.values()].find(record => record.requestId === requestId && record.rendererEpoch === epoch) }
  override unresolved(): OperationRecord[] { return [...this.records.values()].filter(record => ['preparing', 'executing', 'unknown', 'partial'].includes(record.state)) }
}
vi.mock('mediabunny', () => ({ ALL_FORMATS: [], UrlSource: class {}, Input: class {
  async getPrimaryVideoTrack() { return null } async getPrimaryAudioTrack() { return null } async computeDuration() { return 0 } dispose() {}
} }))
const identity = { sizeBytes: 4096, fileModifiedAt: 1000, contentIdentity: 'c'.repeat(64) }
let asset: AssetRecord
const assets = new Map<string, AssetRecord>()
beforeEach(() => {
  installHarnessNativeStorage()
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { font: '', measureText(text: string) { return { width: text.length * 20, actualBoundingBoxLeft: 0, actualBoundingBoxRight: text.length * 20 } } } } })
  asset = { id: 'asset-original', filePath: 'D:/generated/frame.png', mediaType: 'image', displayName: '原素材', displayUrl: '', source: 'imported', mimeType: 'image/png', ...identity, width: 1920, height: 1080, durationSeconds: 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
  assets.clear(); assets.set(asset.id, asset)
  vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockImplementation(async id => structuredClone(assets.get(id)!))
  vi.spyOn(getPlatform().assetLibrary, 'inspectFileContent').mockResolvedValue(identity)
  vi.spyOn(getPlatform().assetLibrary, 'createAsset').mockImplementation(async input => {
    const existing = [...assets.values()].find(value => value.filePath === input.filePath)
    if (existing) return existing
    const copied = { ...asset, id: 'asset-copy', filePath: input.filePath }; assets.set(copied.id, copied); return copied
  })
  vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/generated')
  vi.spyOn(getPlatform().system.fs, 'exists').mockResolvedValue(true)
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

function runtime() {
  const store = new MemoryOperations()
  const coordinator: ApplicationOperationCoordinator = new ApplicationOperationCoordinator(store, undefined, () => bridge.writableEntityTypes())
  const bridge: ApplicationHostBridge = new ApplicationHostBridge(() => undefined, coordinator)
  let request: (value: LocalHostRequest) => void = () => undefined
  const platform: ApplicationHostPlatform = {
    contentTrust: async () => { throw new Error('此用例不调用代码信任存储') }, onContentTrust: () => () => {},
    registerHost: async registration => { bridge.register(registration, { send: (_channel, payload) => request(payload as LocalHostRequest) }) },
    complete: async reply => { bridge.complete(reply) },
    publishContext: async snapshot => { bridge.publishContext(snapshot) },
    onRequest: callback => { request = callback; return () => undefined },
    reviewOperations: async () => ({ items: [] }), onReviews: () => () => {}, onCancel: () => () => undefined, onRevoke: () => () => undefined,
  }
  const dispose = attachLocalApplicationHost(platform, true)
  const access = { allowWrites: true, allowDestructive: true, allowPaid: false }
  const dispatcher = new ApplicationToolDispatcher({ assertActive: () => undefined, access: () => access }, bridge, coordinator)
  const caller = crypto.randomUUID()
  const call = (name: string, input: Record<string, unknown>) => dispatcher.call(caller, name, input, new AbortController().signal)
  return { store, coordinator, caller, call, dispose }
}

it('t95 D1/D3：公共标题回执进入 verified 终态；无原视频拒绝不留锁，后续写入成功', async () => {
  const owner = await createVideoEditTestProject(); const documentRef = { kind: 'video_edit.document', id: owner.document.id }
  const sequenceRef = { kind: 'video_edit.sequence', id: `${owner.document.id}:${owner.activeSequenceId}` }
  const host = runtime()
  try {
    const deniedId = crypto.randomUUID()
    const denied = await host.call('auto_reframe_video_edit', { operationId: deniedId, documentRef, sequenceRef })
    expect(denied, JSON.stringify(denied)).toMatchObject({ ok: false, executionState: 'not_executed', verificationState: 'verified' })
    expect(JSON.stringify(denied)).toContain('原视频')
    expect(host.store.unresolved()).toEqual([])
    const textDenied = await host.call('detect_video_edit_text_silence', { operationId: crypto.randomUUID(), documentRef, sequenceRef })
    expect(textDenied).toMatchObject({ ok: false, executionState: 'not_executed', verificationState: 'verified' })
    expect(JSON.stringify(textDenied)).toContain('转录')
    const smartDenied = await host.call('retry_video_edit_smart_region', { operationId: crypto.randomUUID(), documentRef, effectRef: { kind: 'video_edit.effect', id: `${owner.document.id}:missing-effect` } })
    expect(smartDenied).toMatchObject({ ok: false, executionState: 'not_executed', verificationState: 'verified' })
    expect(host.store.unresolved()).toEqual([])
    const titleId = crypto.randomUUID()
    const sequence = owner.document.sequences[0]
    const graphic = titleGraphic('chapter', { text: '第一章' }, sequence.width, sequence.height, 119 / 30)
    editVideoProject(owner.document.id, document => ({ ...document, templates: [{ id: 'chapter-template', name: '章节标题', description: '', version: 1, contentHash: '', updatedAt: new Date(0).toISOString(), style: null, origin: null, body: { kind: 'native', content: { width: sequence.width, height: sequence.height, fps: 30, clips: [{ name: '章节标题', kind: 'graphic', graphic, track: 0, start: 0, duration: 120, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '' }] } } }] }))
    const title = await host.call('apply_video_edit_template', { operationId: titleId, documentRef, sequenceRef, frame: 12, templateRef: { kind: 'video_edit.project_template', id: `${owner.document.id}:chapter-template` }, texts: ['第二章'] })
    expect(title, JSON.stringify(title)).toMatchObject({ ok: true, executionState: 'completed', verificationState: 'verified', result: { data: { verification: { verified: true } } } })
    expect(JSON.stringify(savedVideoEdit(owner).sequences[0].clips[0].graphic)).toContain('第二章')
    expect(savedVideoEdit(owner).sequences[0].clips).toHaveLength(1)
    expect(host.store.unresolved()).toEqual([])
  } finally { host.dispose() }
})

it('t95 D4：保存失败后只重试原操作保存，核对 item/clip/文件，推进原操作终态并解除锁', async () => {
  const owner = await createVideoEditTestProject(); const documentRef = { kind: 'video_edit.document', id: owner.document.id }
  const sequenceRef = { kind: 'video_edit.sequence', id: `${owner.document.id}:${owner.activeSequenceId}` }
  const host = runtime(); const operationId = crypto.randomUUID()
  const documents = harnessDocumentStore(); const save = documents.saveDocument.bind(documents)
  vi.spyOn(documents, 'saveDocument').mockImplementation(input => save({ ...input, content: videoEditContentSchema.parse(input.content) }))
  try {
    failVideoEditSaves(true)
    const placed = await host.call('place_video_edit_creative_result', { operationId, documentRef, sequenceRef, placement: { mode: 'add', frame: 0, durationFrames: 20, newTrack: 'video' }, result: { type: 'asset', assetRef: { kind: 'asset', id: asset.id } } })
    expect(placed, JSON.stringify(placed)).toMatchObject({ ok: false, executionState: 'partial' })
    expect(JSON.stringify(placed)).toContain('retry_application_operation_save')
    const blocked = await host.call('save_video_edit', { operationId: crypto.randomUUID(), documentRef })
    expect(JSON.stringify(blocked)).toContain('RECOVERY_REQUIRED')
    failVideoEditSaves(false)
    vi.mocked(getPlatform().assetLibrary.inspectFileContent).mockResolvedValueOnce({ ...identity, contentIdentity: 'd'.repeat(64) })
    const mismatched = await host.call('retry_application_operation_save', { operationId: crypto.randomUUID(), originalOperationId: operationId })
    expect(mismatched).toMatchObject({ ok: false, verificationState: 'unresolved' })
    expect(host.store.get(operationId, host.caller)).toMatchObject({ state: 'partial' })
    await reopenVideoEdit(owner.document.id)
    const recovered = await host.call('retry_application_operation_save', { operationId: crypto.randomUUID(), originalOperationId: operationId })
    expect(recovered, JSON.stringify(recovered)).toMatchObject({ ok: true, executionState: 'completed', verificationState: 'verified' })
    expect(host.store.get(operationId, host.caller)).toMatchObject({ state: 'completed', verificationState: 'verified' })
    expect(host.store.unresolved()).toEqual([])
    expect(savedVideoEdit(owner).creativePlacements).toMatchObject([{ operationId: applicationInvocationId(host.caller, operationId), assetId: 'asset-copy' }])
    const reopened = await reopenVideoEdit(owner.document.id)
    expect(reopened.document.sequences[0].clips).toHaveLength(1)
    expect(reopened.document.items).toHaveLength(1)
    expect(await host.call('save_video_edit', { operationId: crypto.randomUUID(), documentRef })).toMatchObject({ ok: true })
  } finally { failVideoEditSaves(false); host.dispose() }
})

it('风格与模板能力：写入前的拒绝记为未执行、不留锁；风格库没读过时也认风格库风格的 id', async () => {
  const owner = await createVideoEditTestProject(); const projectId = owner.document.id; const documentRef = { kind: 'video_edit.document', id: projectId }
  const sequenceRef = { kind: 'video_edit.sequence', id: `${projectId}:${owner.activeSequenceId}` }
  const io = createTestStyleLibraryIo({ builtin: false }); videoEditStyleLibrary.reset(io, undefined)
  const host = runtime()
  const call = (name: string, input: Record<string, unknown>) => host.call(name, { operationId: crypto.randomUUID(), ...input })
  const expectNotExecuted = async (name: string, input: Record<string, unknown>, reason: string): Promise<void> => {
    const before = requireVideoEditInstance(projectId).document
    const result = await call(name, input)
    expect(result, `${name} ${JSON.stringify(result)}`).toMatchObject({ ok: false, executionState: 'not_executed' })
    expect(JSON.stringify(result), JSON.stringify(result)).toContain(reason)
    expect(host.store.unresolved(), name).toEqual([])
    expect(requireVideoEditInstance(projectId).document, name).toBe(before)
  }
  try {
    const created = await call('change_application_entities', { summary: '新建风格', changes: [{ kind: 'create_items', entityType: 'video_edit.style', parent: { kind: 'video_edit.style_library', id: 'singleton' }, items: [{ properties: { 'video_edit.style.name': '节点光迹' } }, { properties: { 'video_edit.style.name': '克制' } }] }] })
    expect(created, JSON.stringify(created)).toMatchObject({ ok: true })
    const [styleId, otherId] = videoEditStyleLibrary.listStyles().map(entry => entry.style.id)
    const first = await addTestTitleTemplate(projectId, owner.activeSequenceId)
    const templateRef = { kind: 'video_edit.project_template', id: `${projectId}:${requireVideoEditInstance(projectId).document.templates![0].id}` }
    const clip = (id: string) => ({ kind: 'video_edit.clip', id: `${projectId}:${id}` })
    const audio = requireVideoEditInstance(projectId).document.sequences[0].tracks.find(track => track.kind === 'audio')!
    // 每一条都在写入之前就被拒绝：结果是“未执行”，账本里不留待核对的操作，剪辑一点没变。
    await expectNotExecuted('create_video_edit_template', { documentRef, sequenceRef, clipRefs: [clip(first)], name: '重复登记' }, '已经是模板')
    await expectNotExecuted('apply_video_edit_template', { documentRef, sequenceRef, frame: 0, templateRef, trackRef: { kind: 'video_edit.track', id: `${projectId}:${audio.id}` } }, '视频轨')
    await expectNotExecuted('update_video_edit_template', { templateRef, content: { kind: 'library', confirmed: true } }, '没有可升级的来源')
    await expectNotExecuted('export_video_edit_style_package', { styleRef: { kind: 'video_edit.style', id: styleId }, path: 'D:/风格.txt' }, '.hjsty')
    expect((await call('bind_video_edit_style', { documentRef, sequenceRef, styleRef: { kind: 'video_edit.style', id: styleId } })).ok).toBe(true)
    await expectNotExecuted('bind_video_edit_style', { documentRef, sequenceRef, styleRef: { kind: 'video_edit.style', id: otherId } }, 'replace:true')
    expect((await call('detach_video_edit_template_instance', { documentRef, sequenceRef, clipRefs: [clip(first)] })).ok).toBe(true)
    await expectNotExecuted('detach_video_edit_template_instance', { documentRef, sequenceRef, clipRefs: [clip(first)] }, '不属于任何模板')
    await expectNotExecuted('update_video_edit_template', { templateRef, content: { kind: 'clips', sequenceRef, clipRefs: [clip(first)] } }, '实例片段')
    // 风格库读不出来时，设为全局在写入前失败。
    videoEditStyleLibrary.reset({ ...io, root: async () => { throw new Error('风格库目录不可读') } }, undefined)
    await expectNotExecuted('promote_video_edit_template', { templateRef }, '风格库目录不可读')
    // 原复现：风格不存在被拒绝后，同一剪辑接着写入照常成功。
    videoEditStyleLibrary.reset(io, undefined)
    await expectNotExecuted('create_video_edit_template', { documentRef, sequenceRef, clipRefs: [clip(first)], name: '人名条', styleId: 'missing-style' }, '没有这个风格')
    // 应用重新加载后风格库还没读过：风格库风格的 id 照样认（与工具说明一致），模板记下风格与版本。
    videoEditStyleLibrary.reset(io, undefined); expect(videoEditStyleLibrary.loaded()).toBe(false)
    const registered = await call('create_video_edit_template', { documentRef, sequenceRef, clipRefs: [clip(first)], name: '出场人名条', styleId: otherId })
    expect(registered, JSON.stringify(registered)).toMatchObject({ ok: true, executionState: 'completed', verificationState: 'verified' })
    expect(savedVideoEdit(owner).templates?.find(value => value.name === '出场人名条')?.style).toMatchObject({ id: otherId, version: videoEditStyleLibrary.requireStyle(otherId).style.version })
    // 通用属性 project_template.style_id 同一语义：风格库没读过时写库风格 id 也能找到。
    videoEditStyleLibrary.reset(io, undefined)
    const restyled = await call('change_application_entities', { summary: '改所属风格', changes: [{ kind: 'set_properties', entityType: 'video_edit.project_template', target: templateRef, properties: { 'video_edit.project_template.style_id': styleId } }] })
    expect(restyled, JSON.stringify(restyled)).toMatchObject({ ok: true })
    expect(requireVideoEditInstance(projectId).document.templates![0].style?.id).toBe(styleId)
    expect(host.store.unresolved()).toEqual([])
  } finally { host.dispose(); videoEditStyleLibrary.reset(); io.dispose() }
})
