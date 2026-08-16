import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  hostScopeRevisionsSchema,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import { AGENT_RUNTIME_SCHEMA_VERSION, type AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import type { AgentEvent, AgentRunState } from '../../../../../src/core/assistant/events'
import {
  HENJI_ENTITY_METHOD_SIGNATURES,
  HENJI_SCRIPT_LANGUAGE_RULES,
} from '../../../../../src/core/assistant/capabilityDiscovery'
import type { ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import { AgentToolGateway } from '../tools/gateway'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolRegistry } from '../tools/registry'
import { createHenjiScriptService, createHenjiScriptTools } from '../henji-script/tools'
import { rememberHenjiScriptApiLease } from '../context/script-api-lease'
import { AgentRunner } from './runner'

function request(): AgentStartRunRequest {
  const verifiedAt = new Date().toISOString()
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId: 'thread-canvas',
    goal: '在画布添加两个节点并连接',
    approvalMode: 'full_access',
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
    ? [{
        toolCallId: 'call-script', toolName: 'run_henji_script', dynamic: false,
        input: {
          language: 'henji-ts/v1', summary: '添加两个节点、连接并验证',
          source: `
            await app.action('search_canvas_node_types', { ordinal: 1 });
            await app.action('get_canvas_node_schema', { ordinal: 2 });
            await app.action('add_canvas_node', { projectId: 'project-1' });
            await app.action('add_canvas_node', { projectId: 'project-1' });
            await app.action('connect_canvas_nodes', { projectId: 'project-1' });
            await app.action('get_canvas_project', { projectId: 'project-1' });
          `,
        },
      }]
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
      availableCapabilities: [
        'run_henji_script',
        'search_canvas_node_types', 'get_canvas_node_schema',
        'add_canvas_node', 'connect_canvas_nodes', 'get_canvas_project',
      ],
      capturedAt: new Date().toISOString(),
    }
    const registry = new AgentToolRegistry()
    const executions: string[] = []
    let entitySequence = 0
    for (const toolName of ['search_canvas_node_types', 'get_canvas_node_schema'] as const) {
      registry.register(defineAgentTool({
        name: toolName, version: 1, title: toolName, description: `读取 ${toolName}。`,
        capability: {
          id: toolName, domain: 'canvas', aliases: [], dataClasses: ['C0'], acceptsRefs: [],
          producesRefs: ['canvas.node_type'], availability: [], concurrencyKey: 'canvas_catalog',
          control: { impacts: [{
            effect: 'observe', entityTypes: ['canvas.node_type'], propertyIds: [],
            revisionScopes: [], verificationRequired: false,
          }] },
          resolveObservedEffects: () => [{
            effect: 'observe', entityTypes: ['canvas.node_type'], propertyIds: [], targetRefs: [],
            count: 1, verified: true, evidence: [`${toolName}:observed`],
          }],
        } as never,
        category: 'canvas', side: 'backend', risk: 'R0', permission: 'canvas:read',
        readOnly: true, destructive: false, openWorld: false, idempotent: true,
        timeoutMs: 1_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
        supportsPreview: false, supportsUndo: false, requiredContext: [],
        inputSchema: z.object({ ordinal: z.number().optional() }).strict(),
        outputSchema: z.object({ ok: z.literal(true), ordinal: z.number().optional() }).strict(),
        aiInputSchema: { type: 'object', properties: { ordinal: { type: 'number' } }, additionalProperties: false },
        execute: async (input) => ({ ok: true as const, ordinal: input.ordinal }), concurrencyKey: () => 'canvas_catalog',
        targetIds: () => ({}), dataClasses: () => ['C0'], summarize: () => `${toolName} 已读取`,
      }))
    }
    for (const toolName of ['add_canvas_node', 'connect_canvas_nodes'] as const) {
      registry.register(defineAgentTool({
        name: toolName, version: 1, title: toolName, description: `测试 ${toolName} revision 串联。`,
        capability: {
          id: toolName, domain: 'canvas', aliases: [], dataClasses: ['C1'], acceptsRefs: [], producesRefs: [],
          availability: [], concurrencyKey: 'canvas',
          control: { impacts: [{
            effect: 'create',
            entityTypes: [toolName === 'add_canvas_node' ? 'canvas.node' : 'canvas.edge'],
            propertyIds: [], revisionScopes: ['canvas'], verificationRequired: true,
          }] },
          resolveObservedEffects: (_input: unknown, output: { entityId: string }) => [{
            effect: 'create',
            entityTypes: [toolName === 'add_canvas_node' ? 'canvas.node' : 'canvas.edge'],
            propertyIds: [],
            targetRefs: [{ kind: toolName === 'add_canvas_node' ? 'canvas.node' : 'canvas.edge', id: output.entityId }],
            count: 1, verified: true, evidence: [`${toolName}:${output.entityId}`],
          }],
        } as never,
        category: 'canvas', side: 'backend', risk: 'R0', permission: 'canvas:write',
        readOnly: false, destructive: false, openWorld: false, idempotent: true,
        timeoutMs: 1_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
        supportsPreview: false, supportsUndo: false, requiredContext: ['canvas'],
        inputSchema: z.object({ projectId: z.string() }).strict(),
        outputSchema: z.object({
          projectId: z.string(), entityId: z.string(), scopeRevisions: hostScopeRevisionsSchema,
        }).strict(),
        aiInputSchema: { type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'] },
        execute: async (input) => {
          executions.push(toolName)
          entitySequence += 1
          context = {
            ...context,
            revision: context.revision + 1,
            scopeRevisions: { ...context.scopeRevisions, canvas: context.scopeRevisions.canvas + 1 },
          }
          return {
            projectId: input.projectId,
            entityId: `${toolName}-${entitySequence}`,
            scopeRevisions: context.scopeRevisions,
          }
        },
        concurrencyKey: () => 'canvas', targetIds: (input) => ({ projectId: input.projectId }),
        dataClasses: () => ['C1'], summarize: () => `${toolName} 完成`,
      }))
    }
    registry.register(defineAgentTool({
      name: 'get_canvas_project', version: 1, title: 'get_canvas_project',
      description: '读取并验证当前画布结构。',
      capability: {
        id: 'get_canvas_project', domain: 'canvas', aliases: [], dataClasses: ['C1'],
        acceptsRefs: [], producesRefs: [], availability: [], concurrencyKey: 'canvas',
        control: { impacts: [{
          effect: 'observe', entityTypes: ['canvas.project', 'canvas.node', 'canvas.edge'],
          propertyIds: [], revisionScopes: ['canvas'], verificationRequired: false,
        }] },
        resolveObservedEffects: () => [{
          effect: 'observe', entityTypes: ['canvas.project', 'canvas.node', 'canvas.edge'],
          propertyIds: [], targetRefs: [], count: 1, verified: true,
          evidence: ['get_canvas_project:verified'],
        }],
      } as never,
      category: 'canvas', side: 'backend', risk: 'R0', permission: 'canvas:read',
      readOnly: true, destructive: false, openWorld: false, idempotent: true,
      timeoutMs: 1_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
      supportsPreview: false, supportsUndo: false, requiredContext: ['canvas'],
      inputSchema: z.object({ projectId: z.string() }).strict(),
      outputSchema: z.object({ projectId: z.string() }).strict(),
      aiInputSchema: {
        type: 'object', properties: { projectId: { type: 'string' } }, required: ['projectId'],
      },
      execute: async (input) => ({ projectId: input.projectId }),
      concurrencyKey: () => 'canvas', targetIds: (input) => ({ projectId: input.projectId }),
      dataClasses: () => ['C1'], summarize: () => '画布结构已验证',
    }))
    const gateway = new AgentToolGateway({
      registry,
      getHostContext: () => context,
      appendPermissionAudit: async () => {},
    })
    const scriptService = createHenjiScriptService(registry)
    for (const tool of createHenjiScriptTools({
      service: scriptService, gateway, getHostContext: () => context,
    })) registry.register(tool)
    rememberHenjiScriptApiLease('run-canvas-batch', {
      forbiddenEffects: [],
      language: 'henji-ts/v1', entryTool: 'run_henji_script',
      rules: [...HENJI_SCRIPT_LANGUAGE_RULES],
      entities: {
        methods: ['list', 'read', 'create', 'update', 'remove'],
        signatures: HENJI_ENTITY_METHOD_SIGNATURES,
        entityTypes: [], propertyIds: [], entityDefinitions: [], propertyDefinitions: [],
      },
      actions: [
        'search_canvas_node_types', 'get_canvas_node_schema',
        'add_canvas_node', 'connect_canvas_nodes', 'get_canvas_project',
      ].map((id) => ({
        id, title: id, parameters: {}, returns: { fields: ['resultRefs'], hasResultRefs: true },
      })),
      recipes: [],
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
              ...stepResult(input, 3),
              text: '',
              structuredOutput: {
                intent: 'canvas',
                reason: '用户要求编排画布节点',
                explicitUserIntent: true,
                taskFacets: [{
                  facetId: 'canvas_write', domain: 'canvas', goal: '新增节点并连接',
                  capabilityKinds: ['mutate'], completionConditions: ['节点与连线都有结构化证据。'],
                  requiredEffects: [{
                    effectId: 'canvas_node_effect', effect: 'create', entityTypes: ['canvas.node'],
                    propertyIds: [], minimumCount: 2, targetRefs: [], verificationRequired: true,
                    actionGroupId: 'canvas_node_group',
                  }, {
                    effectId: 'canvas_edge_effect', effect: 'create', entityTypes: ['canvas.edge'],
                    propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: true,
                    actionGroupId: 'canvas_edge_group',
                  }],
                }, {
                  facetId: 'canvas_verify', domain: 'canvas', goal: '读取画布验证节点与连线',
                  capabilityKinds: ['observe', 'query'], dependsOn: ['canvas_write'],
                  completionConditions: ['结构化读取确认目标节点与连线存在。'],
                  requiredEffects: [{
                    effectId: 'canvas_verify_effect', effect: 'observe',
                    entityTypes: ['canvas.project', 'canvas.node', 'canvas.edge'],
                    propertyIds: [], minimumCount: 1, targetRefs: [], verificationRequired: false,
                    actionGroupId: 'canvas_verify_group',
                  }],
                }],
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
    expect(state.status, JSON.stringify(state.error)).toBe('completed')
    expect(executions).toEqual(['add_canvas_node', 'add_canvas_node', 'connect_canvas_nodes'])
    expect(events.filter((event) => event.type === 'ToolCompleted')).toHaveLength(1)
    expect(events.some((event) => event.type === 'ToolFailed')).toBe(false)
  })
})

