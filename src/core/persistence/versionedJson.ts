import type { z } from 'zod'
import { formatMigrations } from './formatMigrations'
import { assertPersistenceVersion, PersistenceError, persistenceForwardFields, persistenceMinReaderVersion, upgradePersistenceContent, type PersistenceContract } from './migrations'
import { restoreForwardFields, type ForwardField } from './forwardCompat'

export interface VersionedPersistenceJson { version: number; minReaderVersion?: number; content: unknown }
/** 每个本机库只有一份当前内容：记住最近一次前向读取，保存时带回未知字段与原版本戳。 */
const forwardReads = new Map<string, { version: number; minReaderVersion: number; fields: readonly ForwardField[] }>()
export const LOCAL_LIBRARY_FORMATS: Readonly<Record<string, { id: string; name: string; version: number; minReaderVersion?: number }>> = {
  'video-edit-style-kits': { id: 'style-kits', name: '本机风格包', version: 3 },
  'video-edit-title-templates': { id: 'title-templates', name: '本机标题模板', version: 7, minReaderVersion: 6 },
  'video-edit-text-presets': { id: 'text-presets', name: '本机文字和字幕预设', version: 1 },
  'video-edit-export-presets': { id: 'export-presets', name: '本机导出预设', version: 1 },
  'video-edit-preset-preferences': { id: 'preset-preferences', name: '预设评分与默认', version: 1 },
  'voice_library_records': { id: 'voice-library', name: '克隆音色库', version: 1 },
  'henji-canvas-node-parameter-defaults-v1': { id: 'node-defaults', name: '画布默认参数', version: 1 },
  'henji-recording-setup': { id: 'recording-setup', name: '录制设置', version: 5, minReaderVersion: 3 },
}
export function localLibraryContract(key: string, schema: z.ZodType): PersistenceContract {
  const value = LOCAL_LIBRARY_FORMATS[key] ?? { id: key, name: '本机创作库', version: 1 }
  return { ...value, schema, migrations: formatMigrations(value.id) }
}
export function parseVersionedPersistenceJson(raw: unknown, contract: PersistenceContract, backupPath?: string): unknown {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !('version' in raw)) throw new PersistenceError('unsupported-version', contract.id, contract.name, 0, contract.version)
  const value = raw as Partial<VersionedPersistenceJson>
  if (typeof value.version !== 'number' || Object.keys(value).some(key => key !== 'version' && key !== 'minReaderVersion' && key !== 'content')
    || value.minReaderVersion !== undefined && typeof value.minReaderVersion !== 'number') throw new PersistenceError('invalid-content', contract.id, contract.name, 0, contract.version, ['version'])
  const upgraded = upgradePersistenceContent(contract, value.content, value.version, backupPath, value.minReaderVersion)
  if (value.version > contract.version) forwardReads.set(contract.id, { version: value.version, minReaderVersion: value.minReaderVersion!, fields: persistenceForwardFields(upgraded) })
  else forwardReads.delete(contract.id)
  return upgraded
}
export function serializeVersionedPersistenceJson(contract: PersistenceContract, content: unknown): string {
  const parsed = contract.schema.parse(content)
  const forward = forwardReads.get(contract.id)
  if (forward) return JSON.stringify({ version: forward.version, minReaderVersion: forward.minReaderVersion, content: restoreForwardFields(parsed, forward.fields) })
  return JSON.stringify({ version: contract.version, minReaderVersion: persistenceMinReaderVersion(contract), content: parsed })
}

/** Async key/value stores (SQLite settings): publish the original row before the first step. */
export async function readStoredPersistenceJson(text: string, key: string, contract: PersistenceContract, storage: { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> }): Promise<unknown> {
  let raw: unknown
  try { raw = JSON.parse(text) as unknown }
  catch (cause) { throw new PersistenceError('corrupt', contract.id, contract.name, 0, contract.version, [], undefined, { cause }) }
  const version = raw && typeof raw === 'object' && 'version' in raw && typeof raw.version === 'number' ? raw.version : 0
  let backup: string | undefined
  if (version > 0 && version < contract.version) {
    assertPersistenceVersion(contract, version)
    for (let index = 0; ; index++) {
      backup = `${key}:backup:v${version}${index ? `:${index}` : ''}`
      const previous = await storage.getItem(backup)
      if (previous === text) break
      if (previous === null) { await storage.setItem(backup, text); break }
    }
  }
  return parseVersionedPersistenceJson(raw, contract, backup)
}

/** localStorage setItem is atomic; backup is published before invoking any migration. */
export function readLocalPersistenceJson(text: string, key: string, contract: PersistenceContract, storage: { getItem(key: string): string | null; setItem(key: string, value: string): void }, contentField: 'content' | 'state' | 'self' = 'content'): unknown {
  let raw: unknown
  try { raw = JSON.parse(text) as unknown }
  catch (cause) { throw new PersistenceError('corrupt', contract.id, contract.name, 0, contract.version, [], undefined, { cause }) }
  const version = raw && typeof raw === 'object' && 'version' in raw && typeof raw.version === 'number' ? raw.version : 0
  let backup: string | undefined
  if (version > 0 && version < contract.version) {
    assertPersistenceVersion(contract, version)
    let index = 0
    for (;;) {
      backup = `${key}:backup:v${version}${index ? `:${index}` : ''}`
      const previous = storage.getItem(backup)
      if (previous === text) break
      if (previous === null) { storage.setItem(backup, text); break }
      index++
    }
  }
  const minReaderVersion = raw && typeof raw === 'object' && 'minReaderVersion' in raw && typeof raw.minReaderVersion === 'number' ? raw.minReaderVersion : undefined
  if (contentField === 'state' && raw && typeof raw === 'object' && 'state' in raw) raw = { version, ...(minReaderVersion === undefined ? {} : { minReaderVersion }), content: raw.state }
  if (contentField === 'self') return upgradePersistenceContent(contract, raw, version, backup, minReaderVersion)
  return parseVersionedPersistenceJson(raw, contract, backup)
}
