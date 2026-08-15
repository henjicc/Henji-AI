import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import type { AgentRouteDecision } from '../context/types'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolRegistry } from '../tools/registry'
import { buildRecoveryGuidance, verifyAgentCompletion } from './result-verifier'
import { AgentCompletionCoordinator } from './completion-coordinator'

const generateRoute: AgentRouteDecision = {
  intent: 'generate',
  candidateIntents: ['generate'],
  complexity: 'simple',
  path: 'workflow',
  toolDomains: ['models', 'generation', 'navigation'],
  source: 'router_model',
  reason: '生成测试',
}

function observation(toolName: string, output: unknown): AgentToolObservation {
  return {
    source: { toolName, toolVersion: 1, toolCallId: `call-${toolName}` },
    trust: 'untrusted_observation',
    dataClasses: ['C0'],
    summary: `${toolName} 测试结果`,
    output,
  }
}

function registryWithTool(input: { name: string; readOnly: boolean }): AgentToolRegistry {
  const registry = new AgentToolRegistry()
  registry.register(defineAgentTool({
    name: input.name,
    version: 1,
    title: '测试工具',
    description: '验证结果证据。',
    category: 'generation',
    side: 'backend',
    risk: input.readOnly ? 'R0' : 'R1',
    permission: 'test:run',
    readOnly: input.readOnly,
    destructive: false,
    openWorld: false,
    idempotent: true,
    timeoutMs: 1_000,
    retryPolicy: { maxRetries: 0, baseDelayMs: 0 },
    supportsPreview: false,
    supportsUndo: false,
    requiredContext: [],
    inputSchema: z.object({}).strict(),
    outputSchema: z.record(z.string(), z.unknown()),
    aiInputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => Promise.resolve({}),
    concurrencyKey: () => input.name,
    targetIds: () => ({}),
    dataClasses: () => ['C0'],
    summarize: () => '测试完成',
  }))
  return registry
}

describe('Agent result verifier', () => {
  it('模糊一般请求转换为结构化澄清', () => {
    const result = verifyAgentCompletion({
      route: {
        ...generateRoute,
        intent: 'general',
        complexity: 'ambiguous',
        toolDomains: ['catalog'],
      },
      finalText: '请提供需要处理的项目名称和具体操作？',
      observations: [],
      registry: new AgentToolRegistry(),
    })
    /*
     * 措辞不再触发澄清。以前这句话里的「请提供」和问号会让运行挂进 waiting_user，
     * 而模型其实并没有请求提问——它只是那么写了。现在停不停下来由模型显式调用
     * ask_user 决定（见 runner/ask-user.test.ts），验证器不再从散文里嗅探意图。
     */
    expect(result).toMatchObject({ passed: true, clarificationRequired: false })
  })

  it('提交态允许如实结束但拒绝声称生成成功', () => {
    const registry = registryWithTool({ name: 'create_visible_generation_task', readOnly: false })
    const observations = [observation('create_visible_generation_task', {
      taskId: 'task-1', status: 'submitted', revision: 2,
    })]

    expect(verifyAgentCompletion({
      route: generateRoute,
      finalText: '任务 task-1 已提交，当前正在排队或生成。',
      observations,
      registry,
    }).passed).toBe(true)
    expect(verifyAgentCompletion({
      route: generateRoute,
      finalText: '图片生成成功。',
      observations,
      registry,
    }).passed).toBe(false)
  })

  it('写操作必须返回稳定引用、状态或 revision', () => {
    const registry = registryWithTool({ name: 'write_test_resource', readOnly: false })
    expect(verifyAgentCompletion({
      route: { ...generateRoute, intent: 'canvas', toolDomains: ['canvas'] },
      finalText: '已经修改。',
      observations: [observation('write_test_resource', { ok: true })],
      registry,
    }).passed).toBe(false)
    expect(verifyAgentCompletion({
      route: { ...generateRoute, intent: 'canvas', toolDomains: ['canvas'] },
      finalText: '节点 node-1 已写入。',
      observations: [observation('write_test_resource', { nodeId: 'node-1' })],
      registry,
    }).passed).toBe(true)
  })

  it('最终说明不得否认 Effect Receipt 已记录的界面导航', () => {
    const navigated: AgentToolObservation = {
      ...observation('run_henji_script', { status: 'completed', revision: 2 }),
      effects: [{
        effect: 'navigate', entityTypes: ['application.surface'], propertyIds: [],
        targetRefs: [{ kind: 'application.surface', id: 'workspace.canvas' }],
        count: 1, verified: true, evidence: [],
      }],
    }
    expect(verifyAgentCompletion({
      route: { ...generateRoute, intent: 'canvas', toolDomains: ['canvas'] },
      finalText: '任务已完成，全程未切换或打开任何界面。',
      observations: [navigated],
      registry: registryWithTool({ name: 'run_henji_script', readOnly: false }),
    })).toMatchObject({ passed: false, summary: expect.stringContaining('Effect Receipt') })
  })

  it('未知写入副作用禁止自动重放并能转为清晰澄清', () => {
    const registry = registryWithTool({ name: 'write_test_resource', readOnly: false })
    const timeout = observation('write_test_resource', {
      ok: false,
      error: { code: 'TIMEOUT', message: '执行超时', retryable: true, recovery: 'wait' },
    })
    expect(buildRecoveryGuidance([timeout], registry)).toContain('副作用未知，禁止自动重放')

    const invalid = observation('write_test_resource', {
      ok: false,
      error: { code: 'INVALID_INPUT', message: '目标不明确', retryable: true, recovery: 'user_action' },
    })
    const result = verifyAgentCompletion({
      route: { ...generateRoute, intent: 'canvas', toolDomains: ['canvas'] },
      finalText: '目标项目不明确，请提供要修改的 projectId？',
      observations: [invalid],
      registry,
    })
    // 失败被如实说明即可通过；是否停下来问用户由模型调 ask_user 决定，不再看措辞。
    expect(result).toMatchObject({ passed: true, clarificationRequired: false })
  })

  it('供应商参数错误要求保留原模型修正，生成中不重复轮询', () => {
    const registry = registryWithTool({ name: 'get_generation_task', readOnly: true })
    const parameterError = observation('get_generation_task', {
      task: {
        taskId: 'task-source',
        status: 'error',
        modelId: 'kie-z-image',
        recovery: {
          strategy: 'correct_same_model_parameters',
          sourceTaskId: 'task-source',
          sourceModelId: 'kie-z-image',
        },
      },
    })
    expect(buildRecoveryGuidance([parameterError], registry)).toContain('禁止搜索、读取或创建替代模型')

    const generating = observation('get_generation_task', {
      task: { taskId: 'task-next', status: 'generating' },
    })
    expect(buildRecoveryGuidance([generating], registry)).toContain('不得在同一 Agent 运行中立即重复读取')
  })

  it('最终事实冲突只允许一次结构化修正，第二次安全失败', () => {
    const registry = registryWithTool({
      name: 'create_visible_generation_task',
      readOnly: false,
    })
    const observations = [observation('create_visible_generation_task', {
      taskId: 'task-1',
      status: 'submitted',
    })]
    const coordinator = new AgentCompletionCoordinator({
      runId: 'run-verification',
      registry,
      emit: () => undefined,
    })

    expect(coordinator.evaluate(generateRoute, '图片生成成功。', observations))
      .toMatchObject({ kind: 'repair' })
    expect(() => coordinator.evaluate(generateRoute, '图片生成成功。', observations))
      .toThrowError('VERIFICATION_REPAIR_FAILED')
  })

  it('部分完成必须主动说明阻塞，等待用户时转入现有澄清流程', () => {
    const observations = [observation('read_camera', { revision: 5 })]
    const settlement = {
      status: 'partial' as const,
      completedFacetIds: ['scene'],
      blockedFacets: [{ facetId: 'motion', reason: '缺少动作能力' }],
      waitingFacetIds: [],
      remainingFacetIds: [],
      evidence: ['scene@5'],
      summary: '完成 1，受阻 1。',
      suggestedNextStep: '安装动作能力。',
    }
    expect(verifyAgentCompletion({
      route: generateRoute,
      finalText: '场景已完成，但动作部分受阻：当前缺少动作能力。',
      observations,
      registry: new AgentToolRegistry(),
      progressSettlement: settlement,
    })).toMatchObject({ passed: true, clarificationRequired: false })
    expect(verifyAgentCompletion({
      route: generateRoute,
      finalText: '已经全部完成。',
      observations,
      registry: new AgentToolRegistry(),
      progressSettlement: settlement,
    }).passed).toBe(false)

    expect(verifyAgentCompletion({
      route: generateRoute,
      finalText: '需要你确认要修改哪个对象，请提供对象 ID？',
      observations,
      registry: new AgentToolRegistry(),
      progressSettlement: {
        ...settlement,
        status: 'waiting_user',
        completedFacetIds: [],
        blockedFacets: [],
        waitingFacetIds: ['scene'],
      },
      // 结算为 waiting_user 时，答复如实说明受阻即算通过；把运行真正挂起等用户
      // 是模型调 ask_user 的结果，不再由这句话里的问号推断。
    })).toMatchObject({ passed: true, clarificationRequired: false })
  })

  it('第一次写入后 Effect Ledger 仍 active 时拒绝提前最终答复', () => {
    const registry = registryWithTool({ name: 'write_test_resource', readOnly: false })
    expect(verifyAgentCompletion({
      route: { ...generateRoute, intent: 'canvas', toolDomains: ['canvas'] },
      finalText: '两个节点都已经创建完成。',
      observations: [observation('write_test_resource', { nodeId: 'node-1', revision: 1 })],
      registry,
      progressSettlement: {
        status: 'active',
        completedFacetIds: [],
        blockedFacets: [],
        waitingFacetIds: [],
        remainingFacetIds: ['create_two_nodes'],
        evidence: ['canvas.node:node-1'],
        summary: '任务图仍有 1 个 Facet 未结算。',
        suggestedNextStep: null,
      },
    })).toMatchObject({
      passed: false,
      summary: '任务图仍有 1 个 Facet 未结算，不能提前结束。',
    })
  })
})
