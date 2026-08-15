import { z } from 'zod'
import { describe, expect, it } from 'vitest'

import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import { defineAgentTool } from '../tools/define-tool'
import { AgentToolRegistry } from '../tools/registry'
import { buildRecoveryGuidance } from './result-verifier'

/*
 * 这个文件曾经覆盖 verifyAgentCompletion 的一整套「最终答复措辞审判」：用正则检查中文答复里
 * 有没有出现 /无法|失败|未找到|不存在|需要|请提供|请确认|参数|权限|稍后/ 之一（explainsFailure）、
 * 有没有说「生成成功」（claimsSuccess）、有没有否认导航（deniesNavigation）。命不中就判失败并
 * 强制多烧一轮修正，二次不过整次运行报 VERIFICATION_REPAIR_FAILED。
 *
 * 那些检查的是词汇量而不是诚实度，已随 verifyAgentCompletion 一并删除。事实层现在由
 * run_henji_script 的 verification 承担（解释器对真相源逐步回读，见 completion-coordinator.test.ts），
 * 语义层交给模型和用户。
 *
 * 这里只剩 buildRecoveryGuidance：它按结构化 error code 生成下一步指引，输入是工具返回的事实、
 * 输出是给模型的信息而不是否决，属于底座。
 */

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

describe('结构化失败恢复指引', () => {
  it('未知写入副作用禁止自动重放', () => {
    const registry = registryWithTool({ name: 'write_test_resource', readOnly: false })
    const timeout = observation('write_test_resource', {
      ok: false,
      error: { code: 'TIMEOUT', message: '执行超时', retryable: true, recovery: 'wait' },
    })
    expect(buildRecoveryGuidance([timeout], registry)).toContain('副作用未知，禁止自动重放')
  })

  it('陈旧上下文与冲突要求用最新 revision 重新规划', () => {
    const registry = registryWithTool({ name: 'write_test_resource', readOnly: false })
    const stale = observation('write_test_resource', {
      ok: false,
      error: { code: 'STALE_CONTEXT', message: '快照过期', retryable: true, recovery: 'refresh_context' },
    })
    expect(buildRecoveryGuidance([stale], registry)).toContain('不得覆盖用户的新修改')
  })

  it('授权类失败明确说明未执行，且不得重复请求授权', () => {
    const registry = registryWithTool({ name: 'write_test_resource', readOnly: false })
    const rejected = observation('write_test_resource', {
      ok: false,
      error: { code: 'APPROVAL_REJECTED', message: '用户拒绝', retryable: false, recovery: 'none' },
    })
    expect(buildRecoveryGuidance([rejected], registry)).toContain('不得绕过或重复请求授权')
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

  it('没有失败时不下发恢复指引', () => {
    const registry = registryWithTool({ name: 'write_test_resource', readOnly: false })
    const success = observation('write_test_resource', { nodeId: 'node-1', revision: 3 })
    expect(buildRecoveryGuidance([success], registry)).toBeNull()
  })
})
