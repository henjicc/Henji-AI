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
})
