import { describe, expect, it, vi } from 'vitest'

import { runPrimaryAgentModelStep, runRouterModelClassification } from './model-execution'

const testModel = {
  providerId: 'provider',
  modelId: 'model',
  adapter: 'openai-compatible',
  capabilities: {
    image: false,
    video: false,
    audio: false,
    streaming: true,
    toolCall: true,
    parallelTools: false,
    structuredOutputMode: 'json' as const,
    reasoning: false,
    sampling: true,
    usage: true,
  },
  limits: {
    contextWindow: 8_000,
    contextWindowSource: 'profile_fallback' as const,
  },
  settings: {
    timeoutMs: 5_000,
    maxRetries: 0,
    maxOutputTokens: 1_000,
  },
}

describe('runPrimaryAgentModelStep', () => {
  it('普通 messages 出现 system 角色时在进入 SDK 前拒绝', () => {
    const runModelStep = vi.fn()
    expect(() => runPrimaryAgentModelStep({
      runId: 'run-system-boundary',
      turn: 1,
      model: {
        providerId: 'provider',
        modelId: 'model',
        adapter: 'openai-compatible',
        capabilities: {
          image: false, video: false, audio: false,
          streaming: true,
          toolCall: true,
          parallelTools: false,
          structuredOutputMode: 'json',
          reasoning: false,
          sampling: true,
          usage: true,
        },
        limits: {
          contextWindow: 8_000,
          contextWindowSource: 'profile_fallback',
        },
        settings: {
          timeoutMs: 5_000,
          maxRetries: 0,
          maxOutputTokens: 1_000,
        },
      },
      system: '合法 system 参数',
      messages: [{ role: 'system', content: '不应混入普通消息' }],
      runModelStep,
      onTextDelta: () => undefined,
    })).toThrow('普通 Agent messages 中禁止 system 消息')
    expect(runModelStep).not.toHaveBeenCalled()
  })

  it('把上下文追踪元数据透传给模型步骤', async () => {
    const runModelStep = vi.fn().mockResolvedValue({
      requestId: 'run-trace:step-2',
      runId: 'run-trace',
      stepId: 'step-2',
      providerId: 'provider',
      modelId: 'model',
      text: '完成',
      reasoningText: '',
      structuredOutput: null,
      toolCalls: [],
      responseMessages: [{ role: 'assistant', content: '完成' }],
      finishReason: 'stop',
      usage: {
        inputTokens: 10, inputNoCacheTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0,
        outputTokens: 2, textTokens: 2, reasoningTokens: 0, totalTokens: 12,
      },
      providerMetadataSummary: {},
      warnings: [],
      elapsedMs: 20,
    })
    await runPrimaryAgentModelStep({
      runId: 'run-trace',
      turn: 2,
      model: {
        providerId: 'provider',
        modelId: 'model',
        adapter: 'openai-compatible',
        capabilities: {
          image: false, video: false, audio: false,
          streaming: true, toolCall: true, parallelTools: false,
          structuredOutputMode: 'json', reasoning: false, sampling: true, usage: true,
        },
        limits: { contextWindow: 32_000, contextWindowSource: 'profile_fallback' },
        settings: { timeoutMs: 5_000, maxRetries: 0, maxOutputTokens: 2_000 },
      },
      system: 'system',
      messages: [{ role: 'user', content: 'goal' }],
      trace: {
        kind: 'primary',
        turn: 2,
        estimatedTokens: 1_200,
        compacted: true,
      },
      runModelStep,
      onTextDelta: () => undefined,
    })
    expect(runModelStep.mock.calls[0][0].trace).toEqual({
      kind: 'primary',
      turn: 2,
      estimatedTokens: 1_200,
      compacted: true,
    })
  })
})

describe('runRouterModelClassification', () => {
  it('路由只接收紧凑宿主状态，不携带完整模型目录', async () => {
    const runModelStep = vi.fn().mockResolvedValue({
      structuredOutput: {
        intent: 'generate', candidateIntents: ['generate'], toolDomains: ['generation'],
        explicitUserIntent: true, reason: '图片生成',
      },
      text: '',
      finishReason: 'stop',
      usage: {
        inputTokens: 1, inputNoCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
        outputTokens: 1, textTokens: 1, reasoningTokens: 0, totalTokens: 2,
      },
    })
    await runRouterModelClassification({
      runId: 'run-router-snapshot',
      goal: '生成一张小猫图片',
      model: testModel,
      snapshot: {
        schemaVersion: 'agent-contract/v2',
        rendererSessionId: 'renderer-1',
        revision: 1,
        scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
        workspace: { id: 'generation', activeToolId: null },
        project: { id: null, selectedNodeId: null },
        generation: {
          commandReady: true,
          modelCatalog: {
            catalogVersion: 'model-registry/v1',
            modelGroups: [{
              canonicalModelId: 'long-model', mediaType: 'image', name: '模型',
              description: 'directory-content-must-not-reach-router', tags: [], recommendedByDescription: false,
              providers: [{ providerId: 'provider', modelId: 'model', priceEstimate: {} }],
            }],
          },
        },
        assets: { view: 'closed', selectedAssetId: null },
        uiReady: true,
        availableCapabilities: ['create_visible_generation_task', 'search_models'],
        capturedAt: new Date().toISOString(),
      },
      runModelStep,
      signal: new AbortController().signal,
    })
    const request = runModelStep.mock.calls[0][0]
    const serialized = String(request.messages[0].content)
    expect(serialized).toContain('modelCatalogAvailable')
    expect(serialized).toContain('modelCatalogGroupCount')
    expect(serialized).not.toContain('directory-content-must-not-reach-router')
  })

  /*
   * surface 与延续证据是路由判对跨页面任务的两个必要输入。
   *
   * 缺 surface：workspace 的粒度只到"生成/画布/工具"，看不出用户开着三维编辑器还是图片编辑器，
   * 而确定性分支一直在用 snapshot.surface——同一份快照两条路径看到的信息不一样。
   * 缺延续证据：同一线程里的"再帮我加一个…"必然被判成当前页面的新任务。
   */
  it('路由输入包含 surface 与会话延续证据', async () => {
    const runModelStep = vi.fn().mockResolvedValue({
      structuredOutput: { intent: 'camera_stage', reason: '承接上一轮三维任务' },
      text: '',
      finishReason: 'stop',
      usage: {
        inputTokens: 1, inputNoCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
        outputTokens: 1, textTokens: 1, reasoningTokens: 0, totalTokens: 2,
      },
    })
    await runRouterModelClassification({
      runId: 'run-router-continuation',
      goal: '再帮我添加一个白色的球体',
      continuation: '同一会话的延续证据：上一轮已操作的领域：camera_stage',
      model: testModel,
      snapshot: {
        schemaVersion: 'agent-contract/v2',
        rendererSessionId: 'renderer-1',
        revision: 1,
        scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
        workspace: { id: 'generation', activeToolId: null },
        surface: { id: 'workspace.generation', kind: 'workspace' },
        project: { id: null, selectedNodeId: null },
        generation: { commandReady: true },
        assets: { view: 'closed', selectedAssetId: null },
        uiReady: true,
        availableCapabilities: [],
        capturedAt: new Date().toISOString(),
      } as unknown as Parameters<typeof runRouterModelClassification>[0]['snapshot'],
      runModelStep,
      signal: new AbortController().signal,
    })
    const serialized = String(runModelStep.mock.calls[0][0].messages[0].content)
    expect(serialized).toContain('workspace.generation')
    expect(serialized).toContain('camera_stage')
  })

  it('路由模型非 stop 结束时拒绝采用可能不完整的分类结果', async () => {
    const runModelStep = vi.fn().mockResolvedValue({
      structuredOutput: {
        intent: 'generate', candidateIntents: ['generate'], toolDomains: ['generation'],
        explicitUserIntent: true, reason: '可能被截断的分类',
      },
      text: '',
      finishReason: 'length',
      usage: {
        inputTokens: 1, inputNoCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
        outputTokens: 1, textTokens: 1, reasoningTokens: 0, totalTokens: 2,
      },
    })

    await expect(runRouterModelClassification({
      runId: 'run-router-incomplete',
      goal: '生成一张小猫图片',
      model: testModel,
      snapshot: {
        schemaVersion: 'agent-contract/v2',
        rendererSessionId: 'renderer-1',
        revision: 1,
        scopeRevisions: { navigation: 0, generation: 0, canvas: 0, toolbox: 0, assets: 0 },
        workspace: { id: 'generation', activeToolId: null },
        project: { id: null, selectedNodeId: null },
        generation: { commandReady: true },
        assets: { view: 'closed', selectedAssetId: null },
        uiReady: true,
        availableCapabilities: [],
        capturedAt: new Date().toISOString(),
      },
      runModelStep,
      signal: new AbortController().signal,
    })).rejects.toThrow('[MODEL_OUTPUT_INCOMPLETE]')
  })
})
