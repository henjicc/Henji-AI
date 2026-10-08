import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { persistenceFileContract } from '../../../../src/core/persistence/fileContracts'
import { assertPersistenceVersion, migratePersistenceContent, upgradePersistenceContent, PersistenceError } from '../../../../src/core/persistence/migrations'
import { backupBeforePersistenceUpgrade } from './file-upgrade'
import { persistenceBackupLocation } from '../../../../src/core/persistence/backup'

export function parsePersistenceJson(text: string, id: string): unknown {
  const contract = persistenceFileContract(id)
  try { return JSON.parse(text) as unknown }
  catch (cause) { throw new PersistenceError('corrupt', id, contract.name, 0, contract.version, [], undefined, { cause }) }
}

/** Keep the existing domain validator; this adapter owns only version order and original-file backup. */
export async function upgradeStoredFile(filePath: string, id: string, raw: unknown, version: unknown, originalText?: string): Promise<unknown> {
  const contract = persistenceFileContract(id)
  const from = typeof version === 'number' ? version : 0
  const backup = await backupBeforePersistenceUpgrade(filePath, contract, from, originalText)
  return from < contract.version ? upgradePersistenceContent(contract, raw, from, backup) : migratePersistenceContent(contract, raw, from, backup)
}

/** Small existing synchronous credential readers need the same preflight and immutable backup. */
export function upgradeStoredFileSync(filePath: string, id: string, raw: unknown, version: unknown, originalText: string): unknown {
  const contract = persistenceFileContract(id)
  const from = typeof version === 'number' ? version : 0
  assertPersistenceVersion(contract, from)
  let backup: string | undefined
  if (from < contract.version) {
    const { directory, target } = persistenceBackupLocation(path.resolve(filePath), from, createHash('sha256').update(originalText).digest('hex'))
    backup = target
    let descriptor: number | undefined
    let created = false
    try {
      fs.mkdirSync(directory, { recursive: true })
      try { descriptor = fs.openSync(backup, 'wx', 0o600); created = true }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      if (descriptor !== undefined) { fs.writeFileSync(descriptor, originalText); fs.fsyncSync(descriptor) }
      else if (fs.readFileSync(backup, 'utf8') !== originalText) throw new Error('备份内容不一致')
    } catch (cause) {
      if (descriptor !== undefined) { fs.closeSync(descriptor); descriptor = undefined }
      if (created) fs.unlinkSync(backup)
      throw new PersistenceError('backup-failed', id, contract.name, from, contract.version, [], backup, { cause })
    } finally { if (descriptor !== undefined) fs.closeSync(descriptor) }
  }
  return upgradePersistenceContent(contract, raw, from, backup)
}
