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
    registerHost: async registration => { bridge.register(registration, { send: (_channel, payload) => request(payload as LocalHostRequest) }) },
    complete: async reply => { bridge.complete(reply) },
    publishContext: async snapshot => { bridge.publishContext(snapshot) },
    onRequest: callback => { request = callback; return () => undefined },
    onCancel: () => () => undefined, onRevoke: () => () => undefined,
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
    const styleDenied = await host.call('insert_video_edit_style_component', { operationId: crypto.randomUUID(), documentRef, sequenceRef, styleRef: { kind: 'video_edit.style_preset', id: 'missing-style' }, sampleId: 'missing-sample', frame: 0 })
    expect(styleDenied).toMatchObject({ ok: false, executionState: 'not_executed', verificationState: 'verified' })
    const sampleDenied = await host.call('insert_video_edit_style_component', { operationId: crypto.randomUUID(), documentRef, sequenceRef, styleRef: { kind: 'video_edit.style_preset', id: 'builtin:style:0' }, sampleId: 'missing-sample', frame: 0 })
    expect(sampleDenied).toMatchObject({ ok: false, executionState: 'not_executed', verificationState: 'verified' })
    expect(JSON.stringify(sampleDenied)).toContain('组件不存在')
    const smartDenied = await host.call('retry_video_edit_smart_region', { operationId: crypto.randomUUID(), documentRef, effectRef: { kind: 'video_edit.effect', id: `${owner.document.id}:missing-effect` } })
    expect(smartDenied).toMatchObject({ ok: false, executionState: 'not_executed', verificationState: 'verified' })
    expect(host.store.unresolved()).toEqual([])
    const titleId = crypto.randomUUID()
    const title = await host.call('apply_video_edit_title_template', { operationId: titleId, documentRef, sequenceRef, frame: 12, templateRef: { kind: 'video_edit.title_template', id: 'title:chapter' }, parameters: { text: '第二章' } })
    expect(title).toMatchObject({ ok: true, executionState: 'completed', verificationState: 'verified', result: { data: { verified: true, verification: { verified: true } } } })
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
