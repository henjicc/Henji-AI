import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'

import {
  AGENT_EVENT_SCHEMA_VERSION,
  agentEventSchema,
  type AgentEvent,
  type AgentEventInput,
} from '../../../../../src/core/assistant/events'
import { createAgentWorkingSummary } from '../../../../../src/core/assistant/workingContext'
import {
  assessInterruptedWorkingSummary,
  markWorkingSummaryRecoveryVerified,
  reduceAgentWorkingSummary,
} from './working-summary'
import { createSingleFacetTaskGraph } from '../../../../../src/core/assistant/taskGraph'

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
      type: 'PlanUpdated', intent: 'canvas', summary: '先读取目录再创建', toolDomains: ['canvas'],
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

  it('持久化 Facet 进展和结构化阻塞原因', () => {
    const taskGraph = createSingleFacetTaskGraph({
      goal: '修改三维镜头', facetId: 'camera', domain: 'camera_stage',
      capabilityKinds: ['mutate'], completionCondition: '返回新的 revision',
    })
    let summary = createAgentWorkingSummary('修改三维镜头')
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'PlanUpdated', intent: 'camera_stage', summary: '修改镜头',
      toolDomains: ['camera_stage'], taskGraph,
    }), null)
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'FacetProgressed',
      facetId: 'camera',
      status: 'blocked',
      progressKind: 'revision_conflict',
      summary: '相同 base revision 冲突后未刷新。',
      evidence: ['toolbox@4'],
      blocker: '需要先读取最新 revision。',
    }), null)

    expect(summary.route?.taskGraph?.facets[0]).toMatchObject({
      status: 'blocked',
      statusReason: '需要先读取最新 revision。',
      evidence: ['toolbox@4'],
    })
    expect(summary.unresolvedItems).toContain('camera：需要先读取最新 revision。')
  })

  it('后续验证通过时清除已经解决的 Facet 未结算提示', () => {
    let summary = createAgentWorkingSummary('播放动画')
    summary = reduceAgentWorkingSummary(summary, event({
      type: 'VerificationCompleted', passed: false,
      summary: '任务图仍有 1 个 Facet 未结算，不能提前结束。', evidence: [],
    }), null)
    expect(summary.unresolvedItems).toContain('任务图仍有 1 个 Facet 未结算，不能提前结束。')

    summary = reduceAgentWorkingSummary(summary, event({
      type: 'VerificationCompleted', passed: true,
      summary: '任务图全部完成。', evidence: ['playback:playing=true'],
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
