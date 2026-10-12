import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { ApplicationToolDispatcher } from './applicationToolDispatcher'
import { ApplicationHostBridge } from './applicationHostBridge'
import type { ApplicationOperationCoordinator } from './operationCoordinator'
import type { OperationRecord } from './operationStore'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { applicationOutputValidator } from './outputContract'
import { readApplicationMediaResource } from './mediaResources'

vi.mock('electron', () => ({ app: { isPackaged: false } }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info() {}, warn() {}, error() {} }) }))
vi.mock('./mediaResources', () => ({ readApplicationMediaResource: vi.fn(), ApplicationMediaResourceError: class extends Error {} }))

const access = { allowWrites: true, allowPaid: true, allowDestructive: true }
const connections = { assertActive: vi.fn(), access: () => access }
const signal = new AbortController().signal

it('口播十一工具与共用剪辑输入只接受自身字段，真实必填项在公开 schema 中可见', () => {
  const host = new ApplicationHostBridge(() => {})
  const dispatcher = new ApplicationToolDispatcher(connections, host, {} as ApplicationOperationCoordinator)
  const samples: Array<[string, Record<string, unknown>, string[]]> = [
    ...['reset_audio_edit', 'format_audio_edit_subtitles', 'process_audio_edit_sound', 'query_audio_edit_tasks', 'retry_audio_edit_save'].map(id => [id, { documentRef: { kind: 'audio_edit.document', id: 'audio' } }, ['documentRef']] as [string, Record<string, unknown>, string[]]),
    ...['quick_process_audio_edit', 'compress_audio_edit_silence', 'clean_audio_edit_fillers', 'transcribe_audio_edit'].map(id => [id, { documentRef: { kind: 'audio_edit.document', id: 'audio' } }, ['documentRef']] as [string, Record<string, unknown>, string[]]),
    ['cancel_audio_edit_task', { documentRef: { kind: 'audio_edit.document', id: 'audio' }, taskId: 'task' }, ['documentRef', 'taskId']],
    ['export_audio_edit', { documentRef: { kind: 'audio_edit.document', id: 'audio' }, destination: { mode: 'quick' } }, ['documentRef', 'destination']],
    ...['save_video_edit', 'undo_video_edit', 'redo_video_edit', 'import_video_edit_folder'].map(id => [id, { documentRef: { kind: 'video_edit.document', id: 'video' } }, ['documentRef']] as [string, Record<string, unknown>, string[]]),
    ['split_video_edit', { documentRef: { kind: 'video_edit.document', id: 'video' }, clipRef: { kind: 'video_edit.clip', id: 'video:clip' }, frame: 5 }, ['documentRef', 'clipRef', 'frame']],
    ['import_video_edit_asset', { documentRef: { kind: 'video_edit.document', id: 'video' }, assetRef: { kind: 'asset', id: 'asset' } }, ['documentRef', 'assetRef']],
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
  expect(execute).toHaveBeenCalledWith('caller', 'read_application_entity', { ref, propertyIds: [] }, signal, access)
  expect(rememberRead).not.toHaveBeenCalled()
  execute.mockResolvedValueOnce({ ok: false, error: { code: 'PERMISSION_DENIED', message: '已撤销' } })
  const calls = vi.mocked(readApplicationMediaResource).mock.calls.length
  expect((await dispatcher.readMedia('caller', { ref }, signal)).ok).toBe(false)
  expect(readApplicationMediaResource).toHaveBeenCalledTimes(calls)
})
