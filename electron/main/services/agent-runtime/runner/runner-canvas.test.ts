import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  hostScopeRevisionsSchema,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import { AGENT_RUNTIME_SCHEMA_VERSION, type AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import type { AgentEvent, AgentRunState } from '../../../../../src/core/assistant/events'
import type { ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import { AgentToolGateway } from '../tools/gateway'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolRegistry } from '../tools/registry'
import { AgentRunner } from './runner'

function request(): AgentStartRunRequest {
  const verifiedAt = new Date().toISOString()
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId: 'thread-canvas',
    goal: '在画布添加两个节点并连接定位',
    approvalMode: 'ask',
    profile: {
      id: 'profile-canvas', name: '画布评测',
      primary: { providerId: 'provider', modelId: 'model' },
      settings: { timeoutMs: 5_000, maxRetries: 0, maxOutputTokens: 1_000, contextWindowBudget: 8_000 },
      verifications: [{
        providerId: 'provider', modelId: 'model', adapterVersion: 'test', verifiedAt,
        checks: ['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel'].map((id) => ({
          id: id as 'text' | 'toolCall' | 'structuredOutput' | 'streaming' | 'usage' | 'cancel',
          status: 'passed' as const,
          latencyMs: 1,
        })),
        totalLatencyMs: 6,
        usage: { inputTokens: 1, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2 },
        cost: { status: 'unknown' },
      }],
      createdAt: verifiedAt, updatedAt: verifiedAt,
    },
    models: [{
      providerId: 'provider', modelId: 'model', displayName: '测试模型', adapter: 'openai-compatible', enabled: true,
      capabilities: {
        text: true, image: false, video: false, audio: false, streaming: true, toolCall: true,
        parallelTools: false, jsonOutput: true, structuredOutputMode: 'json', reasoning: false,
        sampling: true, contextWindow: 32_000, maxOutputTokens: 4_000, usage: true,
      },
    }],
  }
}

function stepResult(input: ModelStepInput, call: number): ModelStepResult {
  const toolCalls = call === 1
    ? [
        { toolCallId: 'call-add', toolName: 'add_canvas_node', input: { projectId: 'project-1' }, dynamic: false },
        { toolCallId: 'call-connect', toolName: 'connect_canvas_nodes', input: { projectId: 'project-1' }, dynamic: false },
      ]
    : []
  return {
    requestId: input.requestId, runId: input.runId, stepId: input.stepId,
    providerId: input.providerId, modelId: input.modelId,
    text: call === 1 ? '' : '画布操作完成', reasoningText: '', structuredOutput: null,
    toolCalls,
    responseMessages: call === 1
      ? [{ role: 'assistant', content: toolCalls.map((toolCall) => ({ type: 'tool-call' as const, ...toolCall })) }]
      : [{ role: 'assistant', content: '画布操作完成' }],
    finishReason: call === 1 ? 'tool-calls' : 'stop',
    usage: {
      inputTokens: 10, inputNoCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 2, textTokens: 2, reasoningTokens: 0, totalTokens: 12,
    },
    providerMetadataSummary: {}, warnings: [], elapsedMs: 1,
  }
}

describe('AgentRunner canvas batch', () => {
  it('同一模型步骤的连续写工具继承前一结果 revision', async () => {
    let context: HostContextSnapshot = {
      schemaVersion: AGENT_CONTRACT_VERSION,
      rendererSessionId: 'renderer-canvas', revision: 1,
      scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
      workspace: { id: 'nodes', activeToolId: null },
      project: { id: 'project-1', selectedNodeId: null },
      generation: { commandReady: true }, assets: { view: 'closed', selectedAssetId: null }, uiReady: true,
      availableCommands: ['add_canvas_node', 'connect_canvas_nodes'], availableQueries: [],
      capturedAt: new Date().toISOString(),
    }
    const registry = new AgentToolRegistry()
    const executions: string[] = []
    for (const toolName of ['add_canvas_node', 'connect_canvas_nodes'] as const) {
      registry.register(defineAgentTool({
        name: toolName, version: 1, title: toolName, description: `测试 ${toolName} revision 串联。`,
        category: 'canvas', side: 'backend', risk: 'R0', permission: 'canvas:write',
        readOnly: false, destructive: false, openWorld: false, idempotent: true,
        timeoutMs: 1_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
        supportsPreview: false, supportsUndo: false, requiredContext: ['canvas'],
        inputSchema: z.object({ projectId: z.string() }).strict(),
        outputSchema: z.object({
          projectId: z.string(), scopeRevisions: hostScopeRevisionsSchema,
        }).strict(),
        aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
        execute: async (input) => {
          executions.push(toolName)
          context = {
            ...context,
            revision: context.revision + 1,
            scopeRevisions: { ...context.scopeRevisions, canvas: context.scopeRevisions.canvas + 1 },
          }
          return { projectId: input.projectId, scopeRevisions: context.scopeRevisions }
        },
        concurrencyKey: () => 'canvas', targetIds: (input) => ({ projectId: input.projectId }),
        dataClasses: () => ['C1'], summarize: () => `${toolName} 完成`,
      }))
    }
    const gateway = new AgentToolGateway({
      registry,
      getHostContext: () => context,
      appendPermissionAudit: async () => {},
    })
    const events: AgentEvent[] = []
    let resolveTerminal: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { resolveTerminal = resolve })
    let modelCall = 0
    const runner = new AgentRunner({
      runId: 'run-canvas-batch',
      request: request(),
      dependencies: {
        registry,
        gateway,
        getHostContext: () => context,
        runModelStep: vi.fn(async (input: ModelStepInput) => {
          if (input.stepId.startsWith('router:')) {
            return {
              ...stepResult(input, 2),
              text: '',
              structuredOutput: {
                intent: 'canvas',
                complexity: 'multi_step',
                reason: '用户要求编排画布节点',
              },
              responseMessages: [{ role: 'assistant' as const, content: '' }],
            }
          }
          modelCall += 1
          return stepResult(input, modelCall)
        }),
        cancelModelStep: vi.fn(),
        onEvent: (event) => events.push(event),
        onTerminal: resolveTerminal,
      },
    })

    runner.start()
    const state = await terminal

    expect(state.status).toBe('completed')
    expect(executions).toEqual(['add_canvas_node', 'connect_canvas_nodes'])
    expect(events.filter((event) => event.type === 'ToolCompleted')).toHaveLength(2)
    expect(events.some((event) => event.type === 'ToolFailed')).toBe(false)
  })
})
