import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentEventSchema,
  type AgentEvent,
  type AgentEventInput,
} from '../../../../../src/core/assistant/events'
import { VERIFICATION_FAILURE_PREFIX } from '../../../../../src/core/assistant/workingSummaryReducer'
import { createAgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import {
  assessInterruptedWorkingSummary,
  markWorkingSummaryRecoveryVerified,
  reduceAgentWorkingSummary,
} from './working-summary'

function event(input: AgentEventInput): AgentEvent {
  return agentEventSchema.parse({
    ...input,
    schemaVersion: AGENT_EVENT_SCHEMA_VERSION,
    eventId: randomUUID(),
    sequence: 1,
    occurredAt: new Date().toISOString(),
    runId: 'run-summary',
  })
}

describe('Agent 工作摘要', () => {
  it('从计划与工具事件重建步骤和稳定证据', () => {
    let summary = createAgentWorkingSummary('创建画布节点')
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'PlanUpdated', explicitUserIntent: true, intent: 'canvas', summary: '先读取目录再创建', toolDomains: ['canvas'],
    }), null)
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'ToolRequested', toolCallId: 'call-1', toolName: 'create_node', title: '创建画布节点', inputDigest: 'digest',
      category: 'canvas', readOnly: false, idempotent: true,
    }), null)
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'ToolCompleted', toolCallId: 'call-1', toolName: 'create_node', summary: '节点已创建',
      resultReferences: { nodeId: 'node-1' },
    }), null)

    expect(summary).toMatchObject({
      route: { intent: 'canvas' },
      planVersion: 1,
      activeStep: null,
      completedSteps: [{ toolName: 'create_node', title: '创建画布节点', status: 'completed' }],
      evidence: [{ references: { nodeId: 'node-1' } }],
    })
  })

  it('中断的未知写入进入先验证后写入模式', () => {
    let summary = createAgentWorkingSummary('创建任务')
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'ToolRequested', toolCallId: 'call-write', toolName: 'create_task', inputDigest: 'digest',
      category: 'generation', readOnly: false, idempotent: false,
    }), null)
    const interrupted = assessInterruptedWorkingSummary(summary)
    expect(interrupted).toMatchObject({
      activeStep: null,
      recovery: {
        mode: 'verify_before_write',
        toolName: 'create_task',
        toolCategory: 'generation',
      },
    })
  })

  /*
   * 验证未通过的记录必须能被后来的一次通过清掉——unresolvedItems 非空会让 executionSealingBlocker
   * 拒绝封存，清不掉就等于整次运行再也封存不了。回收靠固定前缀，不靠匹配那句话的内容。
   */
  it('后续验证通过时清除上一次验证失败留下的未收敛项', () => {
    let summary = createAgentWorkingSummary('播放动画')
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'VerificationCompleted', passed: false,
      summary: '播放状态没有读回 playing=true。', evidence: [],
    }), null)
    expect(summary.unresolvedItems).toEqual([
      `${VERIFICATION_FAILURE_PREFIX}播放状态没有读回 playing=true。`,
    ])

    summary = reduceAgentWorkingSummary(summary, event({
      type: 'VerificationCompleted', passed: true,
      summary: '脚本逐步验证通过。', evidence: ['playback:playing=true'],
    }), null)
    expect(summary.unresolvedItems).toEqual([])
  })

  it('同一写入口后续成功时清除旧失败与恢复状态', () => {
    let summary = createAgentWorkingSummary('批量修改素材')
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'ToolRequested', toolCallId: 'call-failed', toolName: 'run_henji_script',
      inputDigest: 'bad-script', category: 'application', readOnly: false, idempotent: false,
    }), null)
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'ToolFailed', toolCallId: 'call-failed', toolName: 'run_henji_script',
      category: 'application', readOnly: false, idempotent: false,
      error: {
        code: 'EXECUTION_FAILED', message: '脚本预检失败', retryable: true,
        recovery: 'refresh_context',
      },
    }), null)
    expect(summary.recovery.mode).toBe('verify_before_write')

    summary = reduceAgentWorkingSummary(summary, event({
      type: 'ToolCompleted', toolCallId: 'call-success', toolName: 'run_henji_script',
      category: 'application', readOnly: false, idempotent: false,
      summary: '脚本执行和正式验证均已完成。', resultReferences: { scriptRunRef: 'script-1' },
    }), null)

    expect(summary.unresolvedItems).toEqual([])
    expect(summary.recovery.mode).toBe('none')
  })

  /*
   * 只读调用失败不算"欠着事没做完"。
   *
   * unresolvedItems 的唯一清除途径是同名工具后来成功一次；模型读一次失败就换条路把活干完
   * ——它本来就该这么做——那条记录就再也清不掉，而 executionSealingBlocker 见它非空就拒绝封存。
   * 实测设置场景：一次 read_agent_artifact 报 NOT_FOUND，模型换路完成任务、12 项正式验证全过、
   * 10 个真实写入，却因为这条陈年记录拿不到封存，整次运行被判不通过。
   */
  it('只读工具失败进入 failedSteps，但不挡封存', () => {
    let summary = createAgentWorkingSummary('修改设置并恢复')
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'ToolRequested', toolCallId: 'call-read', toolName: 'read_agent_artifact',
      inputDigest: 'digest', category: 'artifacts', readOnly: true, idempotent: true,
    }), null)
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'ToolFailed', toolCallId: 'call-read', toolName: 'read_agent_artifact',
      category: 'artifacts', readOnly: true, idempotent: true,
      error: {
        code: 'NOT_FOUND', message: 'Artifact 不存在或已删除', retryable: false, recovery: 'user_action',
      },
    }), null)

    // 失败照常留档，模型看得到；只是不再拿它去否决模型「已经做完」的判断。
    expect(summary.failedSteps).toMatchObject([{ toolName: 'read_agent_artifact', status: 'failed' }])
    expect(summary.unresolvedItems).toEqual([])
    expect(summary.recovery.mode).toBe('none')
  })

  it('写入工具失败照旧记账', () => {
    let summary = createAgentWorkingSummary('创建素材库')
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'ToolRequested', toolCallId: 'call-write', toolName: 'run_henji_script',
      inputDigest: 'digest', category: 'application', readOnly: false, idempotent: false,
    }), null)
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'ToolFailed', toolCallId: 'call-write', toolName: 'run_henji_script',
      category: 'application', readOnly: false, idempotent: false,
      error: {
        code: 'EXECUTION_FAILED', message: '脚本执行失败', retryable: true, recovery: 'refresh_context',
      },
    }), null)

    expect(summary.unresolvedItems).toEqual(['run_henji_script 未收敛：EXECUTION_FAILED'])
  })

  it('权威重读后清除 revision 恢复噪音，但保留真正丢失的产物', () => {
    const summary = createAgentWorkingSummary('续跑外部任务')
    summary.recovery = {
      mode: 'resume_read_only', reason: '宿主 revision 已变化，恢复后先重新读取状态。',
      toolName: null, toolCategory: null,
    }
    summary.unresolvedItems = [
      '恢复时宿主作用域已变化：generation；后续工具必须使用新 revision。',
      '1 个历史产物引用已不可用，不得据此声称已验证。',
    ]

    const recovered = markWorkingSummaryRecoveryVerified(summary)

    expect(recovered.recovery.mode).toBe('none')
    expect(recovered.unresolvedItems).toEqual([
      '1 个历史产物引用已不可用，不得据此声称已验证。',
    ])
  })
})
