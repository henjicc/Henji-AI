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
})
