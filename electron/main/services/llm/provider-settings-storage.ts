import { getDb } from '../db'
import { RecycleStore } from '../recycle/store'
import { LLM_CONFIG_VERSION, LLM_JOURNAL_VERSION } from '../../../../src/core/persistence/schemaVersions'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { LlmConfigState } from '@henjicc/ai-sdk'

import type { EncryptedKeySnapshot } from '../keystore'
import { getProgramDataDir } from '../appPaths'
import { llmStoredConfigSchema } from '../../../../src/core/persistence/auxiliarySchemas'
import { formatMigrations } from '../../../../src/core/persistence/formatMigrations'
import { parseVersionedPersistenceJson, serializeVersionedPersistenceJson } from '../../../../src/core/persistence/versionedJson'
import { backupBeforePersistenceUpgrade } from '../persistence/file-upgrade'
import { parsePersistenceJson, upgradeStoredFile } from '../persistence/stored-file'
import { providerSettingsJournalSchema } from '../../../../src/core/persistence/auxiliarySchemas'

const CONFIG_FILE_NAME = 'llm-config.json'
const JOURNAL_FILE_NAME = '.llm-provider-settings.transaction.json'

export interface ProviderSettingsJournal {
  version: typeof LLM_JOURNAL_VERSION
  configBefore: LlmConfigState | null
  credentialBefore?: EncryptedKeySnapshot
}

export interface ProviderSettingsStorage {
  readConfig(): Promise<LlmConfigState | null>
  writeConfig(config: LlmConfigState): Promise<void>
  removeConfig(): Promise<void>
  readJournal(): Promise<ProviderSettingsJournal | null>
  writeJournal(journal: ProviderSettingsJournal): Promise<void>
  removeJournal(): Promise<void>
}

function resolveDataRoot(): string {
  // 模型配置属于程序内部数据，固定在程序目录，不随用户目录移动（重要记录 002）。
  return getProgramDataDir()
}

async function readJson(filePath: string): Promise<{ raw: unknown; text: string } | null> {
  try {
    const text = await fs.readFile(filePath, 'utf8')
    return { raw: parsePersistenceJson(text, path.basename(filePath) === JOURNAL_FILE_NAME ? 'llm-config-journal' : 'llm-config'), text }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function fsyncDirectory(directory: string): Promise<void> {
  if (process.platform === 'win32') return
  const handle = await fs.open(directory, 'r')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const directory = path.dirname(filePath)
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`)
  await fs.mkdir(directory, { recursive: true })
  let handle: fs.FileHandle | null = null
  try {
    handle = await fs.open(temporary, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fs.rename(temporary, filePath)
    await fs.chmod(filePath, 0o600)
    await fsyncDirectory(directory)
  } catch (error) {
    await handle?.close().catch(() => undefined)
    await fs.rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function removeAtomicState(filePath: string): Promise<void> {
  try {
    await fs.rm(filePath)
    await fsyncDirectory(path.dirname(filePath))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

export function createProviderSettingsFileStorage(): ProviderSettingsStorage {
  const paths = (): { config: string; journal: string } => {
    const root = resolveDataRoot()
    return {
      config: path.join(root, CONFIG_FILE_NAME),
      journal: path.join(root, JOURNAL_FILE_NAME),
    }
  }
  return {
    readConfig: async () => {
      const stored = await readJson(paths().config)
      if (stored === null) return null
      const { text } = stored
      // 版本外壳引入前（t94 之前）写下的配置内容本身没有变化：读取时按 v1 包装，原文件不改写，下次保存才写成带版本的格式。
      const raw = stored.raw && typeof stored.raw === 'object' && !Array.isArray(stored.raw) && !('version' in stored.raw) && Array.isArray((stored.raw as { providers?: unknown }).providers)
        ? { version: LLM_CONFIG_VERSION, content: stored.raw } : stored.raw
      const contract = { id: 'llm-config', name: '助手模型配置', version: LLM_CONFIG_VERSION, schema: llmStoredConfigSchema, migrations: formatMigrations('llm-config') }
      const version = raw && typeof raw === 'object' && 'version' in raw && typeof raw.version === 'number' ? raw.version : 0
      const backupPath = version > 0 ? await backupBeforePersistenceUpgrade(paths().config, contract, version, text) : undefined
      return parseVersionedPersistenceJson(raw, contract, backupPath) as LlmConfigState
    },
    writeConfig: async config => {
      const stored = await readJson(paths().config)
      const raw = stored?.raw as { content?: LlmConfigState; providers?: LlmConfigState['providers']; models?: LlmConfigState['models'] } | undefined
      const previous = raw?.content ?? raw
      const removed = previous?.providers?.filter(provider => !config.providers.some(next => next.providerId === provider.providerId)) ?? []
      const snapshots: string[] = []
      let recycle: RecycleStore | undefined
      const backup = (target: string, name: string, payload: string): string => (recycle ??= new RecycleStore(getDb())).snapshot('member', target, name, payload)
      for (const provider of removed) snapshots.push(backup('llm-provider', provider.displayName, JSON.stringify({ provider, models: previous?.models?.filter(model => model.providerId === provider.providerId) ?? [] })))
      for (const model of previous?.models ?? []) if (!removed.some(provider => provider.providerId === model.providerId) && !config.models.some(next => next.modelId === model.modelId && next.providerId === model.providerId)) snapshots.push(backup('llm-model', model.displayName, JSON.stringify({ models: [model], fallbackProvider: previous?.providers?.find(provider => provider.providerId === model.providerId) })))
      try { await writeJsonAtomic(paths().config, JSON.parse(serializeVersionedPersistenceJson({ id: 'llm-config', name: '助手模型配置', version: LLM_CONFIG_VERSION, schema: llmStoredConfigSchema, migrations: formatMigrations('llm-config') }, config)) as unknown) }
      catch (error) { for (const id of snapshots) recycle?.forget(id); throw error }
    },
    removeConfig: async () => await removeAtomicState(paths().config),
    readJournal: async () => {
      const stored = await readJson(paths().journal)
      if (stored === null) return null
      const { raw, text } = stored
      const upgraded = await upgradeStoredFile(paths().journal, 'llm-config-journal', raw, raw && typeof raw === 'object' && 'version' in raw ? raw.version : 0, text)
      return providerSettingsJournalSchema.parse(upgraded) as ProviderSettingsJournal
    },
    writeJournal: async journal => await writeJsonAtomic(paths().journal, journal),
    removeJournal: async () => await removeAtomicState(paths().journal),
  }
}
