import { expect, it } from 'vitest'
import { agentTraceQuerySchema, agentTraceQueryResultSchema } from './trace'

const timestamp = '2026-10-13T00:00:00.000Z'
it('追踪游标完整往返，拒绝缺少任一部分的分页请求和响应', () => {
  expect(agentTraceQuerySchema.parse({ beforeTimestamp: timestamp, beforeTraceId: 'trace-1' }))
    .toMatchObject({ beforeTimestamp: timestamp, beforeTraceId: 'trace-1' })
  expect(agentTraceQuerySchema.safeParse({ beforeTimestamp: timestamp }).success).toBe(false)
  expect(agentTraceQuerySchema.safeParse({ beforeTraceId: 'trace-1' }).success).toBe(false)
  expect(agentTraceQueryResultSchema.parse({ runs: [], hasMore: true, nextBeforeTimestamp: timestamp, nextBeforeTraceId: 'trace-1' }))
    .toHaveProperty('nextBeforeTraceId', 'trace-1')
  expect(agentTraceQueryResultSchema.safeParse({ runs: [], hasMore: true, nextBeforeTimestamp: timestamp }).success).toBe(false)
})
