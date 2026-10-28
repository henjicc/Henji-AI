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
  LLM_KEY_NAMESPACE,
  captureEncryptedKeySnapshot,
  getAiProviderKeyStatus,
  getAiProviderApiKey,
  getLlmProviderApiKey,
  getLlmProviderKeyStatus,
  getKey,
  getProviderKeyInfo,
  hasKey,
  restoreEncryptedKeySnapshot,
  removeAiProviderApiKey,
  setKey,
  setAiProviderApiKey,
  setLlmProviderApiKey,
} from './keystore'
import { createRegisteredSecretStreamRedactor, redactRegisteredSecretText } from '../../../src/core/logging/sanitize'

const KEYSTORE_RELATIVE_PATH = path.join('com.henji.ai', 'Henji-AI', 'provider-keys.enc.json')

function writeRawKeystore(keys: Record<string, string>): void {
  const filePath = path.join(mocks.appDataDir, KEYSTORE_RELATIVE_PATH)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify({ version: 1, keys }, null, 2))
}

describe('keystore', () => {
  beforeEach(() => {
    mocks.appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-keystore-'))
    vi.stubEnv('LOCALAPPDATA', mocks.appDataDir)
    mocks.isEncryptionAvailable.mockReturnValue(true)
  })

  afterEach(() => {
    fs.rmSync(mocks.appDataDir, { recursive: true, force: true })
    vi.unstubAllEnvs()
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

  it('仅在保存或解密成功后登记，替换、删除与补偿同步注销旧值', () => {
    const first = 'opaque-first-credential'
    const second = 'opaque-second-credential'
    const failed = 'opaque-failed-credential'
    mocks.encryptString.mockImplementationOnce(() => { throw new Error('encrypt failed') })
    expect(() => setAiProviderApiKey('log-test', failed)).toThrow('encrypt failed')
    expect(redactRegisteredSecretText(failed)).toBe(failed)
    setAiProviderApiKey('log-test', first)
    expect(redactRegisteredSecretText(first)).toBe('***')
    const snapshot = captureEncryptedKeySnapshot(AI_KEY_NAMESPACE, 'log-test')
    setAiProviderApiKey('log-test', second)
    expect(redactRegisteredSecretText(`${first} ${second}`)).toBe(`${first} ***`)
    restoreEncryptedKeySnapshot(snapshot)
    expect(redactRegisteredSecretText(`${first} ${second}`)).toBe(`*** ${second}`)
    removeAiProviderApiKey('log-test')
    expect(redactRegisteredSecretText(first)).toBe(first)
    writeRawKeystore({ 'provider:log-test': Buffer.from(`enc:${first}`).toString('base64') })
    getAiProviderApiKey('log-test')
    expect(redactRegisteredSecretText(first)).toBe('***')
    removeAiProviderApiKey('log-test')
  })

  it('落盘失败不登记待保存凭据', () => {
    const key = 'opaque-unwritten-credential'
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => { throw new Error('write failed') })
    try {
      expect(() => setAiProviderApiKey('failed-write', key)).toThrow('write failed')
      expect(redactRegisteredSecretText(key)).toBe(key)
    } finally { rename.mockRestore() }
  })

  it('MCP 连接 JSON 不作为整段凭据登记，解密和事务恢复同样适用', () => {
    const value = JSON.stringify({ connections: [{ token: 'mcp-test-connection-token' }] })
    setKey('mcp', 'connections', value)
    expect(redactRegisteredSecretText(value)).toBe(value)
    expect(getKey('mcp', 'connections')).toBe(value)
    const snapshot = captureEncryptedKeySnapshot('mcp', 'connections')
    restoreEncryptedKeySnapshot(snapshot)
    expect(redactRegisteredSecretText(value)).toBe(value)
    expect(createRegisteredSecretStreamRedactor().write('output {')).toBe('output {')
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

  it('生成与 LLM 对同一供应商读写同一个凭据槽', () => {
    setAiProviderApiKey('bailian', 'shared-from-generation')
    expect(getLlmProviderApiKey('bailian')).toBe('shared-from-generation')

    setLlmProviderApiKey('bailian', 'shared-from-llm')
    expect(getAiProviderApiKey('bailian')).toBe('shared-from-llm')
  })

  it('新语音供应商的凭据进入生成密钥状态', () => {
    setAiProviderApiKey('siliconflow', 'siliconflow-secret')
    setAiProviderApiKey('volcengine-speech', 'speech-secret')

    const status = new Map(getAiProviderKeyStatus().map(item => [item.providerId, item.configured]))
    expect(status.get('siliconflow')).toBe(true)
    expect(status.get('volcengine-speech')).toBe(true)
    expect(getAiProviderApiKey('siliconflow')).toBe('siliconflow-secret')
    expect(getAiProviderApiKey('volcengine-speech')).toBe('speech-secret')
  })

  it('旧生成与 LLM 密钥首次读取时迁入统一供应商槽', () => {
    writeRawKeystore({
      'ai:ppio': Buffer.from('enc:legacy-ppio').toString('base64'),
      'llm:bigmodel-cn': Buffer.from('enc:cn-secret').toString('base64'),
    })

    expect(getLlmProviderApiKey('ppio')).toBe('legacy-ppio')
    expect(getAiProviderApiKey('bigmodel-cn')).toBe('cn-secret')

    const stored = JSON.parse(fs.readFileSync(
      path.join(mocks.appDataDir, KEYSTORE_RELATIVE_PATH),
      'utf8'
    )) as { keys: Record<string, string> }
    expect(stored.keys['provider:ppio']).toBeTruthy()
    expect(stored.keys['provider:bigmodel-cn']).toBeTruthy()
    expect(stored.keys['ai:ppio']).toBeUndefined()
    expect(stored.keys['llm:bigmodel-cn']).toBeUndefined()
  })

  it('统一凭据状态按 credentialId 返回', () => {
    setAiProviderApiKey('ppio', 'legacy-ppio')
    setLlmProviderApiKey('bigmodel-cn', 'cn-secret')

    expect(getLlmProviderKeyStatus(['ppio', 'bigmodel-cn', 'bigmodel-global'])).toMatchObject([
      { credentialId: 'ppio', configured: true },
      { credentialId: 'bigmodel-cn', configured: true },
      { credentialId: 'bigmodel-global', configured: false },
    ])
    expect(getLlmProviderApiKey('ppio')).toBe('legacy-ppio')
    expect(getLlmProviderApiKey('bigmodel-global')).toBeNull()
  })

  it('任一入口清除密钥后不会被旧分区值重新带回', () => {
    writeRawKeystore({
      'ai:bailian': Buffer.from('enc:legacy-generation').toString('base64'),
      'llm:bailian': Buffer.from('enc:legacy-llm').toString('base64'),
    })
    expect(getLlmProviderApiKey('bailian')).toBe('legacy-generation')
    removeAiProviderApiKey('bailian')
    expect(getAiProviderApiKey('bailian')).toBeNull()
    expect(getLlmProviderApiKey('bailian')).toBeNull()
  })

  it('事务快照只包含密文并能恢复旧值', () => {
    setLlmProviderApiKey('shared-slot', 'old-secret')
    const snapshot = captureEncryptedKeySnapshot(LLM_KEY_NAMESPACE, 'shared-slot')
    expect(snapshot.encrypted).not.toContain('old-secret')

    setLlmProviderApiKey('shared-slot', 'new-secret')
    restoreEncryptedKeySnapshot(snapshot)
    expect(getLlmProviderApiKey('shared-slot')).toBe('old-secret')
  })

  it('原子替换失败不会覆盖已有密钥文件', () => {
    setLlmProviderApiKey('atomic-slot', 'old-secret')
    const rename = vi.spyOn(fs, 'renameSync').mockImplementationOnce(() => {
      throw new Error('fault: rename')
    })

    expect(() => setLlmProviderApiKey('atomic-slot', 'new-secret')).toThrow('fault: rename')
    rename.mockRestore()
    expect(getLlmProviderApiKey('atomic-slot')).toBe('old-secret')
  })
})

it('设置摘要从不返回完整密钥，替换、共享槽和清除保持一致', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'henji-key-info-'))
  vi.stubEnv('LOCALAPPDATA', dir)
  mocks.isEncryptionAvailable.mockReturnValue(true)
  try {
    setAiProviderApiKey('fal', 'fixture-provider-secret-1234')
    expect(getProviderKeyInfo('fal')).toEqual({ configured: true, maskedHint: '••••1234' })
    expect(getLlmProviderKeyStatus(['fal'])).toEqual([{ credentialId: 'fal', configured: true, maskedHint: '••••1234' }])
    setLlmProviderApiKey('fal', 'tiny')
    expect(getProviderKeyInfo('fal')).toEqual({ configured: true, maskedHint: '••••' })
    expect(getAiProviderApiKey('fal')).toBe('tiny')
    removeAiProviderApiKey('fal')
    expect(getProviderKeyInfo('fal')).toEqual({ configured: false, maskedHint: null })
  } finally { fs.rmSync(dir, { recursive: true, force: true }); vi.unstubAllEnvs() }
})
