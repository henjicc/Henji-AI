import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

const APP_IDENTIFIER = 'com.henji.ai'
const DATA_DIR_NAME = 'Henji-AI'
const KEYSTORE_FILE_NAME = 'provider-keys.enc.json'

export const AI_KEY_NAMESPACE = 'ai'
export const KNOWN_AI_PROVIDER_IDS = ['ppio', 'fal', 'kie', 'apimart', 'bailian', 'volcengine', 'modelscope'] as const
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

export function getKey(namespace: KeyNamespace, providerId: string): string | null {
  ensureEncryptionAvailable()
  const encrypted = readKeystoreFile().keys[buildKey(namespace, providerId)]
  if (!encrypted) {
    return null
  }

  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
}

export function hasKey(namespace: KeyNamespace, providerId: string): boolean {
  return readKeystoreFile().keys[buildKey(namespace, providerId)] !== undefined
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
