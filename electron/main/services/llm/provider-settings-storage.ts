import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { LlmConfigState } from '@henjicc/ai-sdk'

import type { EncryptedKeySnapshot } from '../keystore'
import { getCustomDataRoot } from '../dataRoot'
import { getHenjiDataDir } from '../db'

const CONFIG_FILE_NAME = 'llm-config.json'
const JOURNAL_FILE_NAME = '.llm-provider-settings.transaction.json'

export interface ProviderSettingsJournal {
  version: 1
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
  return getCustomDataRoot() ?? getHenjiDataDir()
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8')) as T
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
    readConfig: async () => await readJson<LlmConfigState>(paths().config),
    writeConfig: async config => await writeJsonAtomic(paths().config, config),
    removeConfig: async () => await removeAtomicState(paths().config),
    readJournal: async () => await readJson<ProviderSettingsJournal>(paths().journal),
    writeJournal: async journal => await writeJsonAtomic(paths().journal, journal),
    removeJournal: async () => await removeAtomicState(paths().journal),
  }
}
