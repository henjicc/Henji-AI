import { describe, expect, it, vi } from 'vitest'
const write = vi.hoisted(() => vi.fn())
vi.mock('./writer', () => ({ writeLogEventsToFile: write }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [] } }))

import { createMainLogger } from './main-logger'
import { sanitizeJsonValue } from './sanitize'
import { registerLogSecret, unregisterLogSecret } from '../../../../src/core/logging/sanitize'

describe('主进程错误日志', () => {
  it('请求追踪数据按字段名脱敏，任意字符串中的已登记凭据也脱敏', () => {
    const key = 'opaque-trace-fixture-credential'
    registerLogSecret(key, 'trace-fixture')
    try {
      expect(sanitizeJsonValue({ sessionToken: 'session', appSecret: 'app', authToken: 'auth', accessKeySecret: 'access', apiKeys: ['key'], response: { requestId: key, text: `echo ${key}`, chunks: [key] }, pageToken: 'next', maxToken: 10 })).toEqual({ sessionToken: '***', appSecret: '***', authToken: '***', accessKeySecret: '***', apiKeys: '***', response: { requestId: '***', text: 'echo ***', chunks: ['***'] }, pageToken: 'next', maxToken: 10 })
    } finally { unregisterLogSecret('trace-fixture') }
  })
  it('保留 Error 的名称、消息、堆栈、错误码和 cause', () => {
    const cause = Object.assign(new Error('permission denied'), { code: 'EACCES' })
    const error = new Error('warmup failed', { cause })

    createMainLogger('test').error('failure', { error })
    expect(write.mock.lastCall?.[0][0].error).toMatchObject({
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
    createMainLogger('test').error('failure', { error })
    expect(write.mock.lastCall?.[0][0].error).toMatchObject({ detail: '[circular]' })
  })
})
