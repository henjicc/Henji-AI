import { describe, expect, it, vi } from 'vitest'

import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import { AGENT_RUNTIME_SCHEMA_VERSION, type AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import type { AgentEvent, AgentRunState } from '../../../../../src/core/assistant/events'
import type { ModelStepInput, ModelStepResult } from '../../../../../src/core/llm/modelStep'
import { AgentToolGateway } from '../tools/gateway'
import { AgentToolRegistry } from '../tools/registry'
import { createBuiltinAgentToolRegistry } from '../tools/builtin'
import { AgentRunner } from './runner'
import type { AgentRunnerDependencies } from './types'

function hostContext(): HostContextSnapshot {
  return {
    schemaVersion: AGENT_CONTRACT_VERSION,
    rendererSessionId: 'renderer-1',
    revision: 1,
    scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
    workspace: { id: 'generation', activeToolId: null },
    project: { id: null, selectedNodeId: null },
    generation: { commandReady: true },
    assets: { view: 'closed', selectedAssetId: null },
    uiReady: true,
    availableCapabilities: ['get_host_context'],
    capturedAt: new Date().toISOString(),
  }
}

function runRequest(goal: string): AgentStartRunRequest {
  const verifiedAt = new Date().toISOString()
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId: 'thread-ask',
    goal,
    approvalMode: 'assistant_decides',
    profile: {
      id: 'profile-1',
      name: '测试配置',
      primary: { providerId: 'provider', modelId: 'model' },
      settings: { timeoutMs: 5_000, maxRetries: 0, maxOutputTokens: 1_000, contextWindowBudget: 8_000 },
      verifications: [{
        providerId: 'provider', modelId: 'model', adapterVersion: 'test', verifiedAt,
        checks: ['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel'].map((id) => ({
          id: id as 'text' | 'toolCall' | 'structuredOutput' | 'streaming' | 'usage' | 'cancel',
          status: 'passed' as const, latencyMs: 1,
        })),
        totalLatencyMs: 6,
        usage: {
          inputTokens: 1, outputTokens: 1, reasoningTokens: 0,
          cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2,
        },
        cost: { status: 'unknown' },
      }],
      createdAt: verifiedAt, updatedAt: verifiedAt,
    },
    models: [{
      providerId: 'provider', modelId: 'model', displayName: '测试模型',
      adapter: 'openai-compatible',
      capabilities: {
        text: true, image: false, video: false, audio: false, streaming: true,
        toolCall: true, parallelTools: false, jsonOutput: true,
        structuredOutputMode: 'json', reasoning: false, sampling: true,
        contextWindow: 32_000, maxOutputTokens: 4_000, usage: true,
      },
      enabled: true,
    }],
  }
}

function result(input: ModelStepInput, overrides: Partial<ModelStepResult> = {}): ModelStepResult {
  return {
    requestId: input.requestId, runId: input.runId, stepId: input.stepId,
    providerId: input.providerId, modelId: input.modelId,
    text: '已完成', reasoningText: '', structuredOutput: null, toolCalls: [],
    responseMessages: [{ role: 'assistant', content: '已完成' }],
    finishReason: 'stop',
    usage: {
      inputTokens: 10, inputNoCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 2, textTokens: 2, reasoningTokens: 0, totalTokens: 12,
    },
    providerMetadataSummary: {}, warnings: [], elapsedMs: 1,
    ...overrides,
  }
}

function createRuntime(registry: AgentToolRegistry) {
  return new AgentToolGateway({
    registry, getHostContext: hostContext, appendPermissionAudit: async () => {},
  })
}

/**
 * 存档点必须真的接上：没有 appendSavePoint 时协调器直接返回 null 且不发事件，
 * 于是"等待用户时是否可恢复"这条断言会变成永远不失败的空断言。
 */
function createSavePointRecorder(): {
  append: NonNullable<AgentRunnerDependencies['appendSavePoint']>
  stages: string[]
} {
  const stages: string[] = []
  return {
    stages,
    append: async (draft) => {
      stages.push(draft.stage)
      return {
        version: draft.version,
        stage: draft.stage,
        snapshot: {
          ...draft.snapshot,
          sessionHeadSequence: stages.length,
          createdAt: new Date().toISOString(),
        },
        stateSequence: stages.length,
        idempotencyKey: draft.idempotencyKey,
        createdAt: new Date().toISOString(),
      }
    },
  }
}

/**
 * 意图路由走的是同一个 runModelStep 依赖，必须先认出来单独作答。
 *
 * 否则路由会吃掉脚本里的第一次响应，主模型拿到的是第二条——测试里表现为"模型工具集为空、
 * 运行直接完成"，看起来像功能没接上，其实只是脚本错位。
 */
function isRouterCall(input: ModelStepInput): boolean {
  return input.output?.mode === 'object' && input.output.name === 'agent_intent_route'
}

function routerDecision(input: ModelStepInput): ModelStepResult {
  return result(input, {
    text: '',
    structuredOutput: {
      intent: 'assets',
      candidateIntents: ['assets'],
      toolDomains: ['assets'],
      complexity: 'simple',
      reason: '测试路由：素材库操作',
      explicitUserIntent: true,
      taskFacets: [{
        facetId: 'assets',
        goal: '完成素材库操作',
        capabilityKinds: ['mutate'],
        completionConditions: ['已完成素材库操作'],
      }],
    },
    responseMessages: [{ role: 'assistant', content: '' }],
  })
}

const QUESTION = '素材库里有两个都叫「参考图」的项目，你要改的是哪一个？'
const REASON = '按名称匹配到两个素材库，改错无法自动撤销。'

/**
 * 模型输出守卫要求 toolCalls 与 assistant 响应消息里的结构化 tool-call 严格对账
 * （toolCallId / toolName / input 摘要三者都要一致），否则判 MODEL_OUTPUT_INCOMPLETE
 * 并拒绝执行。伪造模型响应时必须同时给出这两份，缺一不可。
 */
function askUserStep(input: ModelStepInput): ModelStepResult {
  const call = {
    toolCallId: 'call-ask',
    toolName: 'ask_user',
    input: { question: QUESTION, reason: REASON },
  }
  return result(input, {
    text: '',
    toolCalls: [{ ...call, dynamic: false }],
    responseMessages: [{
      role: 'assistant',
      content: [{ type: 'tool-call', ...call }],
    }],
  })
}

describe('ask_user 澄清通道', () => {
  it('模型调用 ask_user 后运行停在 waiting_user 并广播问题', async () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const events: AgentEvent[] = []
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    let clarificationResolve: (waitId: string) => void = () => undefined
    const clarified = new Promise<string>((resolve) => { clarificationResolve = resolve })

    let step = 0
    let firstStepToolNames: string[] = []
    const savePoints = createSavePointRecorder()
    const runner = new AgentRunner({
      runId: 'ask-run-1', request: runRequest('把参考图素材库改个名字'),
      dependencies: {
        registry, gateway: createRuntime(registry), getHostContext: hostContext,
        appendSavePoint: savePoints.append,
        runModelStep: async (input) => {
          if (isRouterCall(input)) return routerDecision(input)
          step += 1
          if (step === 1) {
            firstStepToolNames = (input.tools ?? []).map((tool) => tool.name)
            return askUserStep(input)
          }
          return result(input, {
            text: '已按你选择的素材库完成改名。',
            responseMessages: [{ role: 'assistant', content: '已按你选择的素材库完成改名。' }],
          })
        },
        cancelModelStep: vi.fn(),
        onEvent: (event) => {
          events.push(event)
          if (event.type === 'ClarificationRequired' && event.waitId) clarificationResolve(event.waitId)
        },
        onTerminal: terminalResolve,
      },
    })

    runner.start()
    const waitId = await Promise.race([
      clarified,
      new Promise<string>((_, reject) => setTimeout(() => reject(new Error(
        `未进入澄清等待。首轮工具集=${JSON.stringify(firstStepToolNames)}；`
        + `事件=${JSON.stringify(events.map((event) => event.type))}；`
        + `失败详情=${JSON.stringify(events.filter((event) => (
          event.type === 'ToolFailed' || event.type === 'RunFailed'
        )))}`
      )), 3_000)),
    ])

    // ask_user 必须无条件出现在模型工具集里，纯闲聊也不例外。
    expect(firstStepToolNames).toContain('ask_user')
    // 停在等待态，问题原文与理由都来自模型的工具输入，不是从答复里嗅出来的。
    expect(runner.getState()).toMatchObject({ status: 'waiting_user', waitingClarificationId: waitId })
    expect(events.find((event) => event.type === 'ClarificationRequired')).toMatchObject({
      question: QUESTION, reason: REASON,
    })
    // 等待用户期间必须已存档，否则这次运行在等待中不可恢复。
    expect(savePoints.stages).toContain('waiting_user')
    expect(events.some((event) => (
      event.type === 'SavePointCreated' && event.stage === 'waiting_user'
    ))).toBe(true)

    runner.respondClarification(waitId, '用昨天创建的那个')
    const state = await terminal

    // 回答之后运行确实继续了：离开等待态、重新请求模型、进入终态。
    // 用 >=2 而不是 ==2：此刻仍存在的强制修正轮会额外再打一次模型（阶段 2 移除）。
    expect(step).toBeGreaterThanOrEqual(2)
    expect(state.status).not.toBe('waiting_user')
    expect(state.waitingClarificationId).toBeNull()
    /*
     * 这里刻意不断言 completed。终态此刻仍由任务图结算裁定——本次运行只提了个问题、
     * 没有写入，路由声明的 mutate Facet 结算不了，于是走强制修正并以
     * VERIFICATION_REPAIR_FAILED 收场。那套机制在阶段 2（删措辞裁判与修正轮）和
     * 阶段 5（删任务图结算）里移除，届时再把这条收紧为 completed。
     */
  })

  it('用户回答会作为上下文进入下一次模型请求，本轮上下文不丢失', async () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })
    let clarificationResolve: (waitId: string) => void = () => undefined
    const clarified = new Promise<string>((resolve) => { clarificationResolve = resolve })

    let step = 0
    let secondStepMessages = ''
    const runner = new AgentRunner({
      runId: 'ask-run-2', request: runRequest('把参考图素材库改个名字'),
      dependencies: {
        registry, gateway: createRuntime(registry), getHostContext: hostContext,
        runModelStep: async (input) => {
          if (isRouterCall(input)) return routerDecision(input)
          step += 1
          if (step === 1) return askUserStep(input)
          secondStepMessages = JSON.stringify(input.messages)
          return result(input, {
            text: '已按你选择的素材库完成改名。',
            responseMessages: [{ role: 'assistant', content: '已按你选择的素材库完成改名。' }],
          })
        },
        cancelModelStep: vi.fn(),
        onEvent: (event) => {
          if (event.type === 'ClarificationRequired' && event.waitId) clarificationResolve(event.waitId)
        },
        onTerminal: terminalResolve,
      },
    })

    runner.start()
    const waitId = await clarified
    runner.respondClarification(waitId, '用昨天创建的那个')
    await terminal

    expect(secondStepMessages).toContain('用昨天创建的那个')
    // 同一次运行内继续，不是新开一轮：原始目标仍在上下文里。
    expect(secondStepMessages).toContain('参考图')
  })

  /*
   * 反向门禁：证明旧的正则通道确实死了。
   *
   * 以前只要最终答复命中 /请提供|请确认|请选择|需要你|[?？]/ 就可能把运行挂进 waiting_user，
   * 于是模型随口一句反问就让用户对着一个自己不知道要答什么的问题干等。现在没调 ask_user
   * 就绝不进等待态——要么问（调工具），要么做完，不能用答复假装在问。
   */
  it('答复里满是请确认与问号但没调 ask_user 时，运行正常结束不进等待态', async () => {
    const registry = createBuiltinAgentToolRegistry(async () => {
      throw new Error('测试不执行前端工具')
    })
    const events: AgentEvent[] = []
    let terminalResolve: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { terminalResolve = resolve })

    const chatty = '请你确认一下这个方向对不对？需要我继续吗？请提供更多信息。请选择一个。'
    const runner = new AgentRunner({
      runId: 'ask-run-3', request: runRequest('随便聊聊你能做什么'),
      dependencies: {
        registry, gateway: createRuntime(registry), getHostContext: hostContext,
        runModelStep: async (input) => result(input, {
          text: chatty,
          responseMessages: [{ role: 'assistant', content: chatty }],
        }),
        cancelModelStep: vi.fn(),
        onEvent: (event) => events.push(event),
        onTerminal: terminalResolve,
      },
    })

    runner.start()
    const state = await terminal

    expect(state.status).not.toBe('waiting_user')
    expect(state.waitingClarificationId).toBeNull()
    expect(events.some((event) => event.type === 'ClarificationRequired')).toBe(false)
  })
})


