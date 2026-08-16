// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentExecutionPresentation } from './agentRunReducer'
import { ExecutionPlanCard } from './ExecutionPlanCard'

/*
 * 这张卡原来展示的是任务图的子目标（Facet 完成/受阻/跳过）——运行前猜出来的步骤清单。
 * 任务图删除后它只展示已经发生的事实：运行状态、验证结论、大型证据引用。
 */
describe('ExecutionPlanCard', () => {
  afterEach(cleanup)

  it('展示运行状态、验证结论与大型证据', () => {
    const presentation: AgentExecutionPresentation = {
      summary: null,
      artifactRefs: ['artifact:canvas-observation'],
      verification: null,
      clarification: null,
      lastCompaction: null,
      retrying: null,
      nextAction: '已提交外部任务，正在等待最终结果。',
    }

    render(<ExecutionPlanCard presentation={presentation} runStatus="waiting_external" />)

    expect(screen.getByText('等待结果')).toBeTruthy()
    expect(screen.getByText('artifact:canvas-observation')).toBeTruthy()
    expect(screen.getAllByText(/已提交外部任务/).length).toBeGreaterThan(0)
  })

  it('待补充状态由 ask_user 驱动的澄清事件决定', () => {
    const presentation: AgentExecutionPresentation = {
      summary: null,
      artifactRefs: [],
      verification: null,
      clarification: {
        type: 'ClarificationRequired',
        schemaVersion: 'agent-event/v2',
        eventId: 'event-1',
        sequence: 1,
        occurredAt: new Date(0).toISOString(),
        runId: 'run-1',
        waitId: 'wait-1',
        question: '要用哪个素材库？',
        reason: '同名素材库有两个',
      },
      lastCompaction: null,
      retrying: null,
      nextAction: '要用哪个素材库？',
    }

    render(<ExecutionPlanCard presentation={presentation} runStatus="waiting_user" />)

    expect(screen.getByText('待补充')).toBeTruthy()
  })
})
