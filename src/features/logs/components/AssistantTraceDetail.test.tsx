// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import type { AgentTraceDetailResult } from '@/core/assistant/trace'
import { AssistantTraceDetail } from './AssistantTraceDetail'

afterEach(cleanup)
it('混合长标签显式走下拉，保持可视化与原始 JSON 的取值切换', () => {
  const result: AgentTraceDetailResult = {
    summary: {
      traceId: 'trace', runId: 'run', requestId: 'request', stepId: 'step', kind: 'primary',
      providerId: 'test', modelId: 'test', status: 'completed', startedAt: '2026-10-14T00:00:00.000Z',
      hasDetail: false, detailBytes: 0, originalDetailBytes: 0, detailTruncated: false,
      usage: { inputTokens: 0, inputNoCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0,
        outputTokens: 0, textTokens: 0, reasoningTokens: 0, totalTokens: 0 },
    }, detail: null,
  }
  render(<AssistantTraceDetail result={result} loading={false} canCompare={false} onCompare={() => undefined} />)
  const trigger = screen.getByRole('button', { name: '追踪详情视图' })
  expect(screen.queryByRole('radiogroup')).toBeNull()
  expect(trigger.textContent).toContain('可视化')
  fireEvent.click(trigger)
  fireEvent.click(screen.getByRole('option', { name: '原始 JSON' }))
  expect(trigger.textContent).toContain('原始 JSON')
})
