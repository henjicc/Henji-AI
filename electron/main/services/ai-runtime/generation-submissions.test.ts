import { applicationGenerationTaskId, applicationInvocationId } from '../../../../src/core/application-control/operationIdentity'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AiGenerateRequestDto } from '@henjicc/ai-sdk'

if (!process.versions.electron) throw new Error('本测试必须由正式 Electron SQLite 原生运行器执行。')
const state = vi.hoisted(() => ({ db: null as Database.Database | null }))
vi.mock('../db', () => ({ getDb: () => state.db! }))
import { claimGenerationSubmission, completeGenerationSubmission, readGenerationSubmission } from './generation-submissions'
import { recoverPersistedGenerationOperation } from '../application-runtime/persistedOperationRecovery'
import type { OperationRecord } from '../application-runtime/operationStore'
import { ApplicationOperationStore } from '../application-runtime/operationStore'
import { ApplicationOperationCoordinator } from '../application-runtime/operationCoordinator'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'

/** 宿主当前修订号的替身；真实运行时来自 `host.getContext()`。 */
const HOST_REVISIONS = { revision: 7, scopeRevisions: { generation: 3, canvas: 2 } }
afterEach(() => { state.db?.close(); state.db = null })

describe('原生生成提交事实', () => {
  it('同业务字段乱序重传复用回执，新请求独立；未知原请求不能二次派发', () => {
    state.db = new Database(':memory:')
    const request: AiGenerateRequestDto = { requestId: 'original', modelId: 'model', params: { prompt: 'test', width: 2 } }
    expect(claimGenerationSubmission('original', request)).toBeNull()
    expect(() => claimGenerationSubmission('original', request)).toThrow('GENERATION_OUTCOME_UNKNOWN')
    completeGenerationSubmission('original', { status: 'pending', taskId: 'provider-1', url: '' })
    expect(claimGenerationSubmission('original', { modelId: 'model', params: { width: 2, prompt: 'test' } })).toMatchObject({ taskId: 'provider-1' })
    expect(readGenerationSubmission('original')).toMatchObject({ status: 'pending' })
    expect(() => claimGenerationSubmission('original', { ...request, modelId: 'other' })).toThrow('GENERATION_INPUT_CONFLICT')
    expect(claimGenerationSubmission('new-request', request)).toBeNull()
  })
  it('同步结果可反复核对，读取不消费原事实或伪造供应商任务号', () => {
    state.db = new Database(':memory:')
    claimGenerationSubmission('sync', { modelId: 'model', params: {} })
    completeGenerationSubmission('sync', { status: 'completed', url: 'https://example.com/result.png', filePath: '/managed/result.png' })
    expect(readGenerationSubmission('sync')).toEqual(readGenerationSubmission('sync'))
    expect(readGenerationSubmission('sync')).not.toHaveProperty('taskId')
    expect(readGenerationSubmission('missing')).toBeNull()
  })
  it('重启核对只关联原历史主键；排队无供应商号也不自动提交，不同目标不能解除未知', () => {
    state.db = new Database(':memory:')
    state.db.exec('CREATE TABLE history(id TEXT PRIMARY KEY, model_id TEXT, prompt TEXT, status TEXT, task_id TEXT, file_path TEXT)')
    const record: OperationRecord = { operationId: 'original', callerId: 'client', capabilityId: 'create_visible_generation_task',
      state: 'unknown', inputDigest: 'digest', input: { modelId: 'model', prompt: 'test' }, expectedRevisions: {} }
    state.db.prepare('INSERT INTO history VALUES(?,?,?,?,?,?)').run('other', 'model', 'test', 'completed', null, '/other.png')
    expect(recoverPersistedGenerationOperation(state.db, record)).toBeUndefined()
    state.db.prepare('INSERT INTO history VALUES(?,?,?,?,?,?)').run(applicationGenerationTaskId(applicationInvocationId('client', 'original')), 'model', 'test', 'queued', null, null)
    const recovered = recoverPersistedGenerationOperation(state.db, record, () => HOST_REVISIONS)
    expect(recovered).toMatchObject({ state: 'completed', verificationState: 'verified', result: { data: { observedStatus: 'queued', serverTaskId: null } } })
    expect(state.db.prepare("SELECT count(*) AS count FROM sqlite_master WHERE name='generation_submissions'").get()).toEqual({ count: 0 })
  })

  /*
   * 这条盯的是**对外契约**，不是内部字段偏好。恢复回执会覆盖掉执行时那份已补全的结果，
   * 而 `capabilityOutputSchema` 把 revision/scopeRevisions 声明成必填；少了它们，按 schema
   * 校验的标准 MCP 客户端会拒收整条回执，外部客户端因此完全用不了付费生成。
   * Pi 不做 schema 校验，所以这条缺陷只会在真实外部客户端上暴露——必须由门禁盯住。
   */
  it('恢复回执符合能力自己公布的输出 schema；修订号拿不到时宁可不重建', () => {
    state.db = new Database(':memory:')
    state.db.exec('CREATE TABLE history(id TEXT PRIMARY KEY, model_id TEXT, prompt TEXT, status TEXT, task_id TEXT, file_path TEXT)')
    const record: OperationRecord = { operationId: 'original', callerId: 'client', capabilityId: 'create_visible_generation_task',
      state: 'completed', inputDigest: 'digest', input: { modelId: 'model', prompt: 'test' }, expectedRevisions: {} }
    state.db.prepare('INSERT INTO history VALUES(?,?,?,?,?,?)').run(applicationGenerationTaskId(applicationInvocationId('client', 'original')), 'model', 'test', 'success', 'provider-9', '/managed/result.png')

    const outputSchema = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get('create_visible_generation_task')!.outputSchema
    const recovered = recoverPersistedGenerationOperation(state.db, record, () => HOST_REVISIONS)
    const parsed = outputSchema.safeParse((recovered!.result as { data: unknown }).data)
    expect(parsed.success, JSON.stringify(parsed.error?.issues ?? [])).toBe(true)
    expect(recovered!.result).toMatchObject({ data: { revision: 7, scopeRevisions: { generation: 3, canvas: 2 }, resultRef: { kind: 'generation.result', id: applicationGenerationTaskId(applicationInvocationId('client', 'original')) } } })

    // 原回执里的修订号优先于宿主当前快照：重新报告同一次操作不能把别人的推进算到它头上。
    const withPrevious = recoverPersistedGenerationOperation(state.db,
      { ...record, result: { ok: true, data: { revision: 2, scopeRevisions: { generation: 1 } } } }, () => HOST_REVISIONS)
    expect(withPrevious!.result).toMatchObject({ data: { revision: 2, scopeRevisions: { generation: 1 } } })

    // 两个来源都没有时不发违反自己契约的回执，交回原状态让调用方稍后再查。
    expect(recoverPersistedGenerationOperation(state.db, record, () => undefined)).toBeUndefined()
    expect(recoverPersistedGenerationOperation(state.db, record)).toBeUndefined()
  })
  it('未知原创建不得重放，但同模型的独立新业务请求不被只读依赖误封', () => {
    state.db = new Database(':memory:')
    const store = new ApplicationOperationStore(state.db)
    const coordinator = new ApplicationOperationCoordinator(store)
    const baseline = store.baseline('caller', [{ kind: 'generation.model', id: 'model' }], { generation: 1 }, 'host')
    const input = { operationId: crypto.randomUUID(), baselineIds: [baseline.id], modelId: 'model', prompt: 'test', mediaType: 'image' }
    const access = { allowWrites: true, allowDestructive: false, allowPaid: true }
    const original = coordinator.prepare('caller', input, 'host', access, 'create_visible_generation_task')
    coordinator.dispatched(original, 'request', 'host')
    coordinator.interrupted('request', 'host')
    expect(coordinator.prepare('caller', input, 'host', access, 'create_visible_generation_task').state).toBe('unknown')
    expect(() => coordinator.prepare('caller', { ...input, operationId: crypto.randomUUID() },
      'host', access, 'create_visible_generation_task')).toThrow('RECOVERY_REQUIRED')
    const fresh = coordinator.prepare('caller', { ...input, prompt: 'another independent image', operationId: crypto.randomUUID() },
      'host', access, 'create_visible_generation_task')
    expect(fresh.state).toBe('prepared')
    expect(fresh.targetRefs).not.toEqual(original.targetRefs)
    expect(() => coordinator.prepare('caller', { ...input, operationId: crypto.randomUUID() }, 'host', { ...access, allowPaid: false }, 'create_visible_generation_task')).toThrow('PERMISSION_DENIED')
  })
})
