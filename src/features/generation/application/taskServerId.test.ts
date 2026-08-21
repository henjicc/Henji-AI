import { describe, expect, it } from 'vitest'

import { extractServerTaskIdFromErrorMessage, extractServerTaskIdFromMetadata } from './taskServerId'

describe('taskServerId', () => {
  it('APIMart 同时返回任务 ID 和请求 ID 时优先使用 data.id', () => {
    expect(extractServerTaskIdFromMetadata({
      code: 202,
      data: {
        id: 'task_01M0K18CQAXCCNEQF0GJ9N62RA',
        status: 'pending',
      },
      request_id: '2026082204473360758145kV3G8IpC',
    })).toBe('task_01M0K18CQAXCCNEQF0GJ9N62RA')
  })

  it('兼容 KIE 的 data.taskId 与 Fal 的 request_id', () => {
    expect(extractServerTaskIdFromMetadata({
      data: { taskId: 'kie-task-id' },
      requestId: 'trace-id',
    })).toBe('kie-task-id')
    expect(extractServerTaskIdFromMetadata({ request_id: 'fal-request-id' }))
      .toBe('fal-request-id')
  })

  it('错误文本同时含任务 ID 和请求 ID 时优先使用任务 ID', () => {
    expect(extractServerTaskIdFromErrorMessage(
      'request_id=trace-id, task_id=real-task-id'
    )).toBe('real-task-id')
    expect(extractServerTaskIdFromErrorMessage(
      '{"requestId":"trace-id","taskId":"real-task-id"}'
    )).toBe('real-task-id')
  })
})
