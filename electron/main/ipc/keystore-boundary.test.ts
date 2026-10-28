import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { IpcMainInvokeEvent } from 'electron'
import { registerLogSecret } from '../../../src/core/logging/sanitize'

const mocks = vi.hoisted(() => ({
  channels: new Set<string>(),
  handlers: new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>>(),
  set: vi.fn(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>) => {
      mocks.channels.add(channel)
      mocks.handlers.set(channel, handler)
    },
  },
}))

vi.mock('../services/keystore', () => ({
  getProviderKeyInfo: vi.fn(() => ({ configured: true, maskedHint: '••••1234' })),
  getLlmProviderKeyStatus: vi.fn(() => []),
  removeAiProviderApiKey: vi.fn(),
  setAiProviderApiKey: mocks.set,
}))

import { registerKeystoreIpc } from './keystore'

describe('keystore renderer boundary', () => {
  beforeEach(() => {
    mocks.channels.clear()
    mocks.handlers.clear()
    mocks.set.mockReset()
    registerKeystoreIpc()
  })

  it('读取只返回摘要，供应商异常回显的凭据也不会跨 IPC', async () => {
    const event = {} as IpcMainInvokeEvent
    expect(await mocks.handlers.get('ai:getProviderKeyInfo')!(event, { providerId: 'fal' })).toEqual({ ok: true, data: { configured: true, maskedHint: '••••1234' } })
    registerLogSecret('opaque-ipc-fixture-secret')
    mocks.set.mockImplementationOnce(() => { throw new Error('request failed opaque-ipc-fixture-secret') })
    const result = await mocks.handlers.get('ai:setProviderApiKey')!(event, { providerId: 'fal', apiKey: 'new-key' })
    expect(result).toMatchObject({ ok: false })
    expect(JSON.stringify(result)).not.toContain('opaque-ipc-fixture-secret')
  })

  it('LLM 只暴露读取状态，写入必须走 provider settings 原子事务', () => {
    expect(mocks.channels.has('ai:getProviderApiKey')).toBe(false)
    expect(mocks.channels.has('llm:getProviderApiKey')).toBe(false)
    expect(mocks.channels.has('ai:getProviderKeyInfo')).toBe(true)
    expect(mocks.channels.has('llm:getProviderKeyStatus')).toBe(true)
    expect(mocks.channels.has('llm:setProviderApiKey')).toBe(false)
    expect(mocks.channels.has('llm:removeProviderApiKey')).toBe(false)
    expect([...mocks.channels].some(channel => channel.startsWith('keystore:'))).toBe(false)
  })
})
