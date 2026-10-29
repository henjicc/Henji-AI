import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ApplicationToolDispatcher } from './applicationToolDispatcher'
import { ApplicationHostBridge } from './applicationHostBridge'
import type { ApplicationOperationCoordinator } from './operationCoordinator'
import type { OperationRecord } from './operationStore'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { applicationOutputValidator } from './outputContract'
import { readApplicationMediaResource } from './mediaResources'
import { applicationUserConfirmation } from '../../../../src/core/application-control/userConfirmation'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info() {}, warn() {}, error() {} }) }))
vi.mock('./mediaResources', () => ({ readApplicationMediaResource: vi.fn(), ApplicationMediaResourceError: class extends Error {} }))

const connections = { assertActive: vi.fn() }
const signal = new AbortController().signal

it('声明读取可以返回人工信任等待，公开目录提供原操作续查且输出契约接受等待', async () => {
  const host = new ApplicationHostBridge(() => {})
  const waiting = { ok: false, operationId: randomUUID(), executionState: 'awaiting_user_confirmation', verificationState: 'unresolved', confirmation: applicationUserConfirmation({ title: '分享素材', message: '这份内容包含代码，是否信任并允许运行？', confirmLabel: '信任' }) }
  vi.spyOn(host, 'execute').mockResolvedValue(waiting)
  const rememberRead = vi.fn((_caller: string, result: typeof waiting) => result)
  const dispatcher = new ApplicationToolDispatcher({ assertActive() {} }, host, { rememberRead } as unknown as ApplicationOperationCoordinator)
  expect(dispatcher.catalog('reader').tools.some(tool => tool.name === 'get_application_operation')).toBe(true)
  expect(await dispatcher.call('reader', 'read_application_entity', { ref: { kind: 'video_edit.code_material', id: 'material' } }, signal)).toMatchObject(waiting)
})

it('口播十一工具与共用剪辑输入只接受自身字段，真实必填项在公开 schema 中可见', () => {
  const host = new ApplicationHostBridge(() => {})
  const dispatcher = new ApplicationToolDispatcher(connections, host, {} as ApplicationOperationCoordinator)
  const samples: Array<[string, Record<string, unknown>, string[]]> = [
    ...['reset_audio_edit', 'format_audio_edit_subtitles', 'process_audio_edit_sound', 'query_audio_edit_tasks', 'retry_audio_edit_save'].map(id => [id, { documentRef: { kind: 'audio_edit.document', id: 'audio' } }, ['documentRef']] as [string, Record<string, unknown>, string[]]),
    ...['quick_process_audio_edit', 'compress_audio_edit_silence', 'clean_audio_edit_fillers', 'clean_audio_edit_retakes', 'transcribe_audio_edit'].map(id => [id, { documentRef: { kind: 'audio_edit.document', id: 'audio' } }, ['documentRef']] as [string, Record<string, unknown>, string[]]),
    ['import_audio_edit_source', { documentRef: { kind: 'audio_edit.document', id: 'audio' }, sourcePath: 'D:/录音/口播.wav' }, ['documentRef', 'sourcePath']],
    ['cancel_audio_edit_task', { documentRef: { kind: 'audio_edit.document', id: 'audio' }, taskId: 'task' }, ['documentRef', 'taskId']],
    ['export_audio_edit', { documentRef: { kind: 'audio_edit.document', id: 'audio' }, destination: { mode: 'quick' } }, ['documentRef', 'destination']],
    ...['save_video_edit', 'undo_video_edit', 'redo_video_edit', 'import_video_edit_folder'].map(id => [id, { documentRef: { kind: 'video_edit.document', id: 'video' } }, ['documentRef']] as [string, Record<string, unknown>, string[]]),
    ['split_video_edit', { documentRef: { kind: 'video_edit.document', id: 'video' }, clipRef: { kind: 'video_edit.clip', id: 'video:clip' }, frame: 5 }, ['documentRef', 'clipRef', 'frame']],
    ['import_video_edit_asset', { documentRef: { kind: 'video_edit.document', id: 'video' }, assetRef: { kind: 'asset', id: 'asset' } }, ['documentRef', 'assetRef']],
    ['import_video_edit_project_files', { documentRef: { kind: 'video_edit.document', id: 'video' }, paths: ['素材/截图/产品主页.png'] }, ['documentRef', 'paths']],
    ...['ripple_delete_video_edit_text', 'extract_video_edit_text', 'insert_video_edit_text'].map(id => [id, {
      documentRef: { kind: 'video_edit.document', id: 'video' }, sequenceRef: { kind: 'video_edit.sequence', id: 'video:sequence' },
      selector: { kind: 'text', text: '原稿' }, ...(id === 'insert_video_edit_text' ? { frame: 5 } : {}),
    }, ['documentRef', 'sequenceRef', 'selector', ...(id === 'insert_video_edit_text' ? ['frame'] : [])]] as [string, Record<string, unknown>, string[]]),
  ]
  for (const [id, input, required] of samples) {
    const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)!
    const tool = dispatcher.catalog('caller').tools.find(tool => tool.name === id)!
    expect(definition.inputSchema.safeParse(input).success, id).toBe(true)
    expect(definition.inputSchema.safeParse({ ...input, frame: 8, modelId: 'irrelevant' }).success, id).toBe(false)
    expect(tool.inputSchema.required, id).toEqual(expect.arrayContaining(required))
    for (const field of required) {
      const incomplete = { ...input }; delete incomplete[field]
      expect(definition.inputSchema.safeParse(incomplete).success, `${id}:${field}`).toBe(false)
    }
  }
})

it('1501 个合法批量结果保留完整账本，公开摘要和分页可读完且隔离调用者', async () => {
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('apply_video_edit_scenes')!
  const refs = Array.from({ length: 1501 }, (_, index) => ({ kind: 'video_edit.marker', id: `video:${index}` }))
  const data = definition.outputSchema.parse({ resultRef: { kind: 'video_edit.document', id: 'video' }, changedRefs: refs, cutFrames: refs.map((_, index) => index), verified: true, message: '已保存' }) as Record<string, unknown>
  const operation: OperationRecord = { operationId: randomUUID(), callerId: 'caller', capabilityId: definition.id,
    state: 'completed', verificationState: 'verified', inputDigest: 'fixture', input: {}, result: { ok: true, data: { ...data, verification: { verified: true, condition: '已回读' } } } }
  const host = new ApplicationHostBridge(() => {})
  const operations = { store: { get: (id: string, caller: string) => id === operation.operationId && caller === operation.callerId ? operation : undefined },
    reconcileReceipt: vi.fn(), reconcileVerification: vi.fn(), result: () => ({ ok: true, operationId: operation.operationId, executionState: 'completed', result: operation.result }) } as unknown as ApplicationOperationCoordinator
  const dispatcher = new ApplicationToolDispatcher(connections, host, operations)
  const summary = await dispatcher.call('caller', 'get_application_operation', { operationId: operation.operationId }, signal)
  const schema = dispatcher.catalog('caller').tools.find(tool => tool.name === definition.id)!.outputSchema!
  expect(applicationOutputValidator.getValidator(schema)(summary).valid).toBe(true)
  expect(summary).toMatchObject({ result: { data: { resultCollections: { changedRefs: { total: 1501, resultRef: { operationId: operation.operationId, field: 'changedRefs' } } } } } })
  expect(JSON.stringify(summary)).not.toContain('video:1500')
  const received: unknown[] = []; let cursor: string | null = '0'
  while (cursor !== null) {
    const page = await dispatcher.call('caller', 'get_application_operation', { operationId: operation.operationId, resultField: 'changedRefs', cursor, limit: 100 }, signal)
    received.push(...page.data!.items as unknown[]); cursor = page.data!.nextCursor as string | null
  }
  expect(received).toEqual(refs)
  expect((operation.result!.data as Record<string, unknown>).changedRefs).toEqual(refs)
  expect(await dispatcher.call('other', 'get_application_operation', { operationId: operation.operationId, resultField: 'changedRefs' }, signal)).toMatchObject({ ok: false, executionState: 'not_found' })
})

it('媒体每块只读最小实体属性核验授权，不创建内部读取基线，撤销后不交付媒体', async () => {
  const host = new ApplicationHostBridge(() => {})
  const execute = vi.spyOn(host, 'execute').mockResolvedValue({ ok: true, data: {} })
  const rememberRead = vi.fn()
  const dispatcher = new ApplicationToolDispatcher(connections, host, { rememberRead } as unknown as ApplicationOperationCoordinator)
  vi.mocked(readApplicationMediaResource).mockResolvedValue({ mimeType: 'video/mp4', base64: '', offset: 0, byteLength: 0, totalBytes: 0, eof: true })
  const ref = { kind: 'asset', id: 'asset' }
  for (const offset of [0, 262144]) expect((await dispatcher.readMedia('caller', { ref, offset }, signal)).ok).toBe(true)
  expect(execute).toHaveBeenCalledWith('caller', 'read_application_entity', { ref, propertyIds: [] }, signal)
  expect(rememberRead).not.toHaveBeenCalled()
  execute.mockResolvedValueOnce({ ok: false, error: { code: 'PERMISSION_DENIED', message: '已撤销' } })
  const calls = vi.mocked(readApplicationMediaResource).mock.calls.length
  expect((await dispatcher.readMedia('caller', { ref }, signal)).ok).toBe(false)
  expect(readApplicationMediaResource).toHaveBeenCalledTimes(calls)
})

it('界面崩溃期间外部读取与写入拿到同一个带崩溃原因的未就绪错误', async () => {
  const { ApplicationOperationCoordinator } = await import('./operationCoordinator')
  const { ApplicationOperationStore } = await import('./operationStore')
  const store = Object.create(ApplicationOperationStore.prototype) as InstanceType<typeof ApplicationOperationStore>
  vi.spyOn(store, 'recoverInterrupted').mockImplementation(() => undefined)
  vi.spyOn(store, 'unresolved').mockImplementation(() => [])
  vi.spyOn(store, 'get').mockImplementation(() => undefined)
  vi.spyOn(store, 'prepare').mockImplementation(value => value)
  vi.spyOn(store, 'save').mockImplementation(() => undefined)
  const operations = new ApplicationOperationCoordinator(store)
  const host = new ApplicationHostBridge(() => {}, operations)
  host.register({ rendererEpoch: '00000000-0000-4000-8000-000000000001', attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send: () => undefined })
  host.rendererCrashed()
  const dispatcher = new ApplicationToolDispatcher(connections, host, operations)
  const expected = { code: 'APPLICATION_NOT_READY', message: '应用界面已崩溃、正在恢复，请稍后重试。', recoverable: true,
    details: { execution: { notExecuted: true }, retryAfterMs: 1000, reason: 'renderer_crashed' } }
  const read = await dispatcher.call('caller', 'get_current_application_context', {}, signal)
  const write = await dispatcher.call('caller', 'change_application_entities', { operationId: randomUUID(), changes: [] }, signal)
  expect(read).toEqual({ ok: false, error: expected })
  expect(write).toMatchObject({ ok: false, executionState: 'not_executed', result: { ok: false, error: expected } })
})

it('界面崩溃发生在派发途中：保存重试与媒体读取同样返回带崩溃原因的未就绪错误并记零执行', async () => {
  const { ApplicationHostNotReadyError } = await import('./applicationHostBridge')
  const host = new ApplicationHostBridge(() => {})
  host.register({ rendererEpoch: '00000000-0000-4000-8000-000000000001', attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send: () => undefined })
  vi.spyOn(host, 'execute').mockRejectedValue(new ApplicationHostNotReadyError({ reason: 'renderer_crashed', recovering: true }))
  let record = { operationId: randomUUID(), callerId: 'caller', inputDigest: 'digest', input: {}, capabilityId: 'retry_canvas_document_save', state: 'prepared' } as OperationRecord
  const operations = {
    prepareSaveRecovery: () => record,
    store: { beginPreparation: () => { record = { ...record, state: 'preparing' }; return true }, get: () => record, save: (value: OperationRecord) => { record = value } },
    result: (value: OperationRecord) => ({ ok: false, executionState: value.state, result: value.result }),
  } as unknown as ApplicationOperationCoordinator
  const dispatcher = new ApplicationToolDispatcher(connections, host, operations)
  const expected = { code: 'APPLICATION_NOT_READY', message: '应用界面已崩溃、正在恢复，请稍后重试。', recoverable: true,
    details: { execution: { notExecuted: true }, retryAfterMs: 1000, reason: 'renderer_crashed' } }
  expect(await dispatcher.call('caller', 'retry_application_operation_save', { operationId: randomUUID(), originalOperationId: randomUUID() }, signal))
    .toMatchObject({ ok: false, executionState: 'not_executed', result: { ok: false, error: expected } })
  expect(await dispatcher.readMedia('caller', { ref: { kind: 'asset', id: 'asset' } }, signal)).toEqual({ ok: false, error: expected })
})
