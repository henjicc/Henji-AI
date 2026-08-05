import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'

import {
  AGENT_CONTRACT_VERSION,
  type HostContextSnapshot,
} from '../../../../../src/core/assistant/hostContracts'
import { AGENT_RUNTIME_SCHEMA_VERSION, type AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import type { AgentEvent, AgentRunState } from '../../../../../src/core/assistant/events'
import type { ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import { AgentToolGateway } from '../tools/gateway'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolRegistry } from '../tools/registry'
import { createBackendBuiltinTools } from '../tools/builtin/backend'
import { AgentRunner } from './runner'

/*
 * 端到端复现：用户要"白色球体"，任务图只声明了"放一个对象"。
 *
 * 实测那次 place_camera_stage_object 一成功，兜底任务图那唯一一条 requiredEffect 就满足了，
 * 结算 completed，于是 validate 拒绝一切后续工具、settlementGuidance 下发"停止调用工具"。
 * 模型自己清楚球体还不是白的，却连改颜色都调不动，只能回一句"需要我确认时回复一声即可"。
 * 用户看到的是"每一步操作都要我跟他说一声"。
 *
 * 本用例走真实 AgentRunner，不是单元级断言：任务图**故意只声明放置**，验证模型在结算完成之后
 * 仍然能补声明并真的把颜色改掉，全程不需要用户再说一句话。
 */

function hostContext(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-settle',
    revision: 1,
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'tools', activeToolId: 'cameraStage' },
    surface: { id: 'tool.camera_stage', kind: 'tool', focusedRef: null, selectedRefs: [] },
    project: { id: 'project-1', selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: [],
    capturedAt: new Date().toISOString(),
  }
}

function request(): AgentStartRunRequest {
  const verifiedAt = new Date().toISOString()
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId: 'thread-settle',
    goal: '再帮我添加一个白色的球体',
    approvalMode: 'full_access',
    profile: {
      id: 'profile-settle', name: '结算评测',
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
      providerId: 'provider', modelId: 'model', displayName: '测试模型',
      adapter: 'openai-compatible', enabled: true,
      capabilities: {
        text: true, image: false, video: false, audio: false, streaming: true, toolCall: true,
        parallelTools: false, jsonOutput: true, structuredOutputMode: 'json', reasoning: false,
        sampling: true, contextWindow: 32_000, maxOutputTokens: 4_000, usage: true,
      },
    }],
  }
}

function usage(): ModelStepResult['usage'] {
  return {
    inputTokens: 10, inputNoCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
    outputTokens: 2, textTokens: 2, reasoningTokens: 0, totalTokens: 12,
  }
}

function base(input: ModelStepInput): ModelStepResult {
  return {
    requestId: input.requestId, runId: input.runId, stepId: input.stepId,
    providerId: input.providerId, modelId: input.modelId,
    text: '', reasoningText: '', structuredOutput: null, toolCalls: [],
    responseMessages: [{ role: 'assistant', content: '' }],
    finishReason: 'tool-calls', usage: usage(),
    providerMetadataSummary: {}, warnings: [], elapsedMs: 1,
  }
}

/** 工具调用必须同时出现在 responseMessages 里，否则模型输出守卫判 MODEL_OUTPUT_INCOMPLETE。 */
function withToolCall(
  input: ModelStepInput,
  toolCallId: string,
  toolName: string,
  toolInput: Record<string, unknown>
): ModelStepResult {
  const toolCalls = [{ toolCallId, toolName, input: toolInput, dynamic: false }]
  return {
    ...base(input),
    toolCalls,
    responseMessages: [{
      role: 'assistant',
      content: toolCalls.map((call) => ({ type: 'tool-call' as const, ...call })),
    }],
  }
}

function cameraTool(
  name: string,
  effect: 'execute' | 'update',
  entityType: string,
  propertyIds: string[] = []
) {
  return defineAgentTool({
    name, version: 1,
    title: name, description: `三维场景测试能力 ${name}。`,
    capability: {
      id: name, domain: 'camera_stage', aliases: [], dataClasses: ['C1'],
      acceptsRefs: [], producesRefs: [entityType], availability: [],
      concurrencyKey: 'camera_stage',
      control: {
        impacts: [{
          effect, entityTypes: [entityType], propertyIds,
          revisionScopes: [], verificationRequired: false,
        }],
      },
      resolveObservedEffects: () => [{
        effect, entityTypes: [entityType], propertyIds,
        targetRefs: [{ kind: entityType, id: 'obj-sphere' }],
        count: 1, verified: true, evidence: [`${name}:obj-sphere`],
      }],
    } as never,
    category: 'camera_stage', side: 'backend', risk: 'R1', permission: 'camera_stage:write',
    readOnly: false, destructive: false, openWorld: false, idempotent: false,
    timeoutMs: 1_000, retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false, supportsUndo: false, requiredContext: [],
    inputSchema: z.object({ objectId: z.string() }).strict(),
    outputSchema: z.object({ objectId: z.string() }).strict(),
    aiInputSchema: {
      type: 'object', properties: { objectId: { type: 'string' } },
      required: ['objectId'], additionalProperties: false,
    },
    execute: async (input) => ({ objectId: input.objectId }),
    concurrencyKey: () => 'camera_stage',
    targetIds: (input) => ({ objectId: input.objectId }),
    dataClasses: () => ['C1'],
    summarize: () => `${name} 已完成`,
  })
}

describe('任务图结算完成之后仍能继续把用户的目标做完', () => {
  it('放置成功导致结算 completed 后，模型自己补声明并改颜色，全程不需要用户再说话', async () => {
    const registry = new AgentToolRegistry()
    const executions: string[] = []
    /*
     * 结构上忠实还原：place 满足兜底任务图声明的那条 Effect（camera_stage.scene 的 execute），
     * 改颜色则是**计划里从来没有的东西**（camera_stage.object 的 color 属性）。
     * 用户嘴里的"白色"就是这样一个从未被声明成 Effect 的细节。
     */
    const tools = [
      cameraTool('place_object', 'execute', 'camera_stage.scene'),
      cameraTool('update_object_color', 'update', 'camera_stage.object', ['camera_stage.object.color']),
    ]
    for (const tool of tools) {
      registry.register({
        ...tool,
        execute: async (input: { objectId: string }) => {
          executions.push(tool.name)
          return { objectId: input.objectId }
        },
      })
    }
    // declare_action_plan 是模型纠正计划的唯一入口，必须走真实实现。
    for (const tool of createBackendBuiltinTools(registry, {
      describe: () => { throw new Error('本用例不读取 artifact') },
      read: () => { throw new Error('本用例不读取 artifact') },
    })) {
      if (tool.name === 'declare_action_plan') registry.register(tool)
    }

    const context = hostContext()
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
      runId: 'run-settle-continue',
      request: request(),
      dependencies: {
        registry,
        gateway,
        getHostContext: () => context,
        runModelStep: vi.fn(async (input: ModelStepInput) => {
          if (input.stepId.startsWith('router:')) {
            return {
              ...base(input),
              finishReason: 'stop' as const,
              structuredOutput: {
                intent: 'camera_stage',
                // 与实测一致：路由退回 fallback 时 complexity 是 ambiguous，不强制预先声明计划。
                complexity: 'ambiguous',
                reason: '在三维工程里放一个球体',
                toolDomains: ['camera_stage'],
                /*
                 * 关键：任务图**只声明放置**，不声明颜色。
                 * 这正是真实兜底任务图的形状——"白色"这个细节从来没进过计划。
                 */
                taskFacets: [{
                  facetId: 'camera_scene', domain: 'camera_stage', goal: '放置球体',
                  capabilityKinds: ['execute'],
                  completionConditions: ['放置返回结构化证据。'],
                  requiredEffects: [{
                    effectId: 'place_effect', effect: 'execute',
                    entityTypes: ['camera_stage.object'], propertyIds: [],
                    minimumCount: 1, targetRefs: [], verificationRequired: false,
                    actionGroupId: 'place_group',
                  }],
                }],
              },
            }
          }
          modelCall += 1
          if (modelCall === 1) {
            return withToolCall(input, 'call-place', 'place_object', { objectId: 'obj-sphere' })
          }
          if (modelCall === 2) {
            // 结算此时已是 completed。旧实现在这里硬拒，模型只能收工问用户。
            return withToolCall(input, 'call-color-1', 'update_object_color', { objectId: 'obj-sphere' })
          }
          if (modelCall === 3) {
            // 按 ACTION_PLAN_REQUIRED 的指引补声明"改颜色"这个从未进过计划的 Effect。
            return withToolCall(input, 'call-declare', 'declare_action_plan', {
              facets: [{
                facetId: 'camera_color',
                requiredEffects: [{
                  effect: 'update', entityTypes: ['camera_stage.object'],
                  propertyIds: ['camera_stage.object.color'], minimumCount: 1,
                }],
              }],
              actionGroups: [],
            })
          }
          if (modelCall === 4) {
            return withToolCall(input, 'call-color-2', 'update_object_color', { objectId: 'obj-sphere' })
          }
          return {
            ...base(input),
            finishReason: 'stop' as const,
            text: '已放置球体并把颜色设为白色。',
            responseMessages: [{ role: 'assistant' as const, content: '已放置球体并把颜色设为白色。' }],
          }
        }),
        cancelModelStep: vi.fn(),
        onEvent: (event) => events.push(event),
        onTerminal: resolveTerminal,
      },
    })

    runner.start()
    const state = await terminal

    // 最关键的一条：颜色真的改了，而不是停下来问用户。
    expect(executions).toEqual(['place_object', 'update_object_color'])
    expect(state.status).toBe('completed')

    // 结算完成不得再产出"禁止继续调用工具"这种死路。
    const serialized = JSON.stringify(events)
    expect(serialized).not.toContain('禁止继续调用工具')
    // 也不得把"请用户再发一次指令"当成正常收尾路径。
    expect(state.finalText ?? '').not.toContain('回复一声')
  })

  /*
   * 另一条自救路径：路由把领域整个判错，任务图那条 Effect 根本没有能力能满足。
   *
   * 实测「你继续」被判成 canvas 时就是这样——模型补建了正确的 Facet 并把活干完，那个永远拿不到
   * 证据的 canvas Facet 仍然让整次运行报 VERIFICATION_REPAIR_FAILED。作废能力必须真的能走通，
   * 否则 superseded 这个状态等于没加。
   */
  it('路由判错领域时，模型补建正确 Facet 并作废旧的，运行仍以 completed 结束', async () => {
    const registry = new AgentToolRegistry()
    const executions: string[] = []
    const tool = cameraTool('place_object', 'execute', 'camera_stage.scene')
    registry.register({
      ...tool,
      execute: async (input: { objectId: string }) => {
        executions.push(tool.name)
        return { objectId: input.objectId }
      },
    })
    for (const builtin of createBackendBuiltinTools(registry, {
      describe: () => { throw new Error('本用例不读取 artifact') },
      read: () => { throw new Error('本用例不读取 artifact') },
    })) {
      if (builtin.name === 'declare_action_plan') registry.register(builtin)
    }

    const context = hostContext()
    const gateway = new AgentToolGateway({
      registry, getHostContext: () => context, appendPermissionAudit: async () => {},
    })
    let resolveTerminal: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { resolveTerminal = resolve })
    let modelCall = 0

    new AgentRunner({
      runId: 'run-superseded',
      request: request(),
      dependencies: {
        registry,
        gateway,
        getHostContext: () => context,
        runModelStep: vi.fn(async (input: ModelStepInput) => {
          if (input.stepId.startsWith('router:')) {
            return {
              ...base(input),
              finishReason: 'stop' as const,
              // 路由判成 canvas——领域整个错了，这条 Effect 没有任何已注册能力能满足。
              structuredOutput: {
                intent: 'canvas', complexity: 'ambiguous',
                reason: '误判为画布任务', toolDomains: ['canvas', 'camera_stage'],
              },
            }
          }
          modelCall += 1
          if (modelCall === 1) {
            // 模型读懂了用户，补建正确 Facet 并作废那个判错的。
            return withToolCall(input, 'call-declare', 'declare_action_plan', {
              facets: [{
                facetId: 'camera_scene_fixed',
                requiredEffects: [{
                  effect: 'execute', entityTypes: ['camera_stage.scene'], minimumCount: 1,
                }],
              }],
              actionGroups: [],
              supersededFacetIds: ['canvas'],
            })
          }
          if (modelCall === 2) {
            return withToolCall(input, 'call-place', 'place_object', { objectId: 'obj-sphere' })
          }
          return {
            ...base(input),
            finishReason: 'stop' as const,
            text: '已在三维工程里放置球体。',
            responseMessages: [{ role: 'assistant' as const, content: '已在三维工程里放置球体。' }],
          }
        }),
        cancelModelStep: vi.fn(),
        onEvent: () => {},
        onTerminal: resolveTerminal,
      },
    }).start()

    const state = await terminal
    expect(executions).toEqual(['place_object'])
    // 判错的 Facet 被作废后不再拖住结算——这正是上一次 VERIFICATION_REPAIR_FAILED 的死因。
    expect(state.status).toBe('completed')
  })
})
