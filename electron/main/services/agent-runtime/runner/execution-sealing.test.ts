import { describe, expect, it } from 'vitest'

import { createAgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import type { AgentProgressSettlement } from '../../../../../src/core/assistant/progress'
import { executionSealingBlocker } from './execution-sealing'

const completedSettlement: AgentProgressSettlement = {
  status: 'completed', completedFacetIds: ['write'], blockedFacets: [], waitingFacetIds: [],
  remainingFacetIds: [], evidence: ['verified'], summary: '完成', suggestedNextStep: null,
}

describe('执行事实封存门禁', () => {
  it('拒绝把仍有未收敛失败或恢复检查的运行封存为成功', () => {
    const summary = createAgentWorkingSummary('修改素材')
    summary.unresolvedItems = ['change_application_entities 未收敛：EXECUTION_FAILED']
    expect(executionSealingBlocker({ settlement: completedSettlement, summary, effectCount: 2 }))
      .toContain('未收敛')

    summary.unresolvedItems = []
    summary.recovery = {
      mode: 'verify_before_write', reason: '必须先读取素材真实状态。',
      toolName: 'change_application_entities', toolCategory: 'application',
    }
    expect(executionSealingBlocker({ settlement: completedSettlement, summary, effectCount: 2 }))
      .toContain('必须先读取')
  })

  it('任务完成、写入有回执且没有未决事项时允许封存', () => {
    expect(executionSealingBlocker({
      settlement: completedSettlement, summary: createAgentWorkingSummary('修改素材'), effectCount: 2,
    })).toBeNull()
  })
})
