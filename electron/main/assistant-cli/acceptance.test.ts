import { describe, expect, it } from 'vitest'

import type { AgentRunState } from '../../../src/core/assistant/events'
import type { AgentEffectKind } from '../../../src/core/assistant/observedEffect'
import { evaluateAssistantCliAcceptance } from './acceptance'

type SealedEffect = AgentRunState['executionOutcome']['effects'][number]

/** 按 Effect Receipt 的完整形状造一条，别用只有 `effect` 一个键的字面量强转。 */
function effect(kind: AgentEffectKind): SealedEffect {
  return {
    effect: kind, entityTypes: [], propertyIds: [], targetRefs: [],
    count: 1, verified: true, evidence: [`${kind}:fixture`],
  }
}

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

  it('只有读取观察时拒绝通过写入验收，并说清 Effect 全是读取', () => {
    /*
     * `--require-verified-write` 原先只数 `effects.length`，而它包含 observe——于是一次
     * **纯只读**的运行也能满足"要求至少一项应用写入"。实测工具箱只读查询（8 段脚本全是
     * entities.read / entities.list）产生 14 条 observe Effect，验收照样通过，这条门禁
     * 等于不存在。同一批数据还让封存摘要对用户说"已完成 14 项应用写入"。
     */
    const result = evaluateAssistantCliAcceptance(state({
      executionOutcome: {
        status: 'sealed_success',
        effects: [effect('observe'), effect('observe'), effect('navigate')],
        verificationSummary: { summary: '已读取。', evidence: [] },
        sealedAt: new Date().toISOString(),
      },
    }), true)
    expect(result.passed).toBe(false)
    expect(result.mutationCount).toBe(0)
    expect(result.effectCount).toBe(3)
    expect(result.reasons.join('\n')).toContain('全是读取或导航观察')
  })

  it('写入与读取混在一起时，只把写入计入 mutationCount', () => {
    const result = evaluateAssistantCliAcceptance(state({
      executionOutcome: {
        status: 'sealed_success',
        effects: [
          effect('observe'), effect('create'), effect('navigate'),
          effect('update'), effect('delete'), effect('execute'),
        ],
        verificationSummary: { summary: '已验证。', evidence: [] },
        sealedAt: new Date().toISOString(),
      },
    }), true)
    expect(result.passed).toBe(true)
    expect(result.effectCount).toBe(6)
    expect(result.mutationCount, 'create/update/delete/execute 算写入，observe/navigate 不算').toBe(4)
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
