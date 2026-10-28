import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ write: vi.fn(), send: vi.fn() }))
vi.mock('./writer', () => ({ writeLogEventsToFile: mocks.write }))
vi.mock('electron', () => ({ BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send: mocks.send } }] } }))
import { appendLogEvents } from './push'
import { createMainLogger } from './main-logger'
import { registerLogSecret, unregisterLogSecret } from '../../../../src/core/logging/sanitize'

describe('主日志统一入口', () => {
  it.each(['frontend', 'backend'] as const)('%s 落盘和推送收到同一份已脱敏事件', async source => {
    mocks.write.mockClear(); mocks.send.mockClear()
    await appendLogEvents([{ timestamp: '2026-10-29', level: 'error', domain: 'test', event: 'failure', source,
      message: 'Authorization: Bearer fixture-plain', context: { apiKey: 'fixture-plain', cookie: 'sid=fixture-plain' }, error: new Error('api_key=fixture-plain') }])
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain('fixture-plain')
    expect(mocks.send.mock.calls[0][1]).toEqual(mocks.write.mock.calls[0][0])
  })
  it('推导事件名之前脱敏，防止转换后的密钥漏过文本匹配', async () => {
    mocks.write.mockClear()
    createMainLogger('test').error('api_key=fixture-plain')
    await Promise.resolve()
    expect(JSON.stringify(mocks.write.mock.calls)).not.toContain('fixture')
  })
  it('短值不污染结构标识，结构字段中的已登记凭据仍在落盘前替换', async () => {
    const value = 'opaque-metadata-credential'
    registerLogSecret('1', 'short-fixture')
    registerLogSecret(value, 'metadata-fixture')
    const metadata = { timestamp: '2026-10-29T12:34:56.000Z', event: 'request.failed', requestId: `chain-1-${value}` }
    await appendLogEvents([{ ...metadata, level: 'error', domain: 'test', source: 'frontend', message: `failed ${value}`, context: { runId: value, detail: value } }])
    expect(mocks.write.mock.lastCall?.[0][0]).toMatchObject({ ...metadata, requestId: 'chain-1-***', message: 'failed ***', context: { runId: '***', detail: '***' } })
    unregisterLogSecret('metadata-fixture')
  })
})
