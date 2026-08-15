import { describe, expect, it } from 'vitest'

import type { AgentEventInput } from '../../../../../src/core/assistant/events'
import type { AgentToolObservation } from '../../../../../src/core/assistant/toolContracts'
import { AgentCompletionCoordinator } from './completion-coordinator'

function observation(toolName: string, output: unknown): AgentToolObservation {
  return {
    source: { toolName, toolVersion: 1, toolCallId: `call-${toolName}` },
    trust: 'untrusted_observation',
    dataClasses: ['C0'],
    summary: `${toolName} 测试结果`,
    output,
  }
}

function scriptObservation(
  verification: { passed: boolean; summary: string; evidence: string[] }
): AgentToolObservation {
  return observation('run_henji_script', {
    ok: verification.passed,
    status: verification.passed ? 'completed' : 'partial',
    verification,
  })
}

function createCoordinator(): {
  coordinator: AgentCompletionCoordinator
  events: AgentEventInput[]
} {
  const events: AgentEventInput[] = []
  return {
    events,
    coordinator: new AgentCompletionCoordinator({
      runId: 'run-completion',
      emit: (event) => events.push(event),
    }),
  }
}

describe('AgentCompletionCoordinator', () => {
  it('验证结论取自 Henji Script 解释器的正式回读', () => {
    const { coordinator, events } = createCoordinator()
    const decision = coordinator.evaluate([
      observation('discover_application_capabilities', { capabilities: [] }),
      scriptObservation({
        passed: true,
        summary: 'Henji Script 已执行并通过 4 项正式验证。',
        evidence: ['s1:read-back:asset.library', 's2:created-read-back:1'],
      }),
    ])

    expect(decision).toMatchObject({ kind: 'accepted' })
    expect(events).toEqual([expect.objectContaining({
      type: 'VerificationCompleted',
      passed: true,
      summary: 'Henji Script 已执行并通过 4 项正式验证。',
      evidence: ['s1:read-back:asset.library', 's2:created-read-back:1'],
    })])
  })

  /*
   * 核心行为改变：验证未通过时如实广播，但**不再否决最终答复**。
   *
   * 旧实现会在这里返回 repair，多烧一整个模型回合让它重写措辞；第二次仍不过就抛
   * VERIFICATION_REPAIR_FAILED，把一次真实工作已经完成的运行整体判死。事实已经写进
   * VerificationCompleted 事件与工具回执，模型和用户都看得到，不需要运行时再当裁判。
   */
  it('验证未通过时如实广播但仍然接受最终答复，不进入强制修正', () => {
    const { coordinator, events } = createCoordinator()
    const decision = coordinator.evaluate([
      scriptObservation({
        passed: false,
        summary: '脚本未通过完整验证。',
        evidence: [],
      }),
    ])

    expect(decision.kind).toBe('accepted')
    expect(events).toEqual([expect.objectContaining({
      type: 'VerificationCompleted',
      passed: false,
      summary: '脚本未通过完整验证。',
    })])
  })

  it('本轮没有脚本执行时按无写入处理', () => {
    const { coordinator, events } = createCoordinator()
    const decision = coordinator.evaluate([
      observation('load_assistant_skill', { skill: '图片生成' }),
    ])

    expect(decision.kind).toBe('accepted')
    expect(events).toEqual([expect.objectContaining({
      type: 'VerificationCompleted',
      passed: true,
      summary: '本轮没有应用写入，无需结构化验证。',
    })])
  })

  it('多次脚本执行时以最后一次的正式结论为准', () => {
    const { coordinator, events } = createCoordinator()
    coordinator.evaluate([
      scriptObservation({ passed: false, summary: '第一段脚本预检失败。', evidence: [] }),
      scriptObservation({ passed: true, summary: '修正后的脚本已通过 2 项正式验证。', evidence: ['s1:read-back'] }),
    ])

    expect(events).toEqual([expect.objectContaining({
      passed: true,
      summary: '修正后的脚本已通过 2 项正式验证。',
    })])
  })
})
