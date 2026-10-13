// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { AgentTraceQuery, AgentTraceQueryResult, AgentTraceRunSummary } from '@/core/assistant/trace'
import { AssistantTracePanel } from './AssistantTracePanel'
import { UiButton } from '@/components/ui/primitives'

const mocks = vi.hoisted(() => ({ query: vi.fn<[AgentTraceQuery], Promise<AgentTraceQueryResult>>() }))
vi.mock('@/commands/logging', () => ({ queryAgentTraces: mocks.query,
  getAgentTraceCaptureMode: async () => 'summary', listLogDates: async () => [], getAgentTraceDetail: async () => null,
  clearAgentTraces: vi.fn(), setAgentTraceCaptureMode: vi.fn(),
}))
vi.mock('./AssistantTraceToolbar', () => ({ AssistantTraceToolbar: () => null }))
vi.mock('./AssistantTraceDetail', () => ({ AssistantTraceDetail: () => null }))
vi.mock('./AssistantTraceDiffDialog', () => ({ AssistantTraceDiffDialog: () => null }))
vi.mock('./AssistantTraceList', () => ({ AssistantTraceList: ({ runs, onLoadMore }: { runs: AgentTraceRunSummary[]; onLoadMore(): void }) => <>
  <UiButton onClick={onLoadMore}>加载更多</UiButton><output>{JSON.stringify(runs)}</output>
</> }))
afterEach(() => { cleanup(); vi.clearAllMocks() })
const timestamp = '2026-10-13T00:00:00.000Z'
const usage = { inputTokens: 1, inputNoCacheTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0,
  outputTokens: 1, textTokens: 1, reasoningTokens: 0, totalTokens: 2 }
const page = (ids: string[], cursor?: string): AgentTraceQueryResult => ({
  runs: [{ runId: 'run', status: 'completed', startedAt: timestamp, updatedAt: timestamp, requestCount: ids.length,
    completedCount: ids.length, failedCount: 0, totalElapsedMs: ids.length * 10, usage,
    steps: ids.map(traceId => ({ traceId, runId: 'run', requestId: traceId, stepId: traceId, kind: 'primary',
      providerId: 'test', modelId: 'test', status: 'completed', startedAt: timestamp, elapsedMs: 10, usage,
      hasDetail: false, detailBytes: 0, originalDetailBytes: 0, detailTruncated: false })) }],
  hasMore: Boolean(cursor), ...(cursor ? { nextBeforeTimestamp: timestamp, nextBeforeTraceId: cursor } : {}),
})
it('加载更多携带复合游标并继续传递新游标，跨页运行去重后重算汇总', async () => {
  mocks.query.mockResolvedValueOnce(page(['c'], 'c')).mockResolvedValueOnce(page(['c', 'b'], 'b')).mockResolvedValueOnce(page(['a']))
  const { container } = render(<AssistantTracePanel refreshToken={0} surfaceSwitch={null} />)
  await waitFor(() => expect(container.querySelector('output')?.textContent).toContain('"traceId":"c"'))
  fireEvent.click(screen.getByText('加载更多'))
  await waitFor(() => expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ beforeTimestamp: timestamp, beforeTraceId: 'c' })))
  await waitFor(() => expect(container.querySelector('output')?.textContent).toContain('"traceId":"b"'))
  fireEvent.click(screen.getByText('加载更多'))
  await waitFor(() => expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ beforeTraceId: 'b' })))
  await waitFor(() => {
    const runs = JSON.parse(container.querySelector('output')?.textContent ?? '[]') as AgentTraceRunSummary[]
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ requestCount: 3, completedCount: 3, totalElapsedMs: 30, usage: { totalTokens: 6 } })
  })
})
