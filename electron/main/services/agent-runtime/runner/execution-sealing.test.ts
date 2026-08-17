import { describe, expect, it } from 'vitest'

import { createAgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import { executionSealingBlocker, sealingCaveat } from './execution-sealing'

/*
 * 这里曾经有第一条判据 `settlement.status !== 'completed' → '任务图尚未完成'`，也曾经有一条
 * `unresolvedItems.length > 0 → 仍有未收敛事项`。两条都是拿"做得好不好"当"停没停下来"。
 * 现在剩下的三条全是事实：手上还有没有活、审批批完没、恢复检查做完没。
 */
describe('执行事实封存门禁', () => {
  it('没有任何真实写入时不封存', () => {
    expect(executionSealingBlocker({
      summary: createAgentWorkingSummary('看一眼素材库'), effectCount: 0,
    })).toContain('没有可封存')
  })

  /*
   * 实测生成场景：图片真的出图、画布工程真的建成、8 个 Effect 有读回证据，模型多试了一次
   * 多余的脚本调用失败后自己判断"那步不必要"并给出最终答复。旧判据让那次失败把已经发生的
   * 8 项写入永久钉死在 pending——拒绝封存不能让写入回滚，只会把事实从记录里抹掉。
   */
  it('中途有没做成的事，不妨碍把已经发生的写入封存', () => {
    const summary = createAgentWorkingSummary('生成图片并放进画布')
    summary.unresolvedItems = ['run_henji_script 未收敛：SCRIPT_API_NOT_DISCOVERED']
    expect(executionSealingBlocker({ summary, effectCount: 8 })).toBeNull()
  })

  it('未收敛事项必须原样出现在封存摘要的保留意见里', () => {
    const summary = createAgentWorkingSummary('生成图片并放进画布')
    summary.unresolvedItems = [
      'run_henji_script 未收敛：SCRIPT_API_NOT_DISCOVERED',
      '验证未通过：脚本未通过完整验证。',
    ]
    const caveat = sealingCaveat(summary)
    expect(caveat).toContain('SCRIPT_API_NOT_DISCOVERED')
    expect(caveat).toContain('验证未通过')
    expect(sealingCaveat(createAgentWorkingSummary('随便看看'))).toBe('')
  })

  it('恢复检查没做完时不封存', () => {
    const summary = createAgentWorkingSummary('修改素材')
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
