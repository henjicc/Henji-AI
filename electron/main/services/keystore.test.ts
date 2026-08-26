import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  appDataDir: '',
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((value: string) => Buffer.from(`enc:${value}`)),
  decryptString: vi.fn((buffer: Buffer) => {
    // 真实 safeStorage 在没有可用加密时同样解不开，mock 要保持这一点，
    // 否则「设备没有可用加密」那条用例根本没走到失败分支。
    if (!mocks.isEncryptionAvailable()) throw new Error('Encryption is not available')
    const raw = buffer.toString()
    if (!raw.startsWith('enc:')) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.')
    return raw.slice(4)
  }),
}))

vi.mock('electron', () => ({
  app: { getPath: () => mocks.appDataDir },
  safeStorage: {
    isEncryptionAvailable: mocks.isEncryptionAvailable,
    encryptString: mocks.encryptString,
    decryptString: mocks.decryptString,
  },
}))

vi.mock('./logging', () => ({
  createMainLogger: () => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}))

import {
  AI_KEY_NAMESPACE,
  getAiProviderKeyStatus,
  getKey,
  hasKey,
  setKey,
} from './keystore'

const KEYSTORE_RELATIVE_PATH = path.join('com.henji.ai', 'Henji-AI', 'provider-keys.enc.json')

function writeRawKeystore(keys: Record<string, string>): void {
  const filePath = path.join(mocks.appDataDir, KEYSTORE_RELATIVE_PATH)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, keys }, null, 2))
}

describe('keystore', () => {
  beforeEach(() => {
    mocks.appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-keystore-'))
    mocks.isEncryptionAvailable.mockReturnValue(true)
  })

  afterEach(() => {
    fs.rmSync(mocks.appDataDir, { recursive: true, force: true })
  })

  it('存进去的密钥能原样读回来', () => {
    setKey(AI_KEY_NAMESPACE, 'ppio', ' secret-key ')
    expect(getKey(AI_KEY_NAMESPACE, 'ppio')).toBe('secret-key')
    expect(hasKey(AI_KEY_NAMESPACE, 'ppio')).toBe(true)
  })

  it('没存过的密钥返回 null', () => {
    expect(getKey(AI_KEY_NAMESPACE, 'fal')).toBeNull()
    expect(hasKey(AI_KEY_NAMESPACE, 'fal')).toBe(false)
  })

  /*
   * 换机器、重置钥匙串、或以另一种方式启动同一份产物，都会让旧密文解不开。
   * 这个错以前会一路冒到启动路径变成 unhandled rejection，窗口根本不出来——
   * 一条读不出来的旧密钥把整个应用堵死。
   */
  it('解不开的旧密文按未配置处理，不抛错', () => {
    writeRawKeystore({ 'ai:ppio': Buffer.from('这不是本机加密的密文').toString('base64') })
    expect(() => getKey(AI_KEY_NAMESPACE, 'ppio')).not.toThrow()
    expect(getKey(AI_KEY_NAMESPACE, 'ppio')).toBeNull()
  })

  it('解不开时状态查询如实答"未配置"，不显示成已配置', () => {
    writeRawKeystore({ 'ai:ppio': Buffer.from('这不是本机加密的密文').toString('base64') })
    expect(hasKey(AI_KEY_NAMESPACE, 'ppio')).toBe(false)
    expect(getAiProviderKeyStatus().find(item => item.providerId === 'ppio')?.configured).toBe(false)
  })

  it('设备没有可用加密时，状态查询答"未配置"而不是让整张列表失败', () => {
    setKey(AI_KEY_NAMESPACE, 'ppio', 'secret-key')
    mocks.isEncryptionAvailable.mockReturnValue(false)
    expect(() => getAiProviderKeyStatus()).not.toThrow()
    expect(getAiProviderKeyStatus().every(item => item.configured === false)).toBe(true)
  })
})
