import { describe, expect, it } from 'vitest'

import type { AgentRunState } from '../../../src/core/assistant/events'
import { evaluateAssistantCliAcceptance } from './acceptance'

function state(input: Partial<AgentRunState>): AgentRunState {
  return {
    status: 'completed',
    executionOutcome: {
      status: 'sealed_success',
      effects: [{ effect: 'update' }],
      verificationSummary: { summary: '已从正式状态源读回。', evidence: [] },
      sealedAt: new Date().toISOString(),
    },
    presentationOutcome: { status: 'generated' },
    ...input,
  } as AgentRunState
}

describe('真实助手 CLI 验收', () => {
  it('应用已封存时，最终说明降级为 warning 仍判定真实执行成功', () => {
    expect(evaluateAssistantCliAcceptance(state({
      status: 'completed_with_warning',
      presentationOutcome: {
        status: 'fallback',
        warning: { code: 'MODEL_FAILED', message: '最终说明失败', retryable: false, recovery: 'none' },
      },
    }), true)).toMatchObject({ passed: true, effectCount: 1, presentationStatus: 'fallback' })
  })

  it('只返回完成文本但没有 Effect Receipt 时拒绝通过写入验收', () => {
    const result = evaluateAssistantCliAcceptance(state({
      executionOutcome: {
        status: 'sealed_success', effects: [],
        verificationSummary: { summary: '已验证。', evidence: [] },
        sealedAt: new Date().toISOString(),
      },
    }), true)
    expect(result.passed).toBe(false)
    expect(result.reasons).toContain('没有强类型应用 Effect Receipt')
  })

  it('外部生成完成且续接运行成功时，把正式任务终态作为跨运行 Effect 与验证事实', () => {
    const result = evaluateAssistantCliAcceptance(state({
      executionOutcome: {
        status: 'pending', effects: [], verificationSummary: { summary: '', evidence: [] },
      },
    }), true, 1)
    expect(result).toMatchObject({
      passed: true, executionSealed: true, effectCount: 1,
      verificationSummary: '已从正式生成任务状态确认 1 项外部写入完成。',
    })
  })
})
