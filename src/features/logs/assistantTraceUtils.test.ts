import { describe, expect, it } from 'vitest'

import { agentTraceDetailResultSchema } from '@/core/assistant/trace'
import type { ModelStepMessage } from '@/core/llm/modelStep'
import { buildAgentTraceDiff } from './assistantTraceUtils'

const emptyUsage = {
  inputTokens: 10,
  inputNoCacheTokens: 10,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 5,
  textTokens: 5,
  reasoningTokens: 0,
  totalTokens: 15,
}

function createTrace(
  traceId: string,
  messages: ModelStepMessage[],
  tools: unknown,
  inputTokens: number
) {
  return agentTraceDetailResultSchema.parse({
    summary: {
      traceId,
      runId: 'run-1',
      requestId: `run-1:${traceId}`,
      stepId: traceId,
      kind: 'primary',
      turn: Number(traceId.slice(-1)),
      providerId: 'provider',
      modelId: 'model',
      status: 'completed',
      startedAt: new Date().toISOString(),
      usage: { ...emptyUsage, inputTokens, totalTokens: inputTokens + 5 },
      hasDetail: true,
      detailBytes: 100,
      originalDetailBytes: 100,
      detailTruncated: false,
    },
    detail: {
      schemaVersion: 'agent-trace/v1',
      logicalRequest: {
        system: '系统提示词',
        messages,
        tools,
        output: { mode: 'text' },
        capabilities: { streaming: true },
        settings: { temperature: 0.2 },
      },
      capture: {
        truncated: false,
        originalBytes: 100,
        storedBytes: 100,
        sections: [],
      },
    },
  })
}

describe('assistant trace diff', () => {
  it('以公共前后缀识别中间新增消息，并按工具名称比较变化', () => {
    const sharedStart: ModelStepMessage = { role: 'user', content: '开始任务' }
    const sharedEnd: ModelStepMessage = { role: 'assistant', content: '继续执行' }
    const previous = createTrace(
      'step-1',
      [sharedStart, sharedEnd],
      [{ name: 'query_logs', inputSchema: { type: 'object' } }],
      10
    )
    const current = createTrace(
      'step-2',
      [sharedStart, { role: 'tool', content: [{ type: 'tool-result', value: '新增结果' }] }, sharedEnd],
      [
        { name: 'query_logs', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
        { name: 'read_file', inputSchema: { type: 'object' } },
      ],
      18
    )

    const diff = buildAgentTraceDiff(previous, current)

    expect(diff?.messages).toMatchObject({
      unchangedPrefix: 1,
      unchangedSuffix: 1,
      changed: [],
    })
    expect(diff?.messages.added).toHaveLength(1)
    expect(diff?.messages.removed).toEqual([])
    expect(diff?.tools.added).toEqual(['read_file'])
    expect(diff?.tools.changed).toEqual(['query_logs'])
    expect(diff?.tokenDelta.input).toBe(8)
  })
})
