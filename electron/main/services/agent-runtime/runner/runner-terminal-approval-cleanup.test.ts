import { z } from 'zod'
import { describe, expect, it, vi } from 'vitest'

import type { AgentEvent, AgentRunState } from '../../../../../src/core/assistant/events'
import { AGENT_CONTRACT_VERSION, type HostContextSnapshot } from '../../../../../src/core/assistant/hostContracts'
import type { AgentPermissionAuditFact } from '../../../../../src/core/assistant/permissionAudit'
import { AGENT_RUNTIME_SCHEMA_VERSION, type AgentStartRunRequest } from '../../../../../src/core/assistant/runtimeContracts'
import type { ModelStepInput, ModelStepResult } from '@henjicc/ai-sdk'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolGateway } from '../tools/gateway'
import { AgentToolRegistry } from '../tools/registry'
import { AgentRunner } from './runner'

const context: HostContextSnapshot = {
  schemaVersion: AGENT_CONTRACT_VERSION,
  rendererSessionId: 'renderer-terminal-cleanup',
  revision: 1,
  scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
  workspace: { id: 'generation', activeToolId: null },
  project: { id: null, selectedNodeId: null },
  generation: { commandReady: true },
  assets: { view: 'closed', selectedAssetId: null },
  uiReady: true,
  availableCapabilities: ['run_henji_script', 'get_host_context'],
  capturedAt: new Date().toISOString(),
}

function request(): AgentStartRunRequest {
  const verifiedAt = new Date().toISOString()
  return {
    schemaVersion: AGENT_RUNTIME_SCHEMA_VERSION,
    threadId: 'thread-terminal-cleanup',
    goal: '创建一张测试图片',
    approvalMode: 'ask',
    profile: {
      id: 'profile-terminal-cleanup',
      name: '终局清理测试',
      primary: { providerId: 'provider', modelId: 'model' },
      settings: { timeoutMs: 5_000, maxRetries: 0, maxOutputTokens: 1_000, contextWindowBudget: 8_000 },
      verifications: [{
        providerId: 'provider',
        modelId: 'model',
        adapterVersion: 'test',
        verifiedAt,
        checks: ['text', 'toolCall', 'structuredOutput', 'streaming', 'usage', 'cancel'].map((id) => ({
          id: id as 'text' | 'toolCall' | 'structuredOutput' | 'streaming' | 'usage' | 'cancel',
          status: 'passed' as const,
          latencyMs: 1,
        })),
        totalLatencyMs: 6,
        usage: {
          inputTokens: 1, outputTokens: 1, reasoningTokens: 0,
          cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 2,
        },
        cost: { status: 'unknown' },
      }],
      createdAt: verifiedAt,
      updatedAt: verifiedAt,
    },
    models: [{
      providerId: 'provider',
      modelId: 'model',
      displayName: '测试模型',
      adapter: 'openai-compatible',
      capabilities: {
        text: true, image: false, video: false, audio: false,
        streaming: true, toolCall: true, parallelTools: false,
        jsonOutput: true, structuredOutputMode: 'json',
        reasoning: false, sampling: true, contextWindow: 32_000,
        maxOutputTokens: 4_000, usage: true,
      },
      enabled: true,
    }],
  }
}

function modelResult(input: ModelStepInput, overrides: Partial<ModelStepResult>): ModelStepResult {
  return {
    requestId: input.requestId,
    runId: input.runId,
    stepId: input.stepId,
    providerId: input.providerId,
    modelId: input.modelId,
    text: '',
    reasoningText: '',
    structuredOutput: null,
    toolCalls: [],
    responseMessages: [{ role: 'assistant', content: '' }],
    finishReason: 'stop',
    usage: {
      inputTokens: 1, inputNoCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
      outputTokens: 1, textTokens: 1, reasoningTokens: 0, totalTokens: 2,
    },
    providerMetadataSummary: {},
    warnings: [],
    elapsedMs: 1,
    ...overrides,
  }
}

function createRegistry(execute: () => Promise<{ taskId: string }>): AgentToolRegistry {
  const registry = new AgentToolRegistry()
  registry.register(defineAgentTool({
    name: 'run_henji_script',
    version: 1,
    title: '创建生成任务',
    description: '创建一个测试生成任务。',
    capability: {
      id: 'run_henji_script', domain: 'application', aliases: [], dataClasses: ['C1'],
      acceptsRefs: [], producesRefs: ['generation.task'], availability: [], concurrencyKey: 'generation',
      control: { impacts: [{
        effect: 'execute', entityTypes: ['generation.task'], propertyIds: [],
        revisionScopes: ['generation'], verificationRequired: true,
      }] },
      resolveObservedEffects: (_input: { prompt: string }, output: { taskId: string }) => [{
        effect: 'execute', entityTypes: ['generation.task'], propertyIds: [],
        targetRefs: [{ kind: 'generation.task', id: output.taskId }], count: 1,
        verified: true, evidence: [`task:${output.taskId}`],
      }],
    } as never,
    category: 'generation',
    side: 'backend',
    risk: 'R2',
    permission: 'generation:create',
    readOnly: false,
    destructive: false,
    openWorld: true,
    idempotent: true,
    timeoutMs: 1_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: true,
    supportsUndo: false,
    requiredContext: ['generation'],
    inputSchema: z.object({ language: z.literal('henji-ts/v1'), summary: z.string(), source: z.string() }).strict(),
    outputSchema: z.object({ taskId: z.string() }).strict(),
    aiInputSchema: {
      type: 'object',
      properties: { language: { type: 'string' }, summary: { type: 'string' }, source: { type: 'string' } },
      required: ['language', 'summary', 'source'],
    },
    preview: () => ({
      title: '创建任务',
      summary: '创建一个测试任务。',
      targetIds: {},
      reversible: false,
      dataClasses: ['C1'],
    }),
    execute,
    concurrencyKey: () => 'generation:terminal-cleanup',
    targetIds: () => ({}),
    dataClasses: () => ['C1'],
    summarize: (output) => `已创建 ${output.taskId}`,
  }))
  return registry
}

describe('AgentRunner terminal approval cleanup', () => {
  it.each([
    ['事件', 'event_sink_failed'],
    ['检查点', 'checkpoint_sink_failed'],
  ] as const)('等待审批时%s持久化失败，会等待一次 RUN_TERMINATED 审计再终止', async (failureAt, code) => {
    const execute = vi.fn(async () => ({ taskId: 'should-not-run' }))
    const registry = createRegistry(execute)
    const audits: AgentPermissionAuditFact[] = []
    let releaseExpiredAudit: () => void = () => undefined
    let markExpiredAuditStarted: () => void = () => undefined
    const expiredAuditStarted = new Promise<void>((resolve) => { markExpiredAuditStarted = resolve })
    const expiredAuditGate = new Promise<void>((resolve) => { releaseExpiredAudit = resolve })
    const gateway = new AgentToolGateway({
      registry,
      getHostContext: () => context,
      appendPermissionAudit: async (fact) => {
        audits.push(fact)
        if (fact.event !== 'expired') return
        markExpiredAuditStarted()
        await expiredAuditGate
      },
    })
    const runModelStep = vi.fn(async (input: ModelStepInput) => {
      if (input.stepId.startsWith('router:')) {
        return modelResult(input, {
          structuredOutput: {
            intent: 'generate', reason: '创建图片',
          },
        })
      }
      return modelResult(input, {
        finishReason: 'tool-calls',
        toolCalls: [{
          toolCallId: 'tool-terminal-cleanup',
          toolName: 'run_henji_script',
          input: { language: 'henji-ts/v1', summary: '测试', source: 'await app.action("test", {});' },
          dynamic: false,
        }],
        responseMessages: [{
          role: 'assistant',
          content: [{
            type: 'tool-call',
            toolCallId: 'tool-terminal-cleanup',
            toolName: 'run_henji_script',
            input: { language: 'henji-ts/v1', summary: '测试', source: 'await app.action("test", {});' },
            dynamic: false,
          }],
        }],
      })
    })
    let terminalSettled = false
    let resolveTerminal: (state: AgentRunState) => void = () => undefined
    const terminal = new Promise<AgentRunState>((resolve) => { resolveTerminal = resolve })
      .then((state) => {
        terminalSettled = true
        return state
      })
    const runner = new AgentRunner({
      runId: `run-${code}`,
      request: request(),
      dependencies: {
        registry,
        gateway,
        getHostContext: () => context,
        runModelStep,
        cancelModelStep: vi.fn(),
        onEvent: (event: AgentEvent) => {
          if (failureAt === '事件' && event.type === 'ApprovalRequired') {
            throw new Error(`[${code}] 审批事件写入失败`)
          }
        },
        onCheckpoint: (state) => {
          if (failureAt === '检查点' && state.status === 'waiting_approval') {
            throw new Error(`[${code}] 审批检查点写入失败`)
          }
        },
        onTerminal: resolveTerminal,
      },
    })

    runner.start()
    await expiredAuditStarted
    await Promise.resolve()
    expect(terminalSettled).toBe(false)
    expect(runner.getState().status).not.toBe('failed')

    releaseExpiredAudit()
    await expect(terminal).resolves.toMatchObject({
      status: 'failed',
      error: { code },
    })
    const terminated = audits.filter((fact) => (
      fact.event === 'expired'
      && fact.authorization.reasonCode === 'RUN_TERMINATED'
    ))
    expect(terminated).toHaveLength(1)
    expect(execute).not.toHaveBeenCalled()
  })
})
