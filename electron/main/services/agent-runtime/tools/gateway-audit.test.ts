import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentPermissionAuditEvent, AgentPermissionAuditFact } from '../../../../../src/core/assistant/permissionAudit'
import type { AgentApprovalMode } from '../../../../../src/core/assistant/runtimeContracts'
import type { AgentDataClass, AgentToolRisk } from '../../../../../src/core/assistant/toolContracts'
import { defineAgentTool } from './define-tool'
import { AgentToolGateway } from './gateway'
import { AgentToolRegistry } from './registry'

function hostContext(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-1',
    revision: 1,
    scopeRevisions: { navigation: 0, generation: 1, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: [],
    capturedAt: new Date().toISOString(),
  }
}

interface FixtureOptions {
  risk?: AgentToolRisk
  readOnly?: boolean
  destructive?: boolean
  openWorld?: boolean
  previewDataClasses?: AgentDataClass[]
  outputDataClasses?: AgentDataClass[]
  executionError?: string
  beforeAuditAppend?: (fact: AgentPermissionAuditFact) => Promise<void>
}

function fixture(options: FixtureOptions = {}): {
  gateway: AgentToolGateway
  calls: string[]
  facts: AgentPermissionAuditFact[]
  failEvents: Set<AgentPermissionAuditEvent>
} {
  const calls: string[] = []
  const facts: AgentPermissionAuditFact[] = []
  const failEvents = new Set<AgentPermissionAuditEvent>()
  const registry = new AgentToolRegistry()
  const risk = options.risk ?? 'R0'
  const readOnly = options.readOnly ?? true
  const previewDataClasses = options.previewDataClasses ?? ['C1']
  registry.register(defineAgentTool({
    name: 'audited_tool', version: 1, title: '审计工具', description: '验证权限审计。',
    category: 'test', side: 'backend', risk, permission: 'test:execute', readOnly,
    destructive: options.destructive ?? false, openWorld: options.openWorld ?? false,
    idempotent: true, timeoutMs: 1_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: true, supportsUndo: false, requiredContext: [],
    inputSchema: z.object({ value: z.string().min(1) }).strict(),
    outputSchema: z.object({ value: z.string() }).strict(),
    aiInputSchema: { type: 'object', properties: { value: { type: 'string' } } },
    preview: (input) => ({
      title: '审计工具预览', summary: `处理 ${input.value.length} 个字符`,
      targetIds: { valueId: input.value }, reversible: false,
      dataClasses: previewDataClasses,
      ...(previewDataClasses.includes('C2') ? { destination: '当前模型上下文' } : {}),
    }),
    execute: async (input) => {
      calls.push(input.value)
      if (options.executionError) throw new Error(options.executionError)
      return { value: input.value }
    },
    concurrencyKey: () => 'audited',
    targetIds: (input) => ({ valueId: input.value }),
    dataClasses: () => options.outputDataClasses ?? ['C1'],
    summarize: () => '审计工具完成',
  }))
  return {
    gateway: new AgentToolGateway({
      registry,
      getHostContext: hostContext,
      appendPermissionAudit: async (fact) => {
        await options.beforeAuditAppend?.(fact)
        if (failEvents.has(fact.event)) throw new Error('AUDIT_SINK_FAILED')
        facts.push(fact)
      },
    }),
    calls,
    facts,
    failEvents,
  }
}

function request(
  value: string,
  mode: AgentApprovalMode,
  approvalId?: string,
  authorization?:
    | { source: 'approved_workflow'; parentToolCallId: string }
    | { source: 'approved_program'; parentToolCallId: string }
    | { source: 'approved_action_group'; parentToolCallId?: never }
) {
  return {
    runId: 'run-1', threadId: 'thread-1', toolCallId: 'call-1',
    toolName: 'audited_tool', input: { value }, approvalId, approvalMode: mode,
    explicitUserIntent: true, signal: new AbortController().signal,
    authorizationSource: authorization?.source,
    parentToolCallId: authorization?.parentToolCallId,
  }
}

describe('AgentToolGateway permission audit', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('记录请求、批准、消费和完成，且事实不包含原始参数与预览正文', async () => {
    const current = fixture({ risk: 'R2', readOnly: false })
    const pending = await current.gateway.execute(request('raw-secret-probe', 'ask'))
    if (pending.status !== 'approval_required') throw new Error('expected approval')
    await current.gateway.resolveApproval(pending.approval.approvalId, 'run-1', 'approve')
    await current.gateway.execute(request('raw-secret-probe', 'ask', pending.approval.approvalId))

    expect(current.facts.map((fact) => fact.event)).toEqual([
      'approval_requested', 'approved', 'consumed', 'execution_completed',
    ])
    expect(JSON.stringify(current.facts)).not.toContain('raw-secret-probe')
    expect(JSON.stringify(current.facts)).not.toContain('审计工具预览')
  })

  it('记录自动放行、执行失败和幂等缓存', async () => {
    const success = fixture()
    await success.gateway.execute(request('cached', 'assistant_decides'))
    const cached = await success.gateway.execute(request('cached', 'assistant_decides'))
    expect(cached).toMatchObject({ status: 'completed', cached: true })
    expect(success.calls).toEqual(['cached'])
    expect(success.facts.map((fact) => fact.event)).toEqual([
      'auto_allowed', 'execution_completed', 'execution_cached',
    ])

    const failed = fixture({ executionError: '[CONFLICT] 测试失败' })
    await expect(failed.gateway.execute(request('failed', 'assistant_decides')))
      .rejects.toMatchObject({ code: 'CONFLICT' })
    expect(failed.facts.map((fact) => fact.event)).toEqual([
      'auto_allowed', 'execution_failed',
    ])
  })

  it('记录拒绝、过期和审批绑定失败', async () => {
    const rejected = fixture({ risk: 'R2', readOnly: false })
    const rejectPending = await rejected.gateway.execute(request('reject', 'ask'))
    if (rejectPending.status !== 'approval_required') throw new Error('expected approval')
    await rejected.gateway.resolveApproval(rejectPending.approval.approvalId, 'run-1', 'reject')
    expect(rejected.facts.map((fact) => fact.event)).toEqual(['approval_requested', 'rejected'])

    const expired = fixture({ risk: 'R2', readOnly: false })
    const expirePending = await expired.gateway.execute(request('expire', 'ask'))
    if (expirePending.status !== 'approval_required') throw new Error('expected approval')
    await expired.gateway.expireApproval(expirePending.approval.approvalId, 'run-1')
    expect(expired.facts.map((fact) => fact.event)).toEqual(['approval_requested', 'expired'])

    const drift = fixture({ risk: 'R2', readOnly: false })
    const driftPending = await drift.gateway.execute(request('original', 'ask'))
    if (driftPending.status !== 'approval_required') throw new Error('expected approval')
    await drift.gateway.resolveApproval(driftPending.approval.approvalId, 'run-1', 'approve')
    await expect(drift.gateway.execute(request('changed', 'ask', driftPending.approval.approvalId)))
      .rejects.toMatchObject({ code: 'APPROVAL_INVALID' })
    expect(drift.facts.map((fact) => fact.event)).toEqual([
      'approval_requested', 'approved', 'binding_failed',
    ])
    expect(drift.calls).toHaveLength(0)
  })

  it('截止后决策与到期处理竞争时只记录一次过期事实', async () => {
    vi.useFakeTimers()
    const current = fixture({ risk: 'R2', readOnly: false })
    const pending = await current.gateway.execute(request('expired-race', 'ask'))
    if (pending.status !== 'approval_required') throw new Error('expected approval')

    await vi.advanceTimersByTimeAsync(5 * 60 * 1_000 + 1)
    await expect(current.gateway.resolveApproval(
      pending.approval.approvalId,
      'run-1',
      'approve'
    )).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED' })
    await expect(current.gateway.expireApproval(
      pending.approval.approvalId,
      'run-1'
    )).resolves.toBe('expired')
    await expect(current.gateway.execute(request(
      'expired-race',
      'ask',
      pending.approval.approvalId
    ))).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED' })

    expect(current.facts.map((fact) => fact.event)).toEqual([
      'approval_requested',
      'expired',
    ])
  })

  it('受保护工具在请求、自动放行或消费审计失败时不执行', async () => {
    const approvalRequest = fixture({ risk: 'R2', readOnly: false })
    approvalRequest.failEvents.add('approval_requested')
    await expect(approvalRequest.gateway.execute(request('request-fail', 'ask')))
      .rejects.toMatchObject({ code: 'PERMISSION_AUDIT_UNAVAILABLE' })
    expect(approvalRequest.calls).toHaveLength(0)

    const autoAllowed = fixture({ risk: 'R1', readOnly: false })
    autoAllowed.failEvents.add('auto_allowed')
    await expect(autoAllowed.gateway.execute(request('auto-fail', 'full_access')))
      .rejects.toMatchObject({ code: 'PERMISSION_AUDIT_UNAVAILABLE' })
    expect(autoAllowed.calls).toHaveLength(0)

    const approved = fixture({ risk: 'R2', readOnly: false })
    const approvePending = await approved.gateway.execute(request('approve-fail', 'ask'))
    if (approvePending.status !== 'approval_required') throw new Error('expected approval')
    approved.failEvents.add('approved')
    await expect(approved.gateway.resolveApproval(
      approvePending.approval.approvalId,
      'run-1',
      'approve'
    )).rejects.toMatchObject({ code: 'PERMISSION_AUDIT_UNAVAILABLE' })
    expect(approved.calls).toHaveLength(0)
    approved.failEvents.clear()
    await approved.gateway.resolveApproval(approvePending.approval.approvalId, 'run-1', 'approve')

    const consumed = fixture({ risk: 'R2', readOnly: false })
    const pending = await consumed.gateway.execute(request('consume-fail', 'ask'))
    if (pending.status !== 'approval_required') throw new Error('expected approval')
    await consumed.gateway.resolveApproval(pending.approval.approvalId, 'run-1', 'approve')
    consumed.failEvents.add('consumed')
    await expect(consumed.gateway.execute(request('consume-fail', 'ask', pending.approval.approvalId)))
      .rejects.toMatchObject({ code: 'PERMISSION_AUDIT_UNAVAILABLE' })
    expect(consumed.calls).toHaveLength(0)
    consumed.failEvents.clear()
    await consumed.gateway.execute(request('consume-fail', 'ask', pending.approval.approvalId))
    expect(consumed.calls).toEqual(['consume-fail'])
  })

  it('拒绝与过期在审计失败时仍保持 fail-closed', async () => {
    const rejected = fixture({ risk: 'R2', readOnly: false })
    const rejectPending = await rejected.gateway.execute(request('reject-audit-fail', 'ask'))
    if (rejectPending.status !== 'approval_required') throw new Error('expected approval')
    rejected.failEvents.add('rejected')
    await expect(rejected.gateway.resolveApproval(
      rejectPending.approval.approvalId,
      'run-1',
      'reject'
    )).resolves.toBe('rejected')
    await expect(rejected.gateway.execute(request(
      'reject-audit-fail', 'ask', rejectPending.approval.approvalId
    ))).rejects.toMatchObject({ code: 'APPROVAL_REJECTED' })
    expect(rejected.calls).toHaveLength(0)

    const expired = fixture({ risk: 'R2', readOnly: false })
    const expirePending = await expired.gateway.execute(request('expire-audit-fail', 'ask'))
    if (expirePending.status !== 'approval_required') throw new Error('expected approval')
    expired.failEvents.add('expired')
    await expect(expired.gateway.expireApproval(expirePending.approval.approvalId, 'run-1'))
      .resolves.toBe('expired')
    await expect(expired.gateway.execute(request(
      'expire-audit-fail', 'ask', expirePending.approval.approvalId
    ))).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED' })
    expect(expired.calls).toHaveLength(0)
  })

  it('执行成功后的审计失败保留成功 ledger，重试只读缓存不重放副作用', async () => {
    const current = fixture({ risk: 'R1', readOnly: false })
    current.failEvents.add('execution_completed')
    await expect(current.gateway.execute(request('write-once', 'full_access')))
      .rejects.toMatchObject({ code: 'PERMISSION_AUDIT_UNAVAILABLE' })
    expect(current.calls).toEqual(['write-once'])

    current.failEvents.clear()
    const cached = await current.gateway.execute(request('write-once', 'full_access'))
    expect(cached).toMatchObject({ status: 'completed', cached: true })
    expect(current.calls).toEqual(['write-once'])
    expect(current.facts.map((fact) => fact.event)).toContain('execution_cached')

    current.failEvents.add('execution_cached')
    await expect(current.gateway.execute(request('write-once', 'full_access')))
      .rejects.toMatchObject({ code: 'PERMISSION_AUDIT_UNAVAILABLE' })
    expect(current.calls).toEqual(['write-once'])
  })

  it('低风险封闭只读允许审计降级，开放世界与工作流委托不允许', async () => {
    const safeRead = fixture({ risk: 'R1', readOnly: true })
    safeRead.failEvents.add('auto_allowed')
    safeRead.failEvents.add('execution_completed')
    await expect(safeRead.gateway.execute(request('safe-read', 'assistant_decides')))
      .resolves.toMatchObject({ status: 'completed' })
    expect(safeRead.calls).toEqual(['safe-read'])

    const workflowRead = fixture({ risk: 'R1', readOnly: true })
    workflowRead.failEvents.add('auto_allowed')
    await expect(workflowRead.gateway.execute(request(
      'workflow-read',
      'full_access',
      undefined,
      { source: 'approved_workflow', parentToolCallId: 'workflow-parent' }
    ))).rejects.toMatchObject({ code: 'PERMISSION_AUDIT_UNAVAILABLE' })
    expect(workflowRead.calls).toHaveLength(0)
  })

  it('写工具在授权审计等待期间取消时不会落副作用', async () => {
    let releaseAudit: () => void = () => undefined
    let markAuditStarted: () => void = () => undefined
    const auditStarted = new Promise<void>((resolve) => { markAuditStarted = resolve })
    const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve })
    const current = fixture({
      risk: 'R1',
      readOnly: false,
      beforeAuditAppend: async (fact) => {
        if (fact.event !== 'auto_allowed') return
        markAuditStarted()
        await auditGate
      },
    })
    const controller = new AbortController()
    const pending = current.gateway.execute({
      ...request('cancel-during-audit', 'full_access'),
      signal: controller.signal,
    })

    await auditStarted
    controller.abort('用户取消')
    releaseAudit()

    await expect(pending).rejects.toMatchObject({ code: 'CANCELLED' })
    expect(current.calls).toHaveLength(0)
    expect(current.facts.map((fact) => fact.event)).toEqual(['auto_allowed'])
  })

  it('结果数据级别不能高于预览声明', async () => {
    const current = fixture({
      risk: 'R0', readOnly: true,
      previewDataClasses: ['C1'], outputDataClasses: ['C2'],
    })
    await expect(current.gateway.execute(request('classification-drift', 'full_access')))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(current.calls).toEqual(['classification-drift'])
    expect(current.facts.map((fact) => fact.event)).toEqual([
      'auto_allowed', 'execution_failed',
    ])
  })

  it('C2 缓存每次读取仍需新审批，工具副作用不重复执行', async () => {
    const current = fixture({ risk: 'R1', readOnly: true, previewDataClasses: ['C2'] })
    const first = await current.gateway.execute(request('sensitive-page', 'full_access'))
    if (first.status !== 'approval_required') throw new Error('expected approval')
    await current.gateway.resolveApproval(first.approval.approvalId, 'run-1', 'approve')
    await current.gateway.execute(request('sensitive-page', 'full_access', first.approval.approvalId))

    const second = await current.gateway.execute(request('sensitive-page', 'full_access'))
    if (second.status !== 'approval_required') throw new Error('expected fresh approval')
    await current.gateway.resolveApproval(second.approval.approvalId, 'run-1', 'approve')
    const cached = await current.gateway.execute(request(
      'sensitive-page', 'full_access', second.approval.approvalId
    ))

    expect(cached).toMatchObject({ status: 'completed', cached: true })
    expect(current.calls).toEqual(['sensitive-page'])
    expect(current.facts.filter((fact) => fact.event === 'approval_requested')).toHaveLength(2)
    expect(current.facts.find((fact) => fact.event === 'approval_requested')).toMatchObject({
      authorization: { reasonCode: 'C2_REQUIRES_APPROVAL' },
      binding: { dataClasses: ['C2'] },
    })
    expect(current.facts.find((fact) => fact.event === 'approval_requested')
      ?.binding?.destinationDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(current.facts.map((fact) => fact.event)).toContain('execution_cached')
  })

  it('工作流委托审计明确保存来源和父调用，不保存子步骤原始输入', async () => {
    const current = fixture({ risk: 'R0', readOnly: true })
    await current.gateway.execute(request(
      'workflow-secret-input',
      'full_access',
      undefined,
      { source: 'approved_workflow', parentToolCallId: 'workflow-parent' }
    ))

    expect(current.facts[0]?.authorization).toMatchObject({
      source: 'approved_workflow',
      parentToolCallId: 'workflow-parent',
    })
    expect(JSON.stringify(current.facts)).not.toContain('workflow-secret-input')
  })

  it('组审批来源可独立审计且不伪造父工作流调用', async () => {
    const current = fixture({ risk: 'R0', readOnly: true })
    await current.gateway.execute(request(
      'compiled-group-input',
      'full_access',
      undefined,
      { source: 'approved_action_group' }
    ))

    expect(current.facts[0]?.authorization).toMatchObject({
      source: 'approved_action_group',
    })
    expect(current.facts[0]?.authorization.parentToolCallId).toBeUndefined()
  })

  it('受控程序委托审计保存程序父调用', async () => {
    const current = fixture({ risk: 'R0', readOnly: true })
    await current.gateway.execute(request(
      'program-input',
      'full_access',
      undefined,
      { source: 'approved_program', parentToolCallId: 'program-parent' }
    ))

    expect(current.facts[0]?.authorization).toMatchObject({
      source: 'approved_program',
      parentToolCallId: 'program-parent',
    })
  })
})
