import { describe, expect, it } from 'vitest'

import { createAgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import { executionSealingBlocker } from './execution-sealing'

/*
 * 这里曾经有第一条判据 `settlement.status !== 'completed' → '任务图尚未完成'`。它拦下的是
 * "运行前猜出来的那张 Facet 图没对上账"，而不是"这次运行还没停下来"。任务图删除后剩下的四条
 * 全是事实：有没有真实写入、手上还有没有活、审批批完没、恢复检查做完没、有没有记下的未收敛项。
 */
describe('执行事实封存门禁', () => {
  it('没有任何真实写入时不封存', () => {
    expect(executionSealingBlocker({
      summary: createAgentWorkingSummary('看一眼素材库'), effectCount: 0,
    })).toContain('没有可封存')
  })

  it('拒绝把仍有未收敛失败或恢复检查的运行封存为成功', () => {
    const summary = createAgentWorkingSummary('修改素材')
    summary.unresolvedItems = ['change_application_entities 未收敛：EXECUTION_FAILED']
    expect(executionSealingBlocker({ summary, effectCount: 2 })).toContain('未收敛')

    summary.unresolvedItems = []
    summary.recovery = {
      mode: 'verify_before_write', reason: '必须先读取素材真实状态。',
      toolName: 'change_application_entities', toolCategory: 'application',
    }
    expect(executionSealingBlocker({ summary, effectCount: 2 })).toContain('必须先读取')
  })

  it('还有执行中的步骤或待批审批时不封存', () => {
    const summary = createAgentWorkingSummary('修改素材')
    summary.activeStep = {
      stepId: 'step-1', title: '运行 Henji Script', status: 'active',
      toolName: 'run_henji_script', toolCategory: 'application',
      readOnly: false, idempotent: false, summary: '', evidence: [],
      startedAt: new Date(0).toISOString(), completedAt: null,
    }
    expect(executionSealingBlocker({ summary, effectCount: 2 })).toContain('执行中')

    const pending = createAgentWorkingSummary('修改素材')
    pending.pendingApprovals = [{
      approvalId: 'approval-1', toolCallId: 'call-1',
      toolName: 'run_henji_script', expiresAt: new Date(0).toISOString(),
    }]
    expect(executionSealingBlocker({ summary: pending, effectCount: 2 })).toContain('审批')
  })

  it('有真实写入且运行客观上已经停下来时允许封存', () => {
    expect(executionSealingBlocker({
      summary: createAgentWorkingSummary('修改素材'), effectCount: 2,
    })).toBeNull()
  })
})
