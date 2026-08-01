// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { AgentExecutionPresentation } from './agentRunReducer'
import { ExecutionPlanCard } from './ExecutionPlanCard'

describe('ExecutionPlanCard', () => {
  afterEach(cleanup)

  it('以用户可读状态展示 Facet、验证和大型证据', () => {
    const presentation: AgentExecutionPresentation = {
      summary: null,
      facets: [
        { facetId: 'observe', goal: '观察当前画布', domain: 'canvas', status: 'completed', reason: '已读取', evidence: ['canvas:1'] },
        { facetId: 'mutate', goal: '调整节点', domain: 'canvas', status: 'skipped', reason: '前置观察受阻', evidence: [] },
      ],
      artifactRefs: ['artifact:canvas-observation'],
      verification: null,
      clarification: null,
      lastCompaction: null,
      retrying: null,
      nextAction: '已提交外部任务，正在等待最终结果。',
    }

    render(<ExecutionPlanCard presentation={presentation} runStatus="waiting_external" />)

    expect(screen.getByText('等待结果')).toBeTruthy()
    expect(screen.getByLabelText('子目标状态').textContent).toContain('已完成')
    expect(screen.getByLabelText('子目标状态').textContent).toContain('已跳过')
    expect(screen.getByText('artifact:canvas-observation')).toBeTruthy()
  })
})
