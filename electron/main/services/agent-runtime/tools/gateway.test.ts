import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentPermissionAuditFact } from '../../../../../src/core/assistant/permissionAudit'
import type { AgentDataClass, AgentToolPreview } from '../../../../../src/core/assistant/toolContracts'
import { defineAgentTool } from './define-tool'
import { AgentToolGateway, AgentToolGatewayError } from './gateway'
import { AgentToolRegistry } from './registry'
import type { AgentToolDefinition } from './types'

function createContext(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-1',
    revision: 3,
    scopeRevisions: { navigation: 1, generation: 2, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: ['switch_workspace', 'create_visible_generation_task', 'get_host_context'],
    capturedAt: new Date().toISOString(),
  }
}

function createGateway(
  risk: 'R0' | 'R1' | 'R2' | 'R3' = 'R0',
  readOnly = risk === 'R0',
  failureMessage?: string,
  options: {
    destructive?: boolean
    preview?: (input: { value: string }) => AgentToolPreview
    getHostContext?: () => HostContextSnapshot
    outputDataClasses?: AgentDataClass[]
    appendPermissionAudit?: (fact: AgentPermissionAuditFact) => Promise<void>
  } = {}
): { gateway: AgentToolGateway; calls: string[]; audits: AgentPermissionAuditFact[] } {
  const calls: string[] = []
  const audits: AgentPermissionAuditFact[] = []
  const registry = new AgentToolRegistry()
  registry.register(defineAgentTool({
    name: 'test_tool',
    version: 1,
    title: '测试工具',
    description: '仅用于网关测试。',
    category: 'test',
    side: 'backend',
    risk,
    permission: 'test:execute',
    readOnly,
    destructive: options.destructive ?? false,
    openWorld: risk === 'R2' || risk === 'R3',
    idempotent: true,
    timeoutMs: 1_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: risk === 'R2' || risk === 'R3',
    supportsUndo: false,
    requiredContext: ['generation'],
    inputSchema: z.object({ value: z.string().min(1) }).strict(),
    outputSchema: z.object({ echoed: z.string() }).strict(),
    aiInputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
    preview: options.preview ?? ((input) => ({
      title: '执行测试工具', summary: `处理 ${input.value.length} 个字符。`,
      targetIds: { valueId: input.value }, reversible: false, dataClasses: ['C1'],
    })),
    execute: async (input) => {
      calls.push(input.value)
      if (failureMessage) throw new Error(failureMessage)
      return { echoed: input.value }
    },
    concurrencyKey: () => 'test',
    targetIds: (input) => ({ valueId: input.value }),
    dataClasses: () => options.outputDataClasses ?? ['C1'],
    summarize: (output) => `echo=${output.echoed}`,
  }))
  return {
    gateway: new AgentToolGateway({
      registry,
      getHostContext: options.getHostContext ?? createContext,
      appendPermissionAudit: options.appendPermissionAudit ?? (async (fact) => {
        audits.push(fact)
      }),
    }),
    calls,
    audits,
  }
}

function request(
  input: unknown,
  approvalId?: string,
  approvalMode: 'ask' | 'assistant_decides' | 'full_access' = 'ask'
) {
  return {
    runId: 'run-1',
    threadId: 'thread-1',
    toolCallId: 'call-1',
    toolName: 'test_tool',
    input,
    expectedRevisions: { generation: 2 },
    approvalId,
    approvalMode,
    explicitUserIntent: true,
    signal: new AbortController().signal,
  }
}

describe('AgentToolGateway', () => {
  it('双向校验并缓存幂等成功结果', async () => {
    const { gateway, calls } = createGateway()
    const first = await gateway.execute(request({ value: 'ok' }))
    const second = await gateway.execute(request({ value: 'ok' }))
    expect(first.status).toBe('completed')
    expect(second).toMatchObject({ status: 'completed', cached: true })
    expect(calls).toEqual(['ok'])
    await expect(gateway.execute(request({ value: 'ok', unexpected: true }))).rejects.toMatchObject({
      code: 'INVALID_INPUT',
    })
  })

  it('R2 工具绑定参数、revision 和单次审批', async () => {
    const { gateway, calls } = createGateway('R2')
    const pending = await gateway.execute(request({ value: 'approved' }))
    expect(pending.status).toBe('approval_required')
    if (pending.status !== 'approval_required') throw new Error('expected approval')
    await gateway.resolveApproval(pending.approval.approvalId, 'run-1', 'approve')
    await expect(gateway.execute(request({ value: 'changed' }, pending.approval.approvalId))).rejects.toMatchObject({
      code: 'APPROVAL_INVALID',
    })
    const completed = await gateway.execute(request({ value: 'approved' }, pending.approval.approvalId))
    expect(completed.status).toBe('completed')
    expect(calls).toEqual(['approved'])
    expect(await gateway.execute(request({ value: 'approved' }, pending.approval.approvalId)))
      .toMatchObject({ status: 'completed', cached: true })
  })

  it('三种批准方式按风险与只读属性执行', async () => {
    const assistantRead = createGateway('R2', true)
    expect(await assistantRead.gateway.execute(request(
      { value: 'read' },
      undefined,
      'assistant_decides'
    ))).toMatchObject({ status: 'completed' })

    const assistantWrite = createGateway('R2', false)
    expect(await assistantWrite.gateway.execute(request(
      { value: 'write' },
      undefined,
      'assistant_decides'
    ))).toMatchObject({ status: 'approval_required' })

    const fullWrite = createGateway('R2', false)
    expect(await fullWrite.gateway.execute(request(
      { value: 'full' },
      undefined,
      'full_access'
    ))).toMatchObject({ status: 'completed' })

    const fullHighRisk = createGateway('R3', false)
    expect(await fullHighRisk.gateway.execute(request(
      { value: 'high-risk' },
      undefined,
      'full_access'
    ))).toMatchObject({ status: 'approval_required' })

    const askWrite = createGateway('R1', false)
    expect(await askWrite.gateway.execute(request({ value: 'explicit-write' })))
      .toMatchObject({ status: 'approval_required' })

    const askWriteWithoutIntent = createGateway('R1', false)
    expect(await askWriteWithoutIntent.gateway.execute({
      ...request({ value: 'implicit-write' }),
      explicitUserIntent: false,
    })).toMatchObject({ status: 'approval_required' })

    const assistantLowWrite = createGateway('R1', false)
    expect(await assistantLowWrite.gateway.execute(request(
      { value: 'low-write' },
      undefined,
      'assistant_decides'
    ))).toMatchObject({ status: 'completed' })
  })

  it('审批后 preview 或当前 revision 漂移均先返回 APPROVAL_INVALID', async () => {
    let summary = '初始预览'
    const previewDrift = createGateway('R2', false, undefined, {
      preview: (input) => ({
        title: '执行测试工具', summary, targetIds: { valueId: input.value },
        reversible: false, dataClasses: ['C1'],
      }),
    })
    const previewPending = await previewDrift.gateway.execute(request({ value: 'preview' }))
    if (previewPending.status !== 'approval_required') throw new Error('expected approval')
    await previewDrift.gateway.resolveApproval(previewPending.approval.approvalId, 'run-1', 'approve')
    summary = '变化后的预览'
    await expect(previewDrift.gateway.execute(request(
      { value: 'preview' },
      previewPending.approval.approvalId
    ))).rejects.toMatchObject({ code: 'APPROVAL_INVALID' })
    expect(previewDrift.calls).toHaveLength(0)

    let revision = 2
    const revisionDrift = createGateway('R2', false, undefined, {
      getHostContext: () => ({
        ...createContext(),
        scopeRevisions: { ...createContext().scopeRevisions, generation: revision },
      }),
    })
    const revisionPending = await revisionDrift.gateway.execute(request({ value: 'revision' }))
    if (revisionPending.status !== 'approval_required') throw new Error('expected approval')
    await revisionDrift.gateway.resolveApproval(revisionPending.approval.approvalId, 'run-1', 'approve')
    revision = 3
    await expect(revisionDrift.gateway.execute(request(
      { value: 'revision' },
      revisionPending.approval.approvalId
    ))).rejects.toMatchObject({ code: 'APPROVAL_INVALID' })
    expect(revisionDrift.calls).toHaveLength(0)
  })

  it('preview 必须通过大小、schema 和目标绑定，且变换后的参数会再次校验', async () => {
    const oversized = createGateway('R2', false, undefined, {
      preview: (input) => ({
        title: '执行测试工具', summary: 'x'.repeat(2_001),
        targetIds: { valueId: input.value }, reversible: false, dataClasses: ['C1'],
      }),
    })
    await expect(oversized.gateway.execute(request({ value: 'large' })))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })

    const unclassified = createGateway('R0', true, undefined, {
      preview: (input) => ({
        title: '缺少数据分级', summary: '不得使用空数据分级绕过审批',
        targetIds: { valueId: input.value }, reversible: false, dataClasses: [],
      }),
    })
    await expect(unclassified.gateway.execute(request({ value: 'unclassified' })))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
    expect(unclassified.calls).toHaveLength(0)

    const mismatchedTarget = createGateway('R2', false, undefined, {
      preview: () => ({
        title: '执行测试工具', summary: '目标不一致',
        targetIds: { valueId: 'other' }, reversible: false, dataClasses: ['C1'],
      }),
    })
    await expect(mismatchedTarget.gateway.execute(request({ value: 'expected' })))
      .rejects.toMatchObject({ code: 'APPROVAL_INVALID' })

    const mutatingPreview = createGateway('R2', false, undefined, {
      preview: (input) => {
        input.value = ''
        return {
          title: '执行测试工具', summary: '参数被预览修改',
          targetIds: { valueId: '' }, reversible: false, dataClasses: ['C1'],
        }
      },
    })
    await expect(mutatingPreview.gateway.execute(request({ value: 'valid' })))
      .rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('C2 在所有模式逐次审批，C3 在执行前拒绝', async () => {
    for (const mode of ['ask', 'assistant_decides', 'full_access'] as const) {
      const sensitive = createGateway('R1', true, undefined, {
        preview: (input) => ({
          title: '读取敏感产物', summary: '读取一页 C2 数据',
          targetIds: { valueId: input.value }, reversible: false, dataClasses: ['C2'],
          destination: '当前模型上下文',
        }),
      })
      expect(await sensitive.gateway.execute(request({ value: mode }, undefined, mode)))
        .toMatchObject({ status: 'approval_required' })
      expect(sensitive.calls).toHaveLength(0)
    }

    const secret = createGateway('R0', true, undefined, {
      preview: (input) => ({
        title: '读取秘密', summary: '不允许读取 C3 数据',
        targetIds: { valueId: input.value }, reversible: false, dataClasses: ['C3'],
      }),
    })
    await expect(secret.gateway.execute(request({ value: 'secret' }, undefined, 'full_access')))
      .rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
    expect(secret.calls).toHaveLength(0)
  })

  it('拒绝陈旧 context revision', async () => {
    const { gateway } = createGateway()
    await expect(gateway.execute({ ...request({ value: 'ok' }), expectedRevisions: { generation: 1 } }))
      .rejects.toEqual(expect.objectContaining<Partial<AgentToolGatewayError>>({ code: 'STALE_CONTEXT' }))
  })

  it.each([
    ['自动授权审计', 'R1', 'full_access', 'auto_allowed'],
    ['审批消费审计', 'R2', 'ask', 'consumed'],
  ] as const)('%s 等待期间 revision 改变时首次执行保持零副作用', async (
    _scenario,
    risk,
    approvalMode,
    delayedEvent
  ) => {
    let context = createContext()
    let releaseAudit: () => void = () => undefined
    let markAuditStarted: () => void = () => undefined
    const auditStarted = new Promise<void>((resolve) => { markAuditStarted = resolve })
    const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve })
    const current = createGateway(risk, false, undefined, {
      getHostContext: () => context,
      appendPermissionAudit: async (fact) => {
        if (fact.event !== delayedEvent) return
        markAuditStarted()
        await auditGate
      },
    })

    let approvalId: string | undefined
    if (risk === 'R2') {
      const pending = await current.gateway.execute(request(
        { value: 'revision-race' },
        undefined,
        approvalMode
      ))
      if (pending.status !== 'approval_required') throw new Error('expected approval')
      approvalId = pending.approval.approvalId
      await current.gateway.resolveApproval(approvalId, 'run-1', 'approve')
    }

    const execution = current.gateway.execute(request(
      { value: 'revision-race' },
      approvalId,
      approvalMode
    ))
    await auditStarted
    context = {
      ...context,
      revision: context.revision + 1,
      scopeRevisions: {
        ...context.scopeRevisions,
        generation: context.scopeRevisions.generation + 1,
      },
    }
    releaseAudit()

    await expect(execution).rejects.toMatchObject({ code: 'STALE_CONTEXT' })
    expect(current.calls).toHaveLength(0)
  })

  it('把领域目标不存在和权限错误映射为统一恢复错误', async () => {
    const missing = createGateway('R0', true, '[TASK_NOT_FOUND] 任务不存在')
    await expect(missing.gateway.execute(request({ value: 'missing' }))).rejects.toMatchObject({
      code: 'NOT_FOUND', recovery: 'user_action', retryable: false,
    })
    const denied = createGateway('R0', true, '[PERMISSION_DENIED] 无权读取')
    await expect(denied.gateway.execute(request({ value: 'denied' }))).rejects.toMatchObject({
      code: 'PERMISSION_DENIED', recovery: 'user_action', retryable: false,
    })
  })

  it('拒绝、过期和已消费审批都不能再次执行副作用', async () => {
    const rejected = createGateway('R2')
    const rejectedPending = await rejected.gateway.execute(request({ value: 'reject' }))
    if (rejectedPending.status !== 'approval_required') throw new Error('expected approval')
    await rejected.gateway.resolveApproval(rejectedPending.approval.approvalId, 'run-1', 'reject')
    await expect(rejected.gateway.execute(request(
      { value: 'reject' },
      rejectedPending.approval.approvalId
    ))).rejects.toMatchObject({ code: 'APPROVAL_REJECTED' })
    expect(rejected.calls).toHaveLength(0)

    const expired = createGateway('R2')
    const expiredPending = await expired.gateway.execute(request({ value: 'expire' }))
    if (expiredPending.status !== 'approval_required') throw new Error('expected approval')
    await expired.gateway.expireApproval(expiredPending.approval.approvalId, 'run-1')
    await expect(expired.gateway.execute(request(
      { value: 'expire' },
      expiredPending.approval.approvalId
    ))).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED' })
    expect(expired.calls).toHaveLength(0)
  })

  it('C3 结果被阻断，R4 工具不能注册', async () => {
    const registry = new AgentToolRegistry()
    registry.register(defineAgentTool({
      name: 'secret_tool', version: 1, title: '秘密工具', description: '返回 C3 的测试工具。',
      category: 'test', side: 'backend', risk: 'R0', permission: 'test:read',
      readOnly: true, destructive: false, openWorld: false, idempotent: true,
      timeoutMs: 1_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
      supportsPreview: false, supportsUndo: false, requiredContext: [],
      inputSchema: z.object({}).strict(), outputSchema: z.object({ value: z.string() }).strict(),
      aiInputSchema: { type: 'object', properties: {} }, execute: async () => ({ value: 'secret' }),
      concurrencyKey: () => 'secret', targetIds: () => ({}), dataClasses: () => ['C3'],
      summarize: () => '不应进入上下文',
    }))
    const gateway = new AgentToolGateway({
      registry,
      getHostContext: createContext,
      appendPermissionAudit: async () => {},
    })
    await expect(gateway.execute({
      ...request({}), toolName: 'secret_tool', expectedRevisions: undefined,
    })).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })

    expect(() => defineAgentTool({
      name: 'forbidden_tool', version: 1, title: '禁止工具', description: 'R4 测试。',
      category: 'test', side: 'backend', risk: 'R4', permission: 'forbidden',
      readOnly: false, destructive: true, openWorld: true, idempotent: false,
      timeoutMs: 1_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
      supportsPreview: false, supportsUndo: false, requiredContext: [],
      inputSchema: z.object({}).strict(), outputSchema: z.object({}).strict(),
      aiInputSchema: { type: 'object', properties: {} }, execute: async () => ({}),
      concurrencyKey: () => 'forbidden', targetIds: () => ({}), dataClasses: () => ['C0'],
      summarize: () => '禁止',
    })).toThrow(/禁止注册 R4/)

    const misclassifiedTool = {
      name: 'misclassified_tool', version: 1, title: '错误分级工具', description: 'R0 破坏性测试。',
      category: 'test', side: 'backend', risk: 'R0', permission: 'test:delete',
      readOnly: false, destructive: true, openWorld: false, idempotent: true,
      timeoutMs: 1_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
      supportsPreview: false, supportsUndo: false, requiredContext: [],
      inputSchema: z.object({}).strict(), outputSchema: z.object({}).strict(),
      aiInputSchema: { type: 'object', properties: {} }, execute: async () => ({}),
      concurrencyKey: () => 'misclassified', targetIds: () => ({}), dataClasses: () => ['C0'],
      summarize: () => '禁止',
    } satisfies AgentToolDefinition
    expect(() => defineAgentTool(misclassifiedTool)).toThrow(/R0 工具不能声明为破坏性/)
    expect(() => registry.register(misclassifiedTool)).toThrow(/R0 工具不能声明为破坏性/)
  })
})
