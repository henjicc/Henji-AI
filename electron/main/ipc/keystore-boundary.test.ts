import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  channels: new Set<string>(),
}))

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string) => {
      mocks.channels.add(channel)
    },
  },
}))

vi.mock('../services/keystore', () => ({
  getAiProviderApiKey: vi.fn(),
  getAiProviderKeyStatus: vi.fn(() => []),
  getLlmProviderApiKey: vi.fn(),
  getLlmProviderKeyStatus: vi.fn(() => []),
  removeAiProviderApiKey: vi.fn(),
  setAiProviderApiKey: vi.fn(),
}))

import { registerKeystoreIpc } from './keystore'

describe('keystore renderer boundary', () => {
  beforeEach(() => {
    mocks.channels.clear()
    registerKeystoreIpc()
  })

  it('LLM 只暴露读取状态，写入必须走 provider settings 原子事务', () => {
    expect([...mocks.channels].sort()).toEqual([
      'ai:getProviderApiKey',
      'ai:getProviderKeyStatus',
      'ai:removeProviderApiKey',
      'ai:setProviderApiKey',
      'llm:getProviderApiKey',
      'llm:getProviderKeyStatus',
    ])
    expect(mocks.channels.has('llm:setProviderApiKey')).toBe(false)
    expect(mocks.channels.has('llm:removeProviderApiKey')).toBe(false)
    expect([...mocks.channels].some(channel => channel.startsWith('keystore:'))).toBe(false)
  })
})
