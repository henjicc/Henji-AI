import { describe, expect, it, vi } from 'vitest'

import type { MainLogEvent } from '../../logging/types'
import { createQueryDiagnosticEventsTool, queryDiagnosticEvidence } from './query-diagnostic-events'

function logEvent(overrides: Partial<MainLogEvent> = {}): MainLogEvent {
  return {
    timestamp: '2026-07-23T00:05:00.000Z',
    level: 'error',
    domain: 'main.ai_runtime',
    event: 'generation.generate.failed',
    message: '请求失败 token=secret-value C:\\private\\file.png https://example.com/path?token=x',
    requestId: 'subject-run',
    source: 'backend',
    context: { errorCode: 'HTTP_ERROR', authorization: 'Bearer secret', ignored: 'not-allowed' },
    ...overrides,
  }
}

describe('queryDiagnosticEvidence', () => {
  it('优先按 requestId 查询并排除当前运行与 Agent 自身日志', async () => {
    const query = vi.fn().mockResolvedValue({
      events: [
        logEvent(),
        logEvent({ requestId: 'diagnostic-run' }),
        logEvent({ domain: 'main.agent_runtime' }),
      ],
      hasMore: false,
      corruptedLines: 0,
    })
    const output = await queryDiagnosticEvidence({
      subjectRequestId: 'subject-run',
      from: '2026-07-23T00:00:00.000Z',
      to: '2026-07-23T00:10:00.000Z',
      limit: 10,
    }, 'diagnostic-run', {
      listDates: () => Promise.resolve(['2026-07-23']),
      query,
    })

    expect(query).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'subject-run', domainPrefix: undefined }))
    expect(output.evidence).toHaveLength(1)
    expect(output.correlation).toMatchObject({ strategy: 'request_id', confidence: 'high' })
    expect(output.evidence[0].summary).not.toContain('secret-value')
    expect(output.evidence[0].summary).not.toContain('C:\\private')
    expect(output.evidence[0].details).toEqual({ errorCode: 'HTTP_ERROR' })
  })

  it('无 requestId 时明确降低置信度并限制分页', async () => {
    const query = vi.fn().mockResolvedValue({
      events: [logEvent({ requestId: undefined })],
      hasMore: true,
      corruptedLines: 0,
      nextBeforeLine: 100,
    })
    const output = await queryDiagnosticEvidence({
      from: '2026-07-23T00:00:00.000Z',
      to: '2026-07-23T00:10:00.000Z',
      limit: 10,
    }, 'diagnostic-run', {
      listDates: () => Promise.resolve(['2026-07-23']),
      query,
    })

    expect(query).toHaveBeenCalledTimes(3)
    expect(output.correlation).toMatchObject({ strategy: 'time_only', confidence: 'low', scannedPages: 3 })
    expect(output.truncated).toBe(true)
  })

  it('后续分页已读完时不误报裁剪', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce({
        events: [logEvent({ timestamp: '2026-07-23T00:05:00.000Z' })],
        hasMore: true,
        corruptedLines: 0,
        nextBeforeLine: 100,
      })
      .mockResolvedValueOnce({
        events: [logEvent({ timestamp: '2026-07-23T00:04:00.000Z' })],
        hasMore: false,
        corruptedLines: 0,
      })
    const output = await queryDiagnosticEvidence({
      subjectRequestId: 'subject-run',
      from: '2026-07-23T00:00:00.000Z',
      to: '2026-07-23T00:10:00.000Z',
      limit: 10,
    }, 'diagnostic-run', {
      listDates: () => Promise.resolve(['2026-07-23']),
      query,
    })

    expect(query).toHaveBeenCalledTimes(2)
    expect(output.evidence).toHaveLength(2)
    expect(output.truncated).toBe(false)
  })

  it('C2 诊断证据保留预览，并限制每轮只查询一次', async () => {
    const tool = createQueryDiagnosticEventsTool()
    const preview = await tool.preview?.({
      subjectRequestId: 'subject-run',
      from: '2026-07-23T00:00:00.000Z',
      to: '2026-07-23T00:10:00.000Z',
      limit: 10,
    }, {
      runId: 'diagnostic-run', threadId: 'thread-1', toolCallId: 'call-1',
      signal: new AbortController().signal, hostContext: null,
    })

    expect(tool).toMatchObject({
      risk: 'R2',
      openWorld: true,
      supportsPreview: true,
      maxCallsPerRun: 1,
    })
    expect(preview).toMatchObject({
      dataClasses: ['C2'],
      destination: '当前智能助手模型 Provider',
      targetIds: { requestId: 'subject-run' },
    })
  })
})
