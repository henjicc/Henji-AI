import { z } from 'zod'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AgentToolPreview } from '../../../../../src/core/assistant/toolContracts'
import {
  AGENT_APPROVAL_CONSUME_GRACE_MS,
  AgentApprovalManager,
} from './approval'
import type { AgentToolDefinition } from './types'

interface ApprovalInput {
  value: string
}

interface ApprovalOutput {
  ok: boolean
}

function definition(
  overrides: Partial<AgentToolDefinition<ApprovalInput, ApprovalOutput>> = {}
): AgentToolDefinition<ApprovalInput, ApprovalOutput> {
  return {
    name: 'approval_tool',
    version: 1,
    title: '审批工具',
    description: '验证审批绑定。',
    category: 'test',
    side: 'backend',
    risk: 'R2',
    permission: 'test:write',
    readOnly: false,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 1_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: true,
    supportsUndo: true,
    requiredContext: ['generation'],
    inputSchema: z.object({ value: z.string() }).strict(),
    outputSchema: z.object({ ok: z.boolean() }).strict(),
    aiInputSchema: { type: 'object' },
    preview: (input) => preview(input.value),
    execute: async () => ({ ok: true }),
    concurrencyKey: () => 'approval',
    targetIds: (input) => ({ valueId: input.value }),
    dataClasses: () => ['C1'],
    summarize: () => '完成',
    ...overrides,
  }
}

function preview(value: string, overrides: Partial<AgentToolPreview> = {}): AgentToolPreview {
  return {
    title: '执行审批工具',
    summary: `处理 ${value}`,
    targetIds: { valueId: value },
    reversible: true,
    dataClasses: ['C1'],
    ...overrides,
  }
}

async function approvedManager(): Promise<{
  manager: AgentApprovalManager
  approvalId: string
  definition: AgentToolDefinition<ApprovalInput, ApprovalOutput>
  input: ApprovalInput
  preview: AgentToolPreview
}> {
  const manager = new AgentApprovalManager()
  const tool = definition()
  const input = { value: 'original' }
  const currentPreview = preview(input.value)
  const request = manager.create({
    runId: 'run-1',
    toolCallId: 'call-1',
    definition: tool,
    input,
    preview: currentPreview,
    expectedRevisions: { generation: 2 },
  })
  await manager.resolve(request.approvalId, 'run-1', 'approve')
  return { manager, approvalId: request.approvalId, definition: tool, input, preview: currentPreview }
}

describe('AgentApprovalManager', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('完整绑定通过后只能消费一次', async () => {
    const fixture = await approvedManager()
    const consume = (): Promise<void> => fixture.manager.consume({
      approvalId: fixture.approvalId,
      runId: 'run-1',
      toolCallId: 'call-1',
      definition: fixture.definition,
      input: fixture.input,
      preview: fixture.preview,
      expectedRevisions: { generation: 2 },
    })
    await expect(consume()).resolves.toBeUndefined()
    await expect(consume()).rejects.toMatchObject({ code: 'APPROVAL_INVALID' })
  })

  it.each([
    ['toolCallId', { toolCallId: 'call-2' }],
    ['toolName', { definition: definition({ name: 'renamed_tool' }) }],
    ['toolVersion', { definition: definition({ version: 2 }) }],
    ['risk', { definition: definition({ risk: 'R3' }) }],
    ['argsDigest', { input: { value: 'changed' }, preview: preview('changed') }],
    ['previewDigest', { preview: preview('original', { summary: 'changed summary' }) }],
    ['targetIds', {
      definition: definition({ targetIds: () => ({ valueId: 'other' }) }),
      preview: preview('original', { targetIds: { valueId: 'other' } }),
    }],
    ['reversible', { preview: preview('original', { reversible: false }) }],
    ['dataClasses', { preview: preview('original', { dataClasses: ['C2'], destination: '模型上下文' }) }],
    ['destination', { preview: preview('original', { destination: '另一个目的地' }) }],
    ['permission/scope', { definition: definition({ permission: 'test:other' }) }],
    ['expectedRevisions', { expectedRevisions: { generation: 3 } }],
  ] as const)('%s 漂移时拒绝消费', async (_field, overrides) => {
    const fixture = await approvedManager()
    await expect(fixture.manager.consume({
      approvalId: fixture.approvalId,
      runId: 'run-1',
      toolCallId: 'call-1',
      definition: fixture.definition,
      input: fixture.input,
      preview: fixture.preview,
      expectedRevisions: { generation: 2 },
      ...overrides,
    })).rejects.toMatchObject({ code: 'APPROVAL_INVALID' })
  })

  it('预览目标与工具声明不一致时不能创建审批', () => {
    const manager = new AgentApprovalManager()
    expect(() => manager.create({
      runId: 'run-1',
      toolCallId: 'call-1',
      definition: definition(),
      input: { value: 'expected' },
      preview: preview('other'),
      expectedRevisions: { generation: 2 },
    })).toThrow(expect.objectContaining({ code: 'APPROVAL_INVALID' }))
  })

  it('到期前已开始的用户决策不会因审计延迟失效', async () => {
    vi.useFakeTimers()
    const manager = new AgentApprovalManager()
    const tool = definition()
    const input = { value: 'before-deadline' }
    const currentPreview = preview(input.value)
    const request = manager.create({
      runId: 'run-1',
      toolCallId: 'call-1',
      definition: tool,
      input,
      preview: currentPreview,
      expectedRevisions: { generation: 2 },
      ttlMs: 1_000,
    })
    let releaseAudit: () => void = () => undefined
    let markAuditStarted: () => void = () => undefined
    const auditStarted = new Promise<void>((resolve) => { markAuditStarted = resolve })
    const auditGate = new Promise<void>((resolve) => { releaseAudit = resolve })
    const resolving = manager.resolve(request.approvalId, 'run-1', 'approve', async () => {
      markAuditStarted()
      await auditGate
    })

    await auditStarted
    await vi.advanceTimersByTimeAsync(2_000)
    releaseAudit()
    await expect(resolving).resolves.toBe('approved')
    await expect(manager.consume({
      approvalId: request.approvalId,
      runId: 'run-1',
      toolCallId: 'call-1',
      definition: tool,
      input,
      preview: currentPreview,
      expectedRevisions: { generation: 2 },
    })).resolves.toBeUndefined()
  })

  it('批准后的消费宽限期有界，超过截止后不能再消费', async () => {
    vi.useFakeTimers()
    const manager = new AgentApprovalManager()
    const tool = definition()
    const input = { value: 'bounded-grace' }
    const currentPreview = preview(input.value)
    const request = manager.create({
      runId: 'run-1',
      toolCallId: 'call-1',
      definition: tool,
      input,
      preview: currentPreview,
      expectedRevisions: { generation: 2 },
      ttlMs: 1_000,
    })

    await manager.resolve(request.approvalId, 'run-1', 'approve')
    await vi.advanceTimersByTimeAsync(AGENT_APPROVAL_CONSUME_GRACE_MS + 1)

    await expect(manager.consume({
      approvalId: request.approvalId,
      runId: 'run-1',
      toolCallId: 'call-1',
      definition: tool,
      input,
      preview: currentPreview,
      expectedRevisions: { generation: 2 },
    })).rejects.toMatchObject({ code: 'APPROVAL_EXPIRED' })
  })
})
