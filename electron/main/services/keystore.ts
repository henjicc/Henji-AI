import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

import { createMainLogger } from './logging'

const logger = createMainLogger('main.services.keystore')

const APP_IDENTIFIER = 'com.henji.ai'
const DATA_DIR_NAME = 'Henji-AI'
const KEYSTORE_FILE_NAME = 'provider-keys.enc.json'

/**
 * 供应商凭据统一空间。
 *
 * 生成、LLM、语音识别等能力只描述同一供应商密钥的不同消费方式，不再各存一份。
 * `AI_KEY_NAMESPACE` / `LLM_KEY_NAMESPACE` 保留为源码兼容别名，实际都指向这里；旧文件里的
 * `ai:*` / `llm:*` 会在首次读取时无损迁移。
 */
export const PROVIDER_KEY_NAMESPACE = 'provider'
export const AI_KEY_NAMESPACE = PROVIDER_KEY_NAMESPACE
export const KNOWN_AI_PROVIDER_IDS = ['ppio', 'fal', 'kie', 'apimart', 'bailian', 'volcengine', 'modelscope', 'grsai'] as const
export const LLM_KEY_NAMESPACE = PROVIDER_KEY_NAMESPACE

const LEGACY_AI_KEY_NAMESPACE = 'ai'
const LEGACY_LLM_KEY_NAMESPACE = 'llm'

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
  const dir = getKeystoreDir()
  const target = getKeystorePath()
  const temporary = path.join(dir, `.${KEYSTORE_FILE_NAME}.${process.pid}.${randomUUID()}.tmp`)
  fs.mkdirSync(dir, { recursive: true })
  let descriptor: number | null = null
  try {
    descriptor = fs.openSync(temporary, 'wx', 0o600)
    fs.writeFileSync(descriptor, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    fs.fsyncSync(descriptor)
    fs.closeSync(descriptor)
    descriptor = null
    fs.renameSync(temporary, target)
    fs.chmodSync(target, 0o600)
    fsyncDirectory(dir)
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor)
    try { fs.unlinkSync(temporary) } catch { /* 临时文件可能尚未创建或已 rename。 */ }
    throw error
  }
}

function fsyncDirectory(dir: string): void {
  if (process.platform === 'win32') return
  const descriptor = fs.openSync(dir, 'r')
  try {
    fs.fsyncSync(descriptor)
  } finally {
    fs.closeSync(descriptor)
  }
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

export interface EncryptedKeySnapshot {
  storeKey: string
  encrypted: string | null
}

/** 只供主进程事务补偿使用；密文不会跨 IPC。 */
export function captureEncryptedKeySnapshot(namespace: KeyNamespace, providerId: string): EncryptedKeySnapshot {
  if (namespace === PROVIDER_KEY_NAMESPACE) migrateLegacyProviderCredential(providerId)
  const storeKey = buildKey(namespace, providerId)
  return { storeKey, encrypted: readKeystoreFile().keys[storeKey] ?? null }
}

/** 只恢复已经加密的条目，不接触或返回明文。 */
export function restoreEncryptedKeySnapshot(snapshot: EncryptedKeySnapshot): void {
  const data = readKeystoreFile()
  if (snapshot.encrypted === null) delete data.keys[snapshot.storeKey]
  else data.keys[snapshot.storeKey] = snapshot.encrypted
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

/**
 * 将旧的生成/LLM 分区密钥提升到统一供应商槽。
 *
 * 直接复用原密文，不让明文经过新的持久化步骤；迁移顺序优先旧生成槽，因为此前只有生成侧
 * 是固定供应商的主配置入口。统一槽一旦存在就永远优先，后续写入不会被旧值覆盖。
 */
function migrateLegacyProviderCredential(providerId: string): void {
  const data = readKeystoreFile()
  const sharedStoreKey = buildKey(PROVIDER_KEY_NAMESPACE, providerId)
  const sharedEncrypted = data.keys[sharedStoreKey]
  if (sharedEncrypted && decryptStoredKey(sharedEncrypted, sharedStoreKey) !== null) return

  const legacyStoreKeys = [
    buildKey(LEGACY_AI_KEY_NAMESPACE, providerId),
    buildKey(LEGACY_LLM_KEY_NAMESPACE, providerId),
  ]
  const source = legacyStoreKeys.find((storeKey) => {
    const encrypted = data.keys[storeKey]
    return encrypted ? decryptStoredKey(encrypted, storeKey) !== null : false
  })
  if (!source) return

  data.keys[sharedStoreKey] = data.keys[source]
  for (const storeKey of legacyStoreKeys) delete data.keys[storeKey]
  writeKeystoreFile(data)
}

function getProviderCredential(providerId: string): string | null {
  ensureEncryptionAvailable()
  migrateLegacyProviderCredential(providerId)
  return readStoredKey(PROVIDER_KEY_NAMESPACE, providerId)
}

function hasProviderCredential(providerId: string): boolean {
  migrateLegacyProviderCredential(providerId)
  return readStoredKey(PROVIDER_KEY_NAMESPACE, providerId) !== null
}

function removeProviderCredential(providerId: string): void {
  const data = readKeystoreFile()
  delete data.keys[buildKey(PROVIDER_KEY_NAMESPACE, providerId)]
  delete data.keys[buildKey(LEGACY_AI_KEY_NAMESPACE, providerId)]
  delete data.keys[buildKey(LEGACY_LLM_KEY_NAMESPACE, providerId)]
  writeKeystoreFile(data)
}

export function setAiProviderApiKey(providerId: string, apiKey: string): void {
  setKey(AI_KEY_NAMESPACE, providerId, apiKey)
}

export function removeAiProviderApiKey(providerId: string): void {
  removeProviderCredential(providerId)
}

export function getAiProviderApiKey(providerId: string): string | null {
  return getProviderCredential(providerId)
}

export function getAiProviderKeyStatus(): Array<{ providerId: string; configured: boolean }> {
  return KNOWN_AI_PROVIDER_IDS.map((providerId) => ({
    providerId,
    configured: hasProviderCredential(providerId),
  }))
}

export function setLlmProviderApiKey(credentialId: string, apiKey: string): void {
  setKey(LLM_KEY_NAMESPACE, credentialId, apiKey)
}

export function removeLlmProviderApiKey(credentialId: string): void {
  removeProviderCredential(credentialId)
}

export function getLlmProviderApiKey(credentialId: string): string | null {
  return getProviderCredential(credentialId)
}

export function getLlmProviderKeyStatus(credentialIds: string[]): Array<{ credentialId: string; configured: boolean }> {
  return credentialIds.map((credentialId) => ({
    credentialId,
    configured: hasProviderCredential(credentialId),
  }))
}
