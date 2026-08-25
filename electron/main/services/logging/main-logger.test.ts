import { describe, expect, it } from 'vitest'

import { serializeMainLogError } from './main-logger'

describe('serializeMainLogError', () => {
  it('保留 Error 的名称、消息、堆栈、错误码和 cause', () => {
    const cause = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const error = new Error('warmup failed', { cause })

    expect(serializeMainLogError(error)).toMatchObject({
      name: 'Error',
      message: 'warmup failed',
      stack: expect.stringContaining('warmup failed'),
      cause: {
        name: 'Error',
        message: 'permission denied',
        code: 'EACCES',
      },
    })
  })

  it('循环引用不会让日志序列化失败', () => {
    const error = new Error('cycle') as Error & { detail?: unknown }
    error.detail = error
    expect(serializeMainLogError(error)).toMatchObject({ detail: '[circular]' })
  })
})
