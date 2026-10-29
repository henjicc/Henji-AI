// @vitest-environment node
import { expect, it, vi } from 'vitest'
import { recoverPersistedWebReplayOperation, webReplayJobIdOf } from './persistedOperationRecovery'
import type { OperationRecord } from './operationStore'
import type { WebReplayJobSnapshot } from '../web-replay/renderJobs'
import { applicationOutputValidator } from './outputContract'
import { ApplicationHostBridge } from './applicationHostBridge'
import { buildApplicationToolCatalog } from './toolCatalog'
import { projectApplicationToolResult } from './resultProjection'
import { toMcpResult } from '../mcp/resultProjection'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'

vi.mock('../logging', () => ({ createMainLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() }) }))

const recordingId = '2e811354-8fe6-4fd8-a174-8e0657f5cde8'
const input = { recordingRef: { kind: 'screen_recording.web_recording', id: recordingId }, take: '首问', director: { version: 1 } }
// 渲染层重载：原回执丢了，interrupted() 把执行中的操作记成 unknown，没有 result。
const record: OperationRecord = { operationId: '3e8b1d7c-6a2f-4c95-9d40-7f1e5a3c8b26', callerId: 'caller', inputDigest: 'digest', input, capabilityId: 'render_web_app_replay', state: 'unknown', requestId: 'request', rendererEpoch: 'epoch' }
const jobId = webReplayJobIdOf(record)
const revisions = () => ({ revision: 7, scopeRevisions: { screen_recording: 0 } })
const result = { output: 'D:/r/takes/首问/video.mp4', frames: 90, width: 1280, height: 720, durationMs: 3000, looseMatches: 0, unusedCalls: 0, locatorMisses: 0,
  issues: [{ t: 1, kind: 'conflict' as const, message: '录制里没有的请求' }, { t: 2, kind: 'warning' as const, message: '帧标记被盖住' }],
  take: { name: '首问', directory: 'D:/r/takes/首问', video: 'D:/r/takes/首问/video.mp4', frames: 90, durationMs: 3000, fps: 30, pointer: false, createdAt: '2026-10-28T00:00:00.000Z', conflicts: 1, steps: ['timeline'] } }
const job = (fields: Partial<WebReplayJobSnapshot>): WebReplayJobSnapshot => ({ jobId, recordingId, state: 'running', progress: 0.5, ...fields })

it('重演已在主进程跑完：用登记的结果重建回执，记为完成，且符合对外输出契约', () => {
  const recovered = recoverPersistedWebReplayOperation(id => (id === jobId ? job({ state: 'completed', progress: 1, result }) : undefined), record, revisions)!
  expect(recovered).toMatchObject({ state: 'completed', verificationState: 'verified', result: { ok: true, resultingRevision: 7,
    data: { resultRef: input.recordingRef, video: result.output, pointer: false, frames: 90, conflicts: ['录制里没有的请求'], warnings: ['帧标记被盖住'], take: { name: '首问', steps: ['timeline'] }, revision: 7 } } })
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('render_web_app_replay')!
  expect(definition.outputSchema.safeParse(recovered.result!.data).success).toBe(true)
  const host = new ApplicationHostBridge(() => {})
  const tool = buildApplicationToolCatalog({ tools: host.tools(), includeSkillTool: true }).tools.find(item => item.name === 'render_web_app_replay')!
  const raw = { ok: true, operationId: record.operationId, executionState: 'completed' as const, verificationState: recovered.verificationState, result: recovered.result, ...revisions() }
  for (const options of [{}, { includeRevisions: true, includeEvidence: true, includeDetails: true }]) {
    const checked = applicationOutputValidator.getValidator(tool.outputSchema!)(toMcpResult(projectApplicationToolResult('render_web_app_replay', input, raw, options)).structuredContent)
    expect(checked.valid, JSON.stringify(checked)).toBe(true)
  }
})

it('还在排队或重演：标回执行中；登记里没有（应用重启过）或宿主修订号缺失时不改动', () => {
  for (const state of ['queued', 'running'] as const) expect(recoverPersistedWebReplayOperation(() => job({ state }), record, revisions)).toMatchObject({ state: 'executing', verificationState: 'unresolved' })
  expect(recoverPersistedWebReplayOperation(() => job({ state: 'running' }), { ...record, state: 'executing' }, revisions)).toBeUndefined()
  expect(recoverPersistedWebReplayOperation(() => undefined, record, revisions)).toBeUndefined()
  expect(recoverPersistedWebReplayOperation(() => job({ state: 'completed', result }), record, () => undefined)).toBeUndefined()
  expect(recoverPersistedWebReplayOperation(() => job({ state: 'completed', result }), { ...record, capabilityId: 'import_web_recording' }, revisions)).toBeUndefined()
})

it('取消或写盘前被拒是未执行；其余失败仍待核对', () => {
  expect(recoverPersistedWebReplayOperation(() => job({ state: 'cancelled', error: { name: 'WebReplayCancelledError', message: '已取消重演' } }), record, revisions)).toMatchObject({ state: 'not_executed', verificationState: 'verified', result: { ok: false, error: { details: { execution: { notExecuted: true } } } } })
  expect(recoverPersistedWebReplayOperation(() => job({ state: 'failed', error: { name: 'WebReplayDirectorError', message: '导演稿不对' } }), record, revisions)).toMatchObject({ state: 'not_executed' })
  expect(recoverPersistedWebReplayOperation(() => job({ state: 'failed', error: { name: 'Error', message: '编码器崩了' } }), { ...record, state: 'executing' }, revisions)).toMatchObject({ state: 'unknown', verificationState: 'unresolved', result: { ok: false, error: { message: '编码器崩了' } } })
})

it('发起它的页面还在等这次调用：不用登记重建，等页面回执；页面已断开（unknown）照常重建', () => {
  const completed = () => job({ state: 'completed', result })
  expect(recoverPersistedWebReplayOperation(completed, { ...record, state: 'executing' }, revisions, () => true)).toBeUndefined()
  expect(recoverPersistedWebReplayOperation(completed, { ...record, state: 'executing' }, revisions, () => false)).toMatchObject({ state: 'completed' })
  expect(recoverPersistedWebReplayOperation(completed, record, revisions, () => true)).toMatchObject({ state: 'completed' })
})
