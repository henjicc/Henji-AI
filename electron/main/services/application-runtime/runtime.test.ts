import { dialog } from 'electron'
import { expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { OperationRecord } from './operationStore'
import type { LocalHostRequest } from '../../../../src/core/application-control/localHostContracts'
import { applicationUserConfirmation } from '../../../../src/core/application-control/userConfirmation'
import { initializeApplicationRuntime, createEmbeddedApplicationClient } from './runtime'
import { webReplayRenderJobs } from '../web-replay/renderJobs'
import { webReplayJobIdOf } from './persistedOperationRecovery'
import type { HostContextSnapshot } from '../../../../src/core/application-control/hostContracts'
import { videoEditExportJobRegistry } from '../video-edit-export/registry'
import { applicationInvocationId } from '../../../../src/core/application-control/operationIdentity'
import { VIDEO_EDIT_EXPORT_PRESETS } from '../../../../src/core/videoEdit/exportPresets'

vi.mock('electron', () => ({ app: { isPackaged: false }, dialog: { showMessageBox: vi.fn() } }))
vi.mock('../db', () => ({ getDb: () => undefined }))
vi.mock('../generation-history/store', () => ({ getGenerationHistoryStore: () => { throw new Error('本测试不得访问生成记录') } }))
// Storage boundary only; ownership, bridge, authorization and runtime lifecycle stay real.
vi.mock('./operationStore', async original => ({ ...await original<typeof import('./operationStore')>(), ApplicationOperationStore: class {
  records = new Map<string, OperationRecord>()
  recoverInterrupted() {}
  save(record: OperationRecord) { this.records.set(`${record.callerId}:${record.operationId}`, record) }
  get(id: string, caller: string) { return this.records.get(`${caller}:${id}`) }
  unresolved() { return [...this.records.values()].filter(record => ['preparing', 'executing', 'awaiting_user_confirmation', 'unknown', 'partial'].includes(record.state)) }
  byRequest(id: string, epoch: string) { return [...this.records.values()].find(record => record.requestId === id && record.rendererEpoch === epoch) }
  claim(record: OperationRecord, requestId: string, rendererEpoch: string) { this.save({ ...record, requestId, rendererEpoch, state: 'executing' }) }
} }))

it('Pi 回合关闭后，已登记的等待操作仍能确认执行；终态释放授权，下一回合沿原调用者查询', async () => {
  const { host, operations } = initializeApplicationRuntime()
  const callerId = randomUUID(), rendererEpoch = randomUUID()
  const client = createEmbeddedApplicationClient(callerId, { allowWrites: true, allowPaid: true, allowDestructive: false })
  let request!: LocalHostRequest
  host.register({ rendererEpoch, attachmentSequence: 1, ready: true, tools: [], domains: [] }, { send: (channel, payload) => {
    if (channel !== 'application:host:request') return
    request = payload as LocalHostRequest
    host.complete({ ...request, result: { ok: false }, progress: { phase: 'awaiting_user_confirmation', confirmation: applicationUserConfirmation({ title: '确认识别费用', message: '按模型计费', confirmLabel: '继续' }) } })
  } })
  const operation: OperationRecord = { operationId: randomUUID(), callerId, capabilityId: 'generate_video_edit_subtitles', input: {}, inputDigest: 'fixture', state: 'prepared' }
  operations.store.save(operation)
  await expect(host.execute(callerId, operation.capabilityId, {}, new AbortController().signal, { operation })).resolves.toMatchObject({ executionState: 'awaiting_user_confirmation' })
  client.close()
  expect(() => client.catalog()).toThrow('授权已结束')
  expect(() => host.complete({ ...request, result: { ok: false }, progress: { phase: 'executing' } })).not.toThrow()
  host.complete({ ...request, result: { ok: true, data: { verification: { verified: true } } } })
  expect(operations.store.get(operation.operationId, callerId)?.state).toBe('completed')
  expect(() => client.catalog()).toThrow('授权已结束')
  const next = createEmbeddedApplicationClient(callerId, { allowWrites: true, allowPaid: false, allowDestructive: false })
  client.close() // Closing an old handle twice cannot release a new turn's access.
  expect(await next.call('get_application_operation', { operationId: operation.operationId }, new AbortController().signal)).toMatchObject({ executionState: 'completed' })
  next.close(); host.disconnect()
})

it('人工核对只通知可信渲染宿主，不调用 Electron 系统对话框', async () => {
  const { host, operations } = initializeApplicationRuntime()
  const rendererEpoch = randomUUID(), send = vi.fn()
  host.register({ rendererEpoch, attachmentSequence: 2, ready: true, tools: [], domains: [] }, { send })
  const record: OperationRecord = { operationId: randomUUID(), callerId: randomUUID(), capabilityId: 'change_application_entities',
    input: {}, inputDigest: 'review', state: 'unknown', rendererEpoch: randomUUID(), targetRefs: [{ kind: 'video_edit.document', id: 'document' }],
    // 人工核对只保留给涉及付费的操作
    paidGenerationEstimate: 0.5 }
  operations.store.save(record)
  await operations.review(record, rendererEpoch, async () => ({ ok: true, data: { properties: { 'video_edit.document.name': '主剪辑' } } }), () => undefined)
  expect(send).toHaveBeenLastCalledWith('application:host:reviews', expect.objectContaining({ open: expect.objectContaining({ operationId: record.operationId }), items: expect.arrayContaining([expect.objectContaining({ title: '这次修改生效了吗？', message: expect.stringContaining('主剪辑') })]) }))
  expect(dialog.showMessageBox).not.toHaveBeenCalled()
})

const replayResult = { output: 'D:/r/replay.clean.mp4', frames: 30, width: 1280, height: 720, durationMs: 1000, issues: [], looseMatches: 0, unusedCalls: 0, locatorMisses: 0 }
const replayRecord = (rendererEpoch: string, recordingId = randomUUID()): OperationRecord & { recordingId: string } => ({ operationId: randomUUID(), callerId: randomUUID(), capabilityId: 'render_web_app_replay', inputDigest: 'replay',
  input: { recordingRef: { kind: 'screen_recording.web_recording', id: recordingId } }, state: 'executing', requestId: randomUUID(), rendererEpoch, recordingId })

it('网页重演结束时：发起它的页面还在等就以页面回执为准；重载空档里结束的，等新页面发布上下文再结账', () => {
  const { host, operations } = initializeApplicationRuntime()
  const epoch = randomUUID()
  host.register({ rendererEpoch: epoch, attachmentSequence: 3, ready: true, tools: [], domains: [] }, { send: vi.fn() })
  const live = replayRecord(epoch)
  operations.store.save(live)
  webReplayRenderJobs.begin(webReplayJobIdOf(live), live.recordingId)
  webReplayRenderJobs.complete(webReplayJobIdOf(live), replayResult)
  expect(operations.store.get(live.operationId, live.callerId)).toMatchObject({ state: 'executing' })

  // 页面重载：旧页面断开，回执丢失，新页面还没发布上下文
  host.disconnect()
  const orphan = { ...replayRecord(epoch), state: 'unknown' as const }
  operations.store.save(orphan)
  webReplayRenderJobs.begin(webReplayJobIdOf(orphan), orphan.recordingId)
  webReplayRenderJobs.complete(webReplayJobIdOf(orphan), replayResult)
  expect(operations.store.get(orphan.operationId, orphan.callerId)).toMatchObject({ state: 'unknown' })
  host.register({ rendererEpoch: randomUUID(), attachmentSequence: 4, ready: true, tools: [], domains: [] }, { send: vi.fn() })
  host.publishContext({ revision: 3, scopeRevisions: { screen_recording: 0 } } as unknown as HostContextSnapshot)
  expect(operations.store.get(orphan.operationId, orphan.callerId)).toMatchObject({ state: 'completed', result: { ok: true, resultingRevision: 3, data: { video: replayResult.output } } })
})

it('渲染层重载后操作查询从导出登记恢复中断与完成状态，回执丢失也不丢任务', async () => {
  const { host, operations } = initializeApplicationRuntime()
  const callerId = randomUUID(), documentRef = { kind: 'video_edit.document', id: randomUUID() }
  const record: OperationRecord = { operationId: randomUUID(), callerId, capabilityId: 'export_video_edit', inputDigest: 'export', input: { documentRef }, state: 'unknown', rendererEpoch: 'departed' }
  const page = { senderId: 1, pageId: randomUUID() }, restored = { senderId: 1, pageId: randomUUID() }, id = randomUUID()
  videoEditExportJobRegistry.register(page, { snapshots: [JSON.stringify({ id: 'sequence' })], jobs: [{ invocationId: applicationInvocationId(callerId, record.operationId), id, projectId: documentRef.id, name: '成片', presetName: '母版', restorable: true, snapshotIndex: 0, outputPaths: ['D:/exports/movie.mp4'],
    payload: { path: 'D:/exports/movie.mp4', settings: VIDEO_EDIT_EXPORT_PRESETS[0].settings, range: { startFrame: 0, endFrame: 30 }, rangeSource: 'content' } }] })
  videoEditExportJobRegistry.update(page, { id, state: 'running', progress: 0.4 })
  operations.store.save(record)
  await videoEditExportJobRegistry.restore(restored)
  host.register({ rendererEpoch: randomUUID(), attachmentSequence: 5, ready: true, tools: [], domains: [] }, { send: vi.fn() })
  host.publishContext({ revision: 9, scopeRevisions: { video_edit: 2 } } as unknown as HostContextSnapshot)
  const client = createEmbeddedApplicationClient(callerId, { allowWrites: true, allowPaid: false, allowDestructive: false })
  try {
    const query = () => client.call('get_application_operation', { operationId: record.operationId }, new AbortController().signal)
    expect(await query()).toMatchObject({ executionState: 'completed', result: { ok: true, data: { queue: [{ id, state: 'interrupted', outputReady: false, notice: expect.stringContaining('retryTaskId') }] } } })
    const retry = { ...record, operationId: randomUUID(), state: 'unknown' as const }
    operations.store.save(retry)
    videoEditExportJobRegistry.update(restored, { id, invocationId: applicationInvocationId(callerId, retry.operationId), state: 'running', progress: 0 })
    expect(await client.call('get_application_operation', { operationId: retry.operationId }, new AbortController().signal)).toMatchObject({ executionState: 'completed', result: { data: { queue: [{ id, state: 'running' }] } } })
    videoEditExportJobRegistry.outputPublished(restored, id)
    videoEditExportJobRegistry.update(restored, { id, state: 'completed', progress: 1 })
    expect(await query()).toMatchObject({ result: { data: { queue: [{ id, state: 'completed', outputReady: true, path: 'D:/exports/movie.mp4' }], message: '导出已完成。' } } })
  } finally { client.close(); videoEditExportJobRegistry.remove(restored, [id]); host.disconnect() }
})
