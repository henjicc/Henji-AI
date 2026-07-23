import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { defineAgentTool } from './define-tool'
import { AgentToolGateway, AgentToolGatewayError } from './gateway'
import { AgentToolRegistry } from './registry'

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
    availableCommands: ['switch_workspace', 'create_visible_generation_task'],
    availableQueries: ['get_host_context'],
    capturedAt: new Date().toISOString(),
  }
}

function createGateway(risk: 'R0' | 'R2' = 'R0'): { gateway: AgentToolGateway; calls: string[] } {
  const calls: string[] = []
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
    readOnly: risk === 'R0',
    destructive: false,
    openWorld: risk === 'R2',
    idempotent: true,
    timeoutMs: 1_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: risk === 'R2',
    supportsUndo: false,
    requiredContext: ['generation'],
    inputSchema: z.object({ value: z.string().min(1) }).strict(),
    outputSchema: z.object({ echoed: z.string() }).strict(),
    aiInputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] },
    preview: (input) => ({
      title: '执行测试工具',
      summary: `处理 ${input.value.length} 个字符。`,
      targetIds: { valueId: input.value },
      reversible: false,
      dataClasses: ['C1'],
    }),
    execute: async (input) => {
      calls.push(input.value)
      return { echoed: input.value }
    },
    concurrencyKey: () => 'test',
    targetIds: (input) => ({ valueId: input.value }),
    dataClasses: () => ['C1'],
    summarize: (output) => `echo=${output.echoed}`,
  }))
  return { gateway: new AgentToolGateway({ registry, getHostContext: createContext }), calls }
}

function request(input: unknown, approvalId?: string) {
  return {
    runId: 'run-1',
    threadId: 'thread-1',
    toolCallId: 'call-1',
    toolName: 'test_tool',
    input,
    expectedRevisions: { generation: 2 },
    approvalId,
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
    gateway.approvals.resolve(pending.approval.approvalId, 'run-1', 'approve')
    await expect(gateway.execute(request({ value: 'changed' }, pending.approval.approvalId))).rejects.toMatchObject({
      code: 'APPROVAL_INVALID',
    })
    const completed = await gateway.execute(request({ value: 'approved' }, pending.approval.approvalId))
    expect(completed.status).toBe('completed')
    expect(calls).toEqual(['approved'])
    expect(await gateway.execute(request({ value: 'approved' }, pending.approval.approvalId)))
      .toMatchObject({ status: 'completed', cached: true })
  })

  it('拒绝陈旧 context revision', async () => {
    const { gateway } = createGateway()
    await expect(gateway.execute({ ...request({ value: 'ok' }), expectedRevisions: { generation: 1 } }))
      .rejects.toEqual(expect.objectContaining<Partial<AgentToolGatewayError>>({ code: 'STALE_CONTEXT' }))
  })
})
