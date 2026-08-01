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
    expect(result).toMatchObject({ passed: true, clarificationRequired: true })
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
    expect(result).toMatchObject({ passed: true, clarificationRequired: true })
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
    })).toMatchObject({ passed: true, clarificationRequired: true })
  })
})
