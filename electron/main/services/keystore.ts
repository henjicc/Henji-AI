import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import { createMainLogger } from './logging'

const logger = createMainLogger('main.services.keystore')

const APP_IDENTIFIER = 'com.henji.ai'
const DATA_DIR_NAME = 'Henji-AI'
const KEYSTORE_FILE_NAME = 'provider-keys.enc.json'

export const AI_KEY_NAMESPACE = 'ai'
export const KNOWN_AI_PROVIDER_IDS = ['ppio', 'fal', 'kie', 'apimart', 'bailian', 'volcengine', 'modelscope', 'grsai'] as const
export const LLM_KEY_NAMESPACE = 'llm'

type KeyNamespace = string

type KeystoreFile = {
  version: 1
  keys: Record<string, string>
}

function getBaseLocalDataDir(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, APP_IDENTIFIER)
  }

  return path.join(app.getPath('appData'), APP_IDENTIFIER)
}

function getKeystoreDir(): string {
  return path.join(getBaseLocalDataDir(), DATA_DIR_NAME)
}

function getKeystorePath(): string {
  return path.join(getKeystoreDir(), KEYSTORE_FILE_NAME)
}

function normalizeSegment(value: string, label: string): string {
  const normalized = value.trim()
  if (!normalized) {
    throw new Error(`${label} cannot be empty`)
  }
  if (!/^[a-zA-Z0-9:_-]+$/.test(normalized)) {
    throw new Error(`${label} contains invalid characters`)
  }
  return normalized
}

function buildKey(namespace: KeyNamespace, providerId: string): string {
  const normalizedNamespace = normalizeSegment(namespace, 'Key namespace')
  const normalizedProviderId = normalizeSegment(providerId, 'Provider id')
  return `${normalizedNamespace}:${normalizedProviderId}`
}

function createEmptyFile(): KeystoreFile {
  return { version: 1, keys: {} }
}

function readKeystoreFile(): KeystoreFile {
  const filePath = getKeystorePath()
  if (!fs.existsSync(filePath)) {
    return createEmptyFile()
  }

  const raw = fs.readFileSync(filePath, 'utf8')
  if (!raw.trim()) {
    return createEmptyFile()
  }

  const parsed = JSON.parse(raw) as Partial<KeystoreFile>
  if (parsed.version !== 1 || typeof parsed.keys !== 'object' || parsed.keys === null) {
    throw new Error('Invalid keystore file format')
  }

  return { version: 1, keys: { ...parsed.keys } }
}

function writeKeystoreFile(data: KeystoreFile): void {
  fs.mkdirSync(getKeystoreDir(), { recursive: true })
  fs.writeFileSync(getKeystorePath(), `${JSON.stringify(data, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
}

function ensureEncryptionAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron safeStorage encryption is not available on this device')
  }
}

export function setKey(namespace: KeyNamespace, providerId: string, apiKey: string): void {
  ensureEncryptionAvailable()
  const trimmedKey = apiKey.trim()
  if (!trimmedKey) {
    throw new Error('API key cannot be empty')
  }

  const data = readKeystoreFile()
  data.keys[buildKey(namespace, providerId)] = safeStorage.encryptString(trimmedKey).toString('base64')
  writeKeystoreFile(data)
}

export function removeKey(namespace: KeyNamespace, providerId: string): void {
  const data = readKeystoreFile()
  delete data.keys[buildKey(namespace, providerId)]
  writeKeystoreFile(data)
}

/**
 * 解不开的条目按"没有这个密钥"处理，不抛。
 *
 * 密文是用当前设备当前应用身份的密钥加密的，换机器、重置钥匙串、把资料目录拷到另一台机器、
 * 或以另一种方式启动同一份产物（例如自动化脚本直接跑 `out/main/index.cjs`），都会让
 * `decryptString` 抛错。此前这个错会一路冒到调用方，启动路径上就成了 unhandled rejection，
 * **窗口根本不出来**——一条读不出来的旧密钥把整个应用堵死。实测 `check:canvas-visual`
 * 就是这么起不来的。
 *
 * 返回 null 之后表现为"该供应商未配置密钥"，用户重新填一次即可；不主动删掉这条密文，
 * 因为钥匙串恢复后它还能用，静默删除是不可逆的。
 */
function decryptStoredKey(encrypted: string, storeKey: string): string | null {
  try {
    return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } catch (error) {
    logger.warn('已保存的密钥无法解密，按未配置处理', {
      event: 'keystore.decrypt.failed',
      context: { storeKey },
      error,
    })
    return null
  }
}

function readStoredKey(namespace: KeyNamespace, providerId: string): string | null {
  const storeKey = buildKey(namespace, providerId)
  const encrypted = readKeystoreFile().keys[storeKey]
  return encrypted ? decryptStoredKey(encrypted, storeKey) : null
}

export function getKey(namespace: KeyNamespace, providerId: string): string | null {
  ensureEncryptionAvailable()
  return readStoredKey(namespace, providerId)
}

/**
 * "有没有配"要和 `getKey` 读得出来保持一致：解不开的条目在界面上不该显示成已配置，
 * 否则用户看到"已配置"却怎么都用不了，也不知道该去重填。
 *
 * 这里不走 `getKey`，是为了不带上它的 `ensureEncryptionAvailable()`——设备没有可用加密时
 * 「查询有没有配」应该如实答"没有"，而不是抛错让整张状态列表失败。
 */
export function hasKey(namespace: KeyNamespace, providerId: string): boolean {
  return readStoredKey(namespace, providerId) !== null
}

export function setAiProviderApiKey(providerId: string, apiKey: string): void {
  setKey(AI_KEY_NAMESPACE, providerId, apiKey)
}

export function removeAiProviderApiKey(providerId: string): void {
  removeKey(AI_KEY_NAMESPACE, providerId)
}

export function getAiProviderApiKey(providerId: string): string | null {
  return getKey(AI_KEY_NAMESPACE, providerId)
}

export function getAiProviderKeyStatus(): Array<{ providerId: string; configured: boolean }> {
  return KNOWN_AI_PROVIDER_IDS.map((providerId) => ({
    providerId,
    configured: hasKey(AI_KEY_NAMESPACE, providerId),
  }))
}

export function setLlmProviderApiKey(providerId: string, apiKey: string): void {
  setKey(LLM_KEY_NAMESPACE, providerId, apiKey)
}

export function removeLlmProviderApiKey(providerId: string): void {
  removeKey(LLM_KEY_NAMESPACE, providerId)
}

export function getLlmProviderApiKey(providerId: string): string | null {
  const scoped = getKey(LLM_KEY_NAMESPACE, providerId)
  if (scoped !== null || providerId.trim().toLowerCase() !== 'ppio') {
    return scoped
  }

  return getAiProviderApiKey('ppio')
}

export function getLlmProviderKeyStatus(providerIds: string[]): Array<{ providerId: string; configured: boolean }> {
  return providerIds.map((providerId) => ({
    providerId,
    configured:
      hasKey(LLM_KEY_NAMESPACE, providerId) ||
      (providerId.trim().toLowerCase() === 'ppio' && hasKey(AI_KEY_NAMESPACE, 'ppio')),
  }))
}
