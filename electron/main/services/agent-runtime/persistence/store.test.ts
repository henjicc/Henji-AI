import Database from 'better-sqlite3'
import { z } from 'zod'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentEventSchema,
  agentRunStateSchema,
  type AgentRunState,
  type AgentEvent,
} from '../../../../../src/core/assistant/events'
import {
  AGENT_RUNTIME_SCHEMA_VERSION,
  agentStartRunRequestSchema,
  type AgentStartRunRequest,
} from '../../../../../src/core/assistant/runtimeContracts'
import { runAgentSchemaMigrations } from './migrations'
import { AgentPersistenceStore } from './store'
import { operationRecordSchema, type OperationIntent } from '../../../../../src/core/assistant/operations'
import { AgentOperationCoordinator } from '../tools/operation-coordinator'
import { agentToolObservationSchema } from '../../../../../src/core/assistant/toolContracts'
import { AgentToolGateway } from '../tools/gateway'
import { AgentToolRegistry } from '../tools/registry'
import { defineAgentTool } from '../tools/define-tool'
import { contextSnapshot } from '../context/context-test-fixtures'
import { AgentEventStream } from '../runner/event-stream'
import {
  agentWorkingSummarySchema,
  createAgentWorkingSummary,
} from '../../../../../src/core/assistant/workingContext'
import {
  AGENT_SAVE_POINT_VERSION,
  AGENT_TURN_SNAPSHOT_VERSION,
  AGENT_PROJECTION_VERSION,
  AGENT_COMPACTION_VERSION,
  type AgentTurnSnapshotDraft,
} from '../../../../../src/core/assistant/turn'

function request(): AgentStartRunRequest {
  const now = new Date().toISOString()
  return agentStartRunRequestSchema.parse({
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId: 'thread-1',
    goal: '诊断生成失败',
    userInstructions: '不应复制进运行请求存储',
    approvalMode: 'assistant_decides',
    profile: {
      id: 'profile-1',
      name: '测试配置',
      primary: { providerId: 'provider', modelId: 'model' },
      settings: {
        timeoutMs: 5_000,
        maxRetries: 0,
        maxOutputTokens: 1_000,
        contextWindowBudget: 8_000,
      },
      verifications: [],
      createdAt: now,
      updatedAt: now,
    },
    models: [{
      providerId: 'provider',
      modelId: 'model',
      displayName: '测试模型',
      adapter: 'openai-compatible',
      capabilities: {
        text: true,
        image: false,
        video: false,
        audio: false,
        streaming: true,
        toolCall: true,
        parallelTools: false,
        jsonOutput: true,
        structuredOutputMode: 'json',
        reasoning: false,
        sampling: true,
        contextWindow: 32_000,
        maxOutputTokens: 4_000,
        usage: true,
      },
      enabled: true,
    }],
  })
}

function state(status: AgentRunState['status'] = 'running'): AgentRunState {
  const now = new Date().toISOString()
  return agentRunStateSchema.parse({
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    runId: 'run-1',
    threadId: 'thread-1',
    status,
    sequence: 0,
    turn: 0,
    currentStepId: null,
    currentToolCallId: null,
    waitingApprovalId: null,
    startedAt: now,
    updatedAt: now,
    finalText: null,
    error: null,
    executionOutcome: {
      status: 'pending', effects: [], verificationSummary: { summary: '', evidence: [] },
    },
    presentationOutcome: { status: 'pending' },
    budget: {
      maxTurns: 12,
      maxToolCalls: 24,
      maxDurationMs: 600_000,
      maxInputTokens: 200_000,
      maxOutputTokens: 20_000,
      maxConsecutiveFailures: 3,
      maxRepeatedToolCalls: 3,
      maxNoProgressTurns: 3,
    },
    usage: {
      turns: 0,
      toolCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      knownCostUsd: null,
      consecutiveFailures: 0,
      noProgressTurns: 0,
      elapsedMs: 0,
    },
    lastScopeRevisions: null,
  })
}

function eventForSequence(sequence: number): AgentEvent {
  return agentEventSchema.parse({
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    eventId: `event-${sequence}`,
    sequence,
    occurredAt: new Date(Date.UTC(2026, 6, 30) + sequence).toISOString(),
    runId: 'run-1',
    type: 'RunStarted',
    threadId: 'thread-1',
  })
}

function turnSnapshot(): AgentTurnSnapshotDraft {
  return {
    version: AGENT_TURN_SNAPSHOT_VERSION,
    runId: 'run-1', threadId: 'thread-1', turn: 1,
    projectionVersion: AGENT_PROJECTION_VERSION,
    compactionVersion: AGENT_COMPACTION_VERSION,
    models: ['primary', 'router', 'summarizer'].map((role) => ({
      role: role as 'primary' | 'router' | 'summarizer',
      providerId: 'provider', modelId: 'model', apiProtocol: 'openai-compatible',
    })),
    tools: [{ name: 'tool', version: 1, schemaDigest: 'a'.repeat(64) }],
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    artifactRefs: [],
    requestOptions: {
      contextWindow: 32_000, maxOutputTokens: 1_000, timeoutMs: 5_000,
      approvalMode: 'assistant_decides',
    },
  }
}

const describeWithElectronSqlite = process.versions.electron ? describe : describe.skip

describeWithElectronSqlite('AgentPersistenceStore', () => {
  let database: Database.Database
  let store: AgentPersistenceStore

  beforeEach(() => {
    database = new Database(':memory:')
    database.pragma('foreign_keys = ON')
    runAgentSchemaMigrations(database)
    store = new AgentPersistenceStore(database)
  })

  afterEach(() => {
    database.close()
  })

  function operationIntent(): OperationIntent {
    return { runId: 'run-1', threadId: 'thread-1', key: 'script:step-1', toolCallId: 'step-1',
      toolName: 'change_application_entities', toolVersion: 1, inputDigest: 'a'.repeat(64),
      authorizationDigest: 'b'.repeat(64), readOnly: false, container: false,
      targets: [{ kind: 'canvas.node', id: 'project:A' }], targetBindings: { node: 'project:A' }, expectedRevisions: { canvas: 1 } }
  }

  function durableGateway(write: () => Promise<{ id: string }>) {
    const registry = new AgentToolRegistry()
    for (const readOnly of [true, false]) registry.register(defineAgentTool({
      name: readOnly ? 'read_item' : 'write_item', version: 1, title: '测试操作', description: '操作持久化边界测试',
      category: 'test', side: 'backend', risk: readOnly ? 'R0' : 'R1', permission: 'test:execute',
      readOnly, destructive: false, openWorld: false, idempotent: false, timeoutMs: 1000,
      retryPolicy: { maxRetries: 0, baseDelayMs: 0 }, supportsPreview: false, supportsUndo: false, requiredContext: [],
      inputSchema: z.object({ id: z.string() }), outputSchema: z.object({ id: z.string() }),
      aiInputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false },
      execute: async (input) => readOnly ? input : write(), concurrencyKey: () => 'test',
      targetIds: (input) => ({ item: input.id }), dataClasses: () => ['C1'], summarize: () => '完成',
    }))
    return new AgentToolGateway({ registry, getHostContext: contextSnapshot, appendPermissionAudit: async () => {},
      operations: { execute: async (command) => store.operations.execute(command) } })
  }

  it('脚本修正显式关联未执行的原尝试；无关成功、部分执行和伪造引用均不能关闭原失败', async () => {
    await expect(new AgentOperationCoordinator().prepare({ ...operationIntent(), repairsScriptRunRef: 'unavailable' })).rejects.toThrow('持久化记录')
    store.createRun('run-1', request(), state())
    const prepareScript = (key: string, repairsScriptRunRef?: string) => operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: {
      ...operationIntent(), key, toolCallId: key, toolName: 'run_henji_script', container: true, businessMutation: false, repairsScriptRunRef,
    } }))
    const original = prepareScript('original')
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: original.operationId })
    store.operations.recordOutput(original.operationId, { scriptRunRef: 'script:original', status: 'failed',
      error: { phase: 'compile' }, verification: { passed: false } })
    const unrelated = prepareScript('unrelated')
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: unrelated.operationId })
    store.operations.recordOutput(unrelated.operationId, { scriptRunRef: 'script:unrelated', status: 'completed', verification: { passed: true } })
    expect(store.loadState('run-1')?.executionOutcome.facts?.unresolved).toHaveLength(1)
    expect(() => prepareScript('forged', 'script:missing')).toThrow('SCRIPT_REPAIR_UNSAFE')
    const corrected = prepareScript('corrected', 'script:original')
    expect(corrected.repairsOperationId).toBe(original.operationId)
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: corrected.operationId })
    store.operations.recordOutput(corrected.operationId, { scriptRunRef: 'script:corrected', status: 'completed', verification: { passed: true } })
    expect(store.loadState('run-1')?.executionOutcome.facts?.unresolved).toEqual([])

    const partial = prepareScript('partial')
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: partial.operationId })
    store.operations.recordOutput(partial.operationId, { scriptRunRef: 'script:partial', status: 'partial', error: { phase: 'execute' }, verification: { passed: false } })
    expect(() => prepareScript('unsafe', 'script:partial')).toThrow('SCRIPT_REPAIR_UNSAFE')
    expect(store.loadState('run-1')?.executionOutcome.facts?.unresolved).toMatchObject([{ operationId: partial.operationId }])
  })

  it('保存恢复必须关联原操作并取得新的精确领域回执；成功摘要、其他对象保存均不能关闭缺口', async () => {
    store.createRun('run-1', request(), state())
    const target = { kind: 'canvas.project', id: 'A' }
    const original = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: operationIntent() }))
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: original.operationId })
    store.operations.claimExecution('run-1', original.operationId)
    store.operations.execute({ action: 'fail', runId: 'run-1', operationId: original.operationId, state: 'partial', effects: [], error: '保存失败',
      transaction: { code: 'EXECUTION_FAILED', replayMutation: false,
        persistence: { memoryState: 'modified', persistenceState: 'unconfirmed', stage: 'document',
          recovery: { capabilityId: 'retry_canvas_project_save', target, replayMutation: false } } } })
    const coordinator = new AgentOperationCoordinator({ execute: async (command) => store.operations.execute(command) })
    const intent = { ...operationIntent(), key: 'recovery', toolName: 'retry_canvas_project_save', targets: [target] }
    await expect(coordinator.prepare({ ...intent, key: 'wrong', targets: [{ ...target, id: 'B' }] })).rejects.toThrow('未核对的写入')
    const recovery = await coordinator.prepare(intent)
    expect(recovery).toMatchObject({ recoveryOfOperationId: original.operationId })
    const dispatched = await coordinator.dispatch('run-1', recovery)
    store.operations.claimExecution('run-1', dispatched!.operationId)
    const observation = agentToolObservationSchema.parse({
      source: { toolName: intent.toolName, toolVersion: 1, toolCallId: intent.toolCallId }, trust: 'untrusted_observation',
      dataClasses: ['C1'], summary: '保存成功', output: { status: 'persisted', ref: target }, effects: [],
    })
    await coordinator.complete('run-1', dispatched, observation)
    const resolved = () => store.operations.get(original.operationId)?.verifications.some((item) => item.conditionId === 'persistence' && item.status === 'passed')
    expect(resolved()).toBe(false)
    database.transaction(() => store.operations.recordPersistence({ operationId: dispatched!.operationId, boundaryId: 'wrong-save',
      targets: [{ ...target, id: 'B' }] }, { ...target, id: 'B' }, 'c'.repeat(64)))()
    await coordinator.complete('run-1', dispatched, observation)
    expect(resolved()).toBe(false)
    database.transaction(() => store.operations.recordPersistence({ operationId: dispatched!.operationId, boundaryId: 'actual-save',
      targets: [target] }, target, 'd'.repeat(64)))()
    await coordinator.complete('run-1', dispatched, observation)
    expect(resolved()).toBe(true)
    expect(store.operations.get(original.operationId)?.verifications.find((item) => item.conditionId === 'formal_result')?.status).toBe('pending')
  })

  it('重启只将有主进程领取契约且从未领取的派发认定为未执行，已领取或旧记录保持待核对', () => {
    store.createRun('run-1', request(), state())
    const make = (key: string, requiresMainClaim?: boolean) => {
      const op = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: {
        ...operationIntent(), key, requiresMainClaim,
      } }))
      store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: op.operationId })
      return op
    }
    const pending = make('not-claimed', true)
    const claimed = make('claimed', true)
    const legacy = make('legacy')
    store.operations.claimExecution('run-1', claimed.operationId)
    const restarted = new AgentPersistenceStore(database).operations
    restarted.markInterrupted()
    expect(restarted.get(pending.operationId)?.state).toBe('not_executed')
    expect(restarted.get(claimed.operationId)?.state).toBe('unknown')
    expect(restarted.get(legacy.operationId)?.state).toBe('unknown')
    expect(restarted.execute({ action: 'dispatch', runId: 'run-1', operationId: pending.operationId,
      policyVersion: 2, authorizationDigest: 'c'.repeat(64) })).toMatchObject({ attempt: 2, policyVersion: 2 })
    expect(() => restarted.execute({ action: 'dispatch', runId: 'run-1', operationId: claimed.operationId })).toThrow('OPERATION_REPLAY_BLOCKED')
  })

  it('续跑复用逻辑操作，任务后的新请求保留会话关联但拥有独立操作身份', () => {
    store.createRun('run-1', request(), state())
    const original = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: operationIntent() }))
    store.createRun('continued', request(), { ...state(), runId: 'continued' }, 'run-1', { appendUserMessage: false })
    const continued = store.operations.execute({ action: 'prepare', intent: { ...operationIntent(), runId: 'continued' } })
    expect(continued).toMatchObject({ operationId: original.operationId, logicalTaskId: 'run-1' })
    store.createRun('new-task', request(), { ...state(), runId: 'new-task' }, 'continued', { newLogicalTask: true })
    const next = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: { ...operationIntent(), runId: 'new-task' } }))
    expect(next.operationId).not.toBe(original.operationId)
    expect(next.logicalTaskId).toBe('new-task')
    expect(store.operations.owns('new-task', original.operationId)).toBe(false)
    store.createRun('new-task-resume', request(), { ...state(), runId: 'new-task-resume' }, 'new-task')
    expect(new AgentPersistenceStore(database).operations.execute({ action: 'list', runId: 'new-task-resume' }))
      .toMatchObject([{ operationId: next.operationId }])
    expect(() => store.createRun('wrong-thread', { ...request(), threadId: 'other' }, { ...state(), runId: 'wrong-thread', threadId: 'other' }, 'run-1', { newLogicalTask: true }))
      .toThrow('OPERATION_OWNER_INVALID')
    expect(store.loadState('wrong-thread')).toBeNull()
  })

  it('正式 Gateway 重建后读取原回执，取消等待不丢失已返回修改，也不重放写入', async () => {
    store.createRun('run-1', request(), state())
    const controller = new AbortController()
    let calls = 0
    const write = async () => {
      calls++
      expect(store.operations.execute({ action: 'list', runId: 'run-1' })).toMatchObject([{ state: 'dispatched' }])
      controller.abort()
      return { id: 'A' }
    }
    const input = { runId: 'run-1', threadId: 'thread-1', toolCallId: 'write-A', toolName: 'write_item', operationKey: 'logical-write-A',
      input: { id: 'A' }, signal: controller.signal, approvalMode: 'full_access' as const, explicitUserIntent: true }
    expect(await durableGateway(write).execute(input)).toMatchObject({ status: 'completed', observation: { output: { id: 'A' } } })
    store = new AgentPersistenceStore(database)
    expect(await durableGateway(write).execute({ ...input, toolCallId: 'reconnected-call', signal: new AbortController().signal }))
      .toMatchObject({ status: 'completed', cached: true, observation: { source: { toolCallId: 'write-A' } } })
    expect(calls).toBe(1)
  })

  it('正式 Gateway 中写 A 超时后读 B 不能解除未知操作保护', async () => {
    store.createRun('run-1', request(), state())
    let writes = 0
    const gateway = durableGateway(async () => { writes++; throw new Error('TIMEOUT') })
    const call = { runId: 'run-1', threadId: 'thread-1', toolCallId: 'write-A', toolName: 'write_item',
      input: { id: 'A' }, signal: new AbortController().signal, approvalMode: 'full_access' as const, explicitUserIntent: true }
    await expect(gateway.execute(call)).rejects.toThrow()
    expect(await gateway.execute({ ...call, toolCallId: 'read-B', toolName: 'read_item', input: { id: 'B' } })).toMatchObject({ status: 'completed' })
    await expect(gateway.execute({ ...call, toolCallId: 'new-write' })).rejects.toThrow('未核对的写入')
    expect(writes).toBe(1)
  })

  it('派发前持久化操作身份，重建 store 后复用原身份且不重复派发', () => {
    store.createRun('run-1', request(), state())
    const prepared = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: operationIntent() }))
    store = new AgentPersistenceStore(database)
    expect(store.operations.execute({ action: 'prepare', intent: operationIntent() })).toMatchObject({ operationId: prepared.operationId, state: 'prepared' })
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: prepared.operationId })
    store.operations.markInterrupted()
    expect(store.operations.get(prepared.operationId)?.state).toBe('unknown')
    expect(() => store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: prepared.operationId })).toThrow('OPERATION_REPLAY_BLOCKED')
    expect(() => store.operations.execute({ action: 'prepare', intent: { ...operationIntent(), inputDigest: 'c'.repeat(64) } })).toThrow('OPERATION_CONFLICT')
    expect(store.loadState('run-1')?.runId).toBe('run-1')
  })

  it('业务回执先落盘；超时、重启及事件发送失败不能覆盖实际结果', () => {
    store.createRun('run-1', request(), state())
    const prepared = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: operationIntent() }))
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: prepared.operationId })
    store.operations.execute({ action: 'fail', runId: 'run-1', operationId: prepared.operationId, state: 'unknown', error: 'timeout', effects: [] })
    store.operations.recordOutput(prepared.operationId, { saved: true })
    store = new AgentPersistenceStore(database)
    store.operations.execute({ action: 'fail', runId: 'run-1', operationId: prepared.operationId, state: 'unknown', error: 'event disconnected', effects: [] })
    expect(store.operations.get(prepared.operationId)).toMatchObject({ state: 'completed', output: { saved: true } })
  })

  it('终态后迟到回执仍投影到历史结果；保存旧状态不能擦除事实，精确验证才关闭缺口', () => {
    store.createRun('run-1', request(), state())
    const prepared = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: operationIntent() }))
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: prepared.operationId })
    store.operations.execute({ action: 'fail', runId: 'run-1', operationId: prepared.operationId, state: 'unknown', error: 'timeout', effects: [] })
    store.saveState(state('cancelled'))
    const effect = { effect: 'update' as const, entityTypes: ['canvas.node'], propertyIds: [],
      targetRefs: operationIntent().targets, count: 1, verified: false, evidence: [] }
    store.operations.recordOutput(prepared.operationId, { saved: true }, [effect])
    store = new AgentPersistenceStore(database)
    store.saveState({ ...state('cancelled'), workingSummary: createAgentWorkingSummary('修改 A') })
    const restored = store.loadState('run-1')!
    expect(restored.status).toBe('cancelled')
    expect(restored.executionOutcome).toMatchObject({ effects: [effect],
      facts: { completion: 'needs_check', resultRefs: operationIntent().targets,
        unresolved: [{ operationId: prepared.operationId, conditionId: 'formal_result' }] } })
    expect(restored.workingSummary?.executionFacts).toEqual(restored.executionOutcome.facts)
    store.operations.execute({ action: 'verify', runId: 'run-1', verification: {
      operationId: prepared.operationId, conditionId: 'formal_result', targets: operationIntent().targets,
      status: 'passed', evidence: ['原目标正式回读'], verifiedAt: new Date().toISOString(),
    } })
    expect(store.loadState('run-1')?.executionOutcome).toMatchObject({ effects: [{ ...effect, verified: true }],
      facts: { completion: 'completed', verificationStatus: 'passed', unresolved: [] } })
  })

  it('主进程领取尝试后拒绝重复传输；仅确认未执行才允许新尝试并保留授权历史', () => {
    store.createRun('run-1', request(), state())
    const prepared = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: operationIntent() }))
    expect(() => store.operations.recordOutput(prepared.operationId, { saved: true })).toThrow('尚未派发')
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: prepared.operationId })
    store.operations.claimExecution('run-1', prepared.operationId)
    expect(() => new AgentPersistenceStore(database).operations.claimExecution('run-1', prepared.operationId)).toThrow('OPERATION_REPLAY_BLOCKED')
    store.operations.execute({ action: 'fail', runId: 'run-1', operationId: prepared.operationId, state: 'not_executed', error: '执行器入口确认未开始', effects: [] })
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: prepared.operationId, authorizationDigest: 'd'.repeat(64), policyVersion: 2 })
    store.operations.claimExecution('run-1', prepared.operationId)
    expect(store.operations.get(prepared.operationId)).toMatchObject({ attempt: 2,
      executionClaim: { attempt: 2 }, attempts: [{ attempt: 1 }, { attempt: 2, policyVersion: 2, authorizationDigest: 'd'.repeat(64) }] })
  })

  it('领域保存与操作关联同事务提交，重建后能找回无最终回执的实际目标', () => {
    store.createRun('run-1', request(), state())
    const prepared = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: operationIntent() }))
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: prepared.operationId })
    store.operations.claimExecution('run-1', prepared.operationId)
    const correlation = { operationId: prepared.operationId, boundaryId: 'save-1',
      targets: [{ kind: 'canvas.node', id: 'project:created' }] }
    const target = { kind: 'canvas.project', id: 'project' }
    database.exec('CREATE TABLE business_snapshot (value TEXT)')
    expect(() => store.operations.recordPersistence(correlation, target, 'c'.repeat(64))).toThrow('NOT_ATOMIC')
    expect(() => database.transaction(() => {
      database.prepare('INSERT INTO business_snapshot(value) VALUES (?)').run('created')
      store.operations.recordPersistence(correlation, target, 'c'.repeat(64))
      throw new Error('before commit')
    })()).toThrow('before commit')
    expect(database.prepare('SELECT * FROM business_snapshot').all()).toEqual([])
    expect(store.operations.get(prepared.operationId)?.persistenceReceipts).toEqual([])
    database.transaction(() => {
      database.prepare('INSERT INTO business_snapshot(value) VALUES (?)').run('created')
      store.operations.recordPersistence(correlation, target, 'c'.repeat(64))
    })()
    store = new AgentPersistenceStore(database)
    store.operations.markInterrupted()
    expect(store.operations.get(prepared.operationId)).toMatchObject({ state: 'unknown',
      persistenceReceipts: [{ targets: correlation.targets, storageTarget: target }] })
    expect(() => database.transaction(() => store.operations.recordPersistence(correlation, target, 'd'.repeat(64)))())
      .toThrow('OPERATION_PERSISTENCE_CONFLICT')
    expect(database.prepare('SELECT * FROM business_snapshot').all()).toEqual([{ value: 'created' }])
  })

  it('同域其他对象的验证不能绑定到原操作，核对记录不改变未知执行事实', () => {
    store.createRun('run-1', request(), state())
    const prepared = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: operationIntent() }))
    const verification = { operationId: prepared.operationId, conditionId: 'saved',
      targets: [{ kind: 'canvas.node', id: 'project:B' }], status: 'passed' as const,
      evidence: ['B is saved'], verifiedAt: new Date().toISOString() }
    expect(() => store.operations.execute({ action: 'verify', runId: 'run-1', verification })).toThrow('OPERATION_VERIFICATION_MISMATCH')
    expect(store.operations.get(prepared.operationId)?.verifications).toMatchObject([{ status: 'pending', targets: [{ id: 'project:A' }] }])
  })

  it('文件保存意图只定位原文件，只有匹配的原子文件回执才补充保存事实', () => {
    store.createRun('run-1', request(), state())
    const prepared = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: operationIntent() }))
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: prepared.operationId })
    store.operations.claimExecution('run-1', prepared.operationId)
    store.operations.bindTransport({ operationId: prepared.operationId, callId: 'file-save', runId: 'run-1',
      toolCallId: prepared.toolCallId, idempotencyKey: prepared.key, webContentsId: 5, rendererSessionId: 'original' })
    const correlation = { operationId: prepared.operationId, boundaryId: 'file-boundary', targets: [{ kind: 'image_edit.document', id: 'v3:original' }] }
    const target = { kind: 'image_edit.document', id: 'v3:original', revision: 2 }
    store.operations.prepareFilePersistence(correlation, target, 'c'.repeat(64), 5)
    const restarted = new AgentPersistenceStore(database).operations
    restarted.markInterrupted()
    expect(restarted.get(prepared.operationId)).toMatchObject({ state: 'unknown', persistenceReceipts: [],
      persistenceIntents: [{ storageTarget: target }] })
    const receipt = { ...correlation, storageTarget: target, digest: 'c'.repeat(64), persistedAt: new Date().toISOString() }
    expect(() => restarted.confirmFilePersistence({ ...receipt, digest: 'd'.repeat(64) })).toThrow('OPERATION_PERSISTENCE_CONFLICT')
    expect(() => restarted.confirmFilePersistence({ ...receipt, storageTarget: { ...target, id: 'v3:other' } })).toThrow('OPERATION_PERSISTENCE_CONFLICT')
    restarted.confirmFilePersistence(receipt)
    restarted.confirmFilePersistence(receipt)
    expect(restarted.get(prepared.operationId)?.persistenceReceipts).toHaveLength(1)
    expect(restarted.get(prepared.operationId)?.state).toBe('unknown')
    expect(() => restarted.execute({ action: 'fail', runId: 'run-1', operationId: prepared.operationId,
      state: 'not_executed', error: '不能覆盖实际保存', effects: [] })).toThrow('OPERATION_FACT_CONFLICT')
  })

  it('失败验证不能缩减原目标集合；读取来源 B 也不能代替被修改目标 A', () => {
    store.createRun('run-1', request(), state())
    const target = { kind: 'canvas.node', id: 'project:A' }
    const source = { kind: 'canvas.node', id: 'project:B' }
    const prepared = operationRecordSchema.parse(store.operations.execute({ action: 'prepare',
      intent: { ...operationIntent(), targets: [target, source], verificationTargets: [target] } }))
    store.operations.execute({ action: 'verify', runId: 'run-1', verification: {
      operationId: prepared.operationId, conditionId: 'formal_result', targets: [], status: 'failed',
      evidence: ['读取失败'], verifiedAt: new Date().toISOString(),
    } })
    expect(store.operations.get(prepared.operationId)?.verifications[0].targets).toEqual([target])
    expect(() => store.operations.execute({ action: 'verify', runId: 'run-1', verification: {
      operationId: prepared.operationId, conditionId: 'formal_result', targets: [source], status: 'passed',
      evidence: ['B 可以读取'], verifiedAt: new Date().toISOString(),
    } })).toThrow('OPERATION_VERIFICATION_INCOMPLETE')
  })

  it('旧尝试和过期核对不能覆盖当前验证；未执行的操作不能通过', () => {
    store.createRun('run-1', request(), state())
    const prepared = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: operationIntent() }))
    const verification = { operationId: prepared.operationId, conditionId: 'formal_result', targets: prepared.targets,
      status: 'passed' as const, evidence: ['原对象状态已核对'], verifiedAt: new Date().toISOString() }
    expect(() => store.operations.execute({ action: 'verify', runId: 'run-1', verification })).toThrow('OPERATION_VERIFICATION_NOT_EXECUTED')
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: prepared.operationId })
    expect(() => store.operations.execute({ action: 'verify', runId: 'run-1', verification: {
      ...verification, verifiedAt: new Date(Date.parse(prepared.createdAt) - 1).toISOString(),
    } })).toThrow('OPERATION_VERIFICATION_STALE')
    const latest = new Date(Date.now() + 1_000).toISOString()
    store.operations.execute({ action: 'verify', runId: 'run-1', verification: { ...verification, status: 'failed', verifiedAt: latest } })
    expect(() => store.operations.execute({ action: 'verify', runId: 'run-1', verification: {
      ...verification, verifiedAt: new Date().toISOString(),
    } })).toThrow('OPERATION_VERIFICATION_STALE')
    expect(store.operations.get(prepared.operationId)?.verifications[0].status).toBe('failed')
  })

  it('执行前验证计划绑定原操作，重启保留目标与属性条件且拒绝篡改', () => {
    store.createRun('run-1', request(), state())
    const prepared = operationRecordSchema.parse(store.operations.execute({ action: 'prepare', intent: operationIntent() }))
    store.operations.execute({ action: 'dispatch', runId: 'run-1', operationId: prepared.operationId })
    store.operations.claimExecution('run-1', prepared.operationId)
    store.operations.bindTransport({ operationId: prepared.operationId, callId: 'preparation', runId: 'run-1',
      toolCallId: prepared.toolCallId, idempotencyKey: prepared.key, webContentsId: 5, rendererSessionId: 'original' })
    const preparation = { planRef: 'plan:12345678901234567890', preparedAt: new Date().toISOString(),
      conditions: [{ kind: 'property_equals' as const, target: { kind: 'canvas.node', id: 'project:A' },
        propertyId: 'canvas.node.display_name', expected: '用户指定结果' }] }
    expect(() => store.operations.recordExecutionPreparation(prepared.operationId, preparation, 6)).toThrow('OPERATION_OWNER_INVALID')
    store.operations.recordExecutionPreparation(prepared.operationId, preparation, 5)
    store = new AgentPersistenceStore(database)
    expect(store.operations.get(prepared.operationId)?.verificationPlans).toEqual([preparation])
    expect(() => store.operations.recordExecutionPreparation(prepared.operationId, { ...preparation,
      conditions: [{ ...preparation.conditions[0], expected: '改为另一个值' }] }, 5)).toThrow('OPERATION_VERIFICATION_PLAN_CONFLICT')
    store.operations.markInterrupted()
    expect(() => store.operations.recordExecutionPreparation(prepared.operationId, { ...preparation,
      planRef: 'plan:23456789012345678901' }, 5)).toThrow('OPERATION_VERIFICATION_PLAN_CLOSED')
  })

  it('保存并恢复运行、事件、请求与大结果引用', () => {
    const initial = state()
    store.createRun('run-1', request(), initial)
    const event = agentEventSchema.parse({
      schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
      eventId: 'event-1',
      sequence: 1,
      occurredAt: new Date().toISOString(),
      runId: 'run-1',
      type: 'RunStarted',
      threadId: 'thread-1',
    })
    store.appendEvent(event)
    store.saveArtifact('run-1', {
      artifactRef: 'artifact:1',
      source: 'query:call-1',
      dataClasses: ['C1'],
      createdAt: new Date().toISOString(),
      originalBytes: 12,
      payload: { ok: true },
    })

    expect(store.loadState('run-1')).toMatchObject({ runId: 'run-1', status: 'running' })
    expect(store.loadEvents('run-1')).toEqual([event])
    expect(store.loadArtifact('artifact:1')).toMatchObject({ payload: { ok: true } })
    expect(store.loadRequest('run-1')).not.toHaveProperty('userInstructions')
    expect(store.listRuns('thread-1')).toMatchObject([{
      runId: 'run-1',
      recoveryStatus: 'none',
      canRetry: false,
    }])
  })

  it('创建会话时立即用首条用户消息生成带省略号的短标题', () => {
    const goal = '优化智能助手历史记录的标题展示，并确保用户发送后立即可以看到历史记录'
    const goalWithWhitespace = `  ${goal.slice(0, 12)}\n${goal.slice(12)}  `
    const normalizedGoal = goalWithWhitespace.replace(/\s+/g, ' ').trim()
    const longRequest = agentStartRunRequestSchema.parse({
      ...request(),
      goal: goalWithWhitespace,
    })

    store.createRun('run-1', longRequest, state())

    expect(store.listThreads()[0]?.title).toBe(
      `${Array.from(normalizedGoal).slice(0, 24).join('')}…`
    )
  })

  it('删除对话时级联清理运行与会话数据，并保留其他对话', () => {
    store.createRun('run-1', request(), state('completed'))
    store.saveArtifact('run-1', {
      artifactRef: 'artifact:delete-test',
      source: 'query:delete-test',
      dataClasses: ['C1'],
      createdAt: new Date().toISOString(),
      originalBytes: 12,
      payload: { ok: true },
    })
    const otherRequest = agentStartRunRequestSchema.parse({
      ...request(),
      threadId: 'thread-2',
      goal: '需要保留的对话',
    })
    const otherState = agentRunStateSchema.parse({
      ...state('completed'),
      runId: 'run-2',
      threadId: 'thread-2',
    })
    store.createRun('run-2', otherRequest, otherState)

    expect(store.threadDeletion.delete(['thread-1'])).toEqual(['thread-1'])
    expect(store.loadState('run-1')).toBeNull()
    expect(store.loadArtifact('artifact:delete-test')).toBeNull()
    expect(store.listThreads()).toMatchObject([{ threadId: 'thread-2' }])
    expect(store.threadDeletion.delete(['thread-1'])).toEqual([])
  })

  it('保存点与 session head/checkpoint 幂等对齐并在终局 settled', () => {
    const running = state()
    running.turn = 1
    store.createRun('run-1', request(), running)
    const input = {
      version: AGENT_SAVE_POINT_VERSION,
      stage: 'before_model' as const,
      snapshot: turnSnapshot(),
      state: running,
      idempotencyKey: 'before-model:run-1:1',
    }
    const first = store.appendSavePoint(input)
    const duplicate = store.appendSavePoint(input)
    expect(duplicate).toEqual(first)
    expect(first.snapshot.sessionHeadSequence).toBe(1)
    expect(first.stateSequence).toBe(running.sequence)
    expect(store.countSavePoints('run-1')).toBe(1)

    const completed = state('completed')
    completed.turn = 1
    completed.finalText = '完成'
    store.saveState(completed)
    store.appendTerminalMessage(completed)
    store.appendSettledSavePoint(completed)
    expect(store.loadLatestSavePoint('run-1')).toMatchObject({
      stage: 'settled',
      snapshot: { sessionHeadSequence: 2 },
    })
    expect(store.countSavePoints('run-1')).toBe(2)
  })

  it('按 thread sequence 幂等追加会话消息并投影多轮历史', () => {
    const first = state('completed')
    first.finalText = '第一轮回答'
    store.createRun('run-1', request(), first)
    store.appendSessionInternal({
      runId: 'run-1',
      threadId: 'thread-1',
      turn: 1,
      kind: 'model_message',
      payload: { message: { role: 'assistant', content: '第一轮回答' } },
      idempotencyKey: 'run-1:model-final',
    })
    store.appendTerminalMessage(first)
    store.appendTerminalMessage(first)

    const secondRequest = agentStartRunRequestSchema.parse({
      ...request(),
      goal: '继续，沿用第一轮约束',
    })
    const second = agentRunStateSchema.parse({
      ...state(),
      runId: 'run-2',
    })
    store.createRun('run-2', secondRequest, second)

    expect(store.loadTranscript('thread-1')).toMatchObject({
      headSequence: 4,
      coveredThroughSequence: 4,
      hasMore: false,
    })
    expect(store.loadTranscript('thread-1').entries.map((entry) => ({
      sequence: entry.sequence,
      kind: entry.kind,
      runId: entry.runId,
    }))).toEqual([
      { sequence: 1, kind: 'user_message', runId: 'run-1' },
      { sequence: 3, kind: 'assistant_message', runId: 'run-1' },
      { sequence: 4, kind: 'user_message', runId: 'run-2' },
    ])
    expect(store.projectConversation('thread-1', 'run-2')).toEqual({
      messages: [
        { role: 'user', content: '诊断生成失败' },
        { role: 'assistant', content: '第一轮回答' },
      ],
      sourceSequences: [1, 2],
    })
    expect(store.listThreads()).toMatchObject([{
      threadId: 'thread-1',
      messageCount: 3,
      lastRunId: 'run-2',
      lastRunGoal: '继续，沿用第一轮约束',
    }])
  })

  it('预算自动续跑创建子 Run 时不重复写入同一用户消息', () => {
    const exhausted = state('budget_exhausted')
    store.createRun('run-1', request(), exhausted)
    const continuation = agentRunStateSchema.parse({ ...state(), runId: 'run-2' })
    store.createRun('run-2', request(), continuation, 'run-1', { appendUserMessage: false })

    expect(store.loadTranscript('thread-1').entries.map((entry) => ({
      kind: entry.kind,
      runId: entry.runId,
    }))).toEqual([
      { kind: 'user_message', runId: 'run-1' },
    ])
    expect(store.projectConversation('thread-1', 'run-2').messages).toEqual([
      { role: 'user', content: '诊断生成失败' },
    ])
  })

  it('标题上下文只读取用户指令并通过阶段条件避免旧结果覆盖新标题', () => {
    store.createRun('run-1', request(), state())
    const firstContext = store.threadTitles.getContext({
      runId: 'run-1',
      threadId: 'thread-1',
    })
    expect(firstContext).toEqual({
      threadId: 'thread-1',
      currentTitle: '诊断生成失败',
      generationStage: 0,
      userMessageCount: 1,
      userInstructions: ['诊断生成失败'],
    })

    expect(store.threadTitles.update({
      runId: 'run-1',
      threadId: 'thread-1',
      title: '诊断生成失败',
      expectedStage: 0,
      nextStage: 1,
    })).toMatchObject({
      updated: true,
      generationStage: 1,
    })
    expect(store.threadTitles.update({
      runId: 'run-1',
      threadId: 'thread-1',
      title: '过期标题',
      expectedStage: 0,
      nextStage: 1,
    })).toMatchObject({
      updated: false,
      title: '诊断生成失败',
      generationStage: 1,
    })
  })

  it('会话分页无重复且新 thread 不会混入旧历史', () => {
    store.createRun('run-1', request(), state())
    const otherRequest = agentStartRunRequestSchema.parse({
      ...request(),
      threadId: 'thread-2',
      goal: '独立会话',
    })
    const otherState = agentRunStateSchema.parse({
      ...state(),
      runId: 'run-2',
      threadId: 'thread-2',
    })
    store.createRun('run-2', otherRequest, otherState)

    const firstPage = store.loadTranscript('thread-1', 0, 1)
    const nextPage = store.loadTranscript('thread-1', firstPage.coveredThroughSequence, 1)
    expect(firstPage.entries.map((entry) => entry.entryId)).not.toEqual(
      nextPage.entries.map((entry) => entry.entryId)
    )
    expect(store.projectConversation('thread-2')).toEqual({
      messages: [{ role: 'user', content: '独立会话' }],
      sourceSequences: [1],
    })
  })

  it('旧数据库消息在追加 migration 后以稳定顺序兼容读取', () => {
    database.exec(`
      DROP TABLE agent_session_entries;
      DELETE FROM app_schema_migrations WHERE version IN (6, 9);
    `)
    database.prepare(`
      INSERT INTO agent_threads(thread_id, title, created_at, updated_at, last_run_id)
      VALUES ('legacy-thread', '旧对话', 1000, 1001, NULL)
    `).run()
    const insertLegacy = database.prepare(`
      INSERT INTO agent_messages(message_id, thread_id, run_id, role, content, created_at)
      VALUES (?, 'legacy-thread', NULL, ?, ?, ?)
    `)
    insertLegacy.run('message-b', 'assistant', '旧回答', 1001)
    insertLegacy.run('message-a', 'user', '旧问题', 1000)

    runAgentSchemaMigrations(database)
    const migrated = new AgentPersistenceStore(database)
    const entries = migrated.loadTranscript('legacy-thread').entries

    expect(entries.map((entry) => ({
      sequence: entry.sequence,
      kind: entry.kind,
      payload: entry.payload,
    }))).toEqual([
      {
        sequence: 1,
        kind: 'user_message',
        payload: { content: '旧问题', legacy: true, contextVisible: true },
      },
      {
        sequence: 2,
        kind: 'assistant_message',
        payload: { content: '旧回答', legacy: true, contextVisible: true },
      },
    ])
  })

  it('尾部恢复返回最新两千条，并支持从已确认 sequence 增量补拉', () => {
    store.createRun('run-1', request(), state())
    database.transaction(() => {
      for (let sequence = 1; sequence <= 2_050; sequence += 1) {
        store.appendEvent(eventForSequence(sequence))
      }
    })()

    const tail = store.loadEvents('run-1')
    expect(tail).toHaveLength(2_000)
    expect(tail[0]?.sequence).toBe(51)
    expect(tail.at(-1)?.sequence).toBe(2_050)
    expect(tail.every((event, index) => index === 0 || event.sequence > tail[index - 1].sequence)).toBe(true)

    const page = store.loadEventsAfter('run-1', 1_998, 10)
    expect(page).toMatchObject({ oldestSequence: 1, latestSequence: 2_050 })
    expect(page.events.map((event) => event.sequence)).toEqual([
      1_999, 2_000, 2_001, 2_002, 2_003, 2_004, 2_005, 2_006, 2_007, 2_008,
    ])
  })

  it('一万个原始模型增量合并后只写入有界数量的 SQLite 事件', () => {
    store.createRun('run-1', request(), state())
    const stream = new AgentEventStream('run-1')
    stream.subscribe((event) => store.appendEvent(event))

    for (let index = 0; index < 10_000; index += 1) {
      stream.emit({ type: 'ModelDelta', stepId: 'step-1', text: '流' })
    }
    stream.emit({
      type: 'ModelCompleted',
      stepId: 'step-1',
      finishReason: 'stop',
      toolCallCount: 0,
      usage: {
        inputTokens: 1,
        inputNoCacheTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 10_000,
        textTokens: 10_000,
        reasoningTokens: 0,
        totalTokens: 10_001,
      },
    })

    const count = database.prepare(`
      SELECT COUNT(*) AS count FROM agent_events WHERE run_id = 'run-1'
    `).get() as { count: number }
    const events = store.loadEvents('run-1')
    expect(count.count).toBeLessThan(10)
    expect(events.filter((event) => event.type === 'ModelDelta').map((event) => event.text).join(''))
      .toBe('流'.repeat(10_000))
    expect(events.map((event) => event.sequence)).toEqual(
      events.map((_, index) => index + 1)
    )
  })

  it('应用重启后把未完成运行转为需要人工重试，不自动重放', () => {
    store.createRun('run-1', request(), state('waiting_tool'))

    expect(store.markInterruptedRuns()).toBe(1)
    expect(store.loadState('run-1')).toMatchObject({
      status: 'failed',
      error: { code: 'RECOVERY_REQUIRED', recovery: 'user_action' },
    })
    expect(store.listRuns('thread-1')[0]).toMatchObject({
      recoveryStatus: 'recovery_required',
      canRetry: true,
    })
    const events = store.loadEvents('run-1')
    expect(events[events.length - 1]).toMatchObject({ type: 'RunFailed' })
  })

  it('混合版本 checkpoint 仍以受校验 state_json 查看旧运行', () => {
    store.createRun('run-1', request(), state('completed'))
    database.prepare(`
      UPDATE agent_runs SET checkpoint_version = 'agent-checkpoint/v0', checkpoint_json = '{}'
      WHERE run_id = 'run-1'
    `).run()
    expect(new AgentPersistenceStore(database).loadState('run-1')).toMatchObject({
      runId: 'run-1', status: 'completed',
    })
  })

  it('migration 11 保留旧运行、对话、记忆关联与业务工程', () => {
    store.createRun('run-1', request(), state('completed'))
    database.prepare(`
      INSERT INTO agent_messages(message_id, thread_id, run_id, role, content, created_at)
      VALUES ('message-user', 'thread-1', 'run-1', 'user', '旧问题', 10),
             ('message-assistant', 'thread-1', 'run-1', 'assistant', '旧回答', 11),
             ('message-internal', 'thread-1', 'run-1', 'system_event', '内部事件', 12)
    `).run()
    database.prepare(`
      INSERT INTO agent_memories(
        memory_id, scope_type, scope_id, kind, content, source_run_id, source_label,
        sensitivity, status, conflict_key, expires_at, created_at, updated_at
      ) VALUES ('memory-1', 'global', NULL, 'fact', '保留的记忆', 'run-1', '测试',
                'C0', 'active', NULL, NULL, 10, 10)
    `).run()
    database.exec(`
      CREATE TABLE camera_stage_projects_test_sentinel (
        project_id TEXT PRIMARY KEY, payload TEXT NOT NULL
      );
      INSERT INTO camera_stage_projects_test_sentinel VALUES ('project-1', 'state-keyframes');
      DELETE FROM app_schema_migrations WHERE version = 11;
    `)

    runAgentSchemaMigrations(database)

    expect(database.prepare('SELECT COUNT(*) AS count FROM agent_runs').get()).toEqual({ count: 1 })
    expect(database.prepare(`
      SELECT role, content, run_id FROM agent_messages
      WHERE message_id IN ('message-user', 'message-assistant', 'message-internal')
      ORDER BY created_at
    `).all()).toEqual([
      { role: 'user', content: '旧问题', run_id: 'run-1' },
      { role: 'assistant', content: '旧回答', run_id: 'run-1' },
      { role: 'system_event', content: '内部事件', run_id: 'run-1' },
    ])
    expect(database.prepare(`
      SELECT content, source_run_id FROM agent_memories WHERE memory_id = 'memory-1'
    `).get()).toEqual({ content: '保留的记忆', source_run_id: 'run-1' })
    expect(database.prepare('SELECT * FROM camera_stage_projects_test_sentinel').get())
      .toEqual({ project_id: 'project-1', payload: 'state-keyframes' })
    expect(database.prepare(`
      SELECT last_run_id FROM agent_threads WHERE thread_id = 'thread-1'
    `).get()).toEqual({ last_run_id: 'run-1' })
  })

  it('v6 数据库增量迁移保存 waiting_external 运行且重启不误判为中断', () => {
    store.createRun('run-1', request(), state('waiting_external'))
    database.exec(`
      DROP TABLE agent_external_waits;
      DROP TABLE agent_generation_status_events;
      DROP TABLE agent_save_points;
      DELETE FROM app_schema_migrations WHERE version IN (7, 8);
    `)
    runAgentSchemaMigrations(database)
    const migrated = new AgentPersistenceStore(database)
    expect(migrated.markInterruptedRuns()).toBe(0)
    expect(migrated.loadState('run-1')).toMatchObject({ status: 'waiting_external' })
    expect(database.prepare(`
      SELECT COUNT(*) AS count FROM app_schema_migrations WHERE version IN (7, 8)
    `).get()).toEqual({ count: 2 })
  })

  it('未来检查点版本不会导致崩溃，而是进入安全恢复状态', () => {
    store.createRun('run-1', request(), state('paused'))
    database.prepare(`
      UPDATE agent_runs SET checkpoint_version = 'agent-checkpoint/v999' WHERE run_id = 'run-1'
    `).run()

    expect(store.loadState('run-1')).toMatchObject({
      status: 'failed',
      error: { code: 'CHECKPOINT_VERSION_MISMATCH' },
    })
    expect(store.listRuns('thread-1')[0].recoveryStatus).toBe('recovery_required')
  })

  it('中断检查点保留结构化目标并标记未知写入需要先验证', () => {
    const interrupted = state('waiting_tool')
    interrupted.workingSummary = agentWorkingSummarySchema.parse({
      ...createAgentWorkingSummary('创建一个生成任务'),
      activeStep: {
        stepId: 'call-write',
        title: '创建生成任务',
        status: 'active',
        toolName: 'create_visible_generation_task',
        toolCategory: 'generation',
        readOnly: false,
        idempotent: true,
        summary: '',
        evidence: [],
        startedAt: new Date().toISOString(),
        completedAt: null,
      },
    })
    store.createRun('run-1', request(), interrupted)

    store.markInterruptedRuns()

    expect(store.loadState('run-1')).toMatchObject({
      workingSummary: {
        goal: '创建一个生成任务',
        activeStep: null,
        recovery: {
          mode: 'verify_before_write',
          toolName: 'create_visible_generation_task',
        },
      },
    })
  })
})
