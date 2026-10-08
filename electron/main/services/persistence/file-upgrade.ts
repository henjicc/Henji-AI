import { constants } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { assertPersistenceVersion, PersistenceError, type PersistenceContract } from '../../../../src/core/persistence/migrations'
import { createMainLogger } from '../logging/main-logger'
import { EntryExistsError, moveFileNoOverwrite } from '../fs/no-overwrite'
import { persistenceBackupLocation } from '../../../../src/core/persistence/backup'

const logger = createMainLogger('main.persistence')
/** Immutable, content-addressed original, streamed by copyFile (no whole-file buffering). */
export async function backupBeforePersistenceUpgrade(filePath: string, contract: Pick<PersistenceContract, 'id' | 'name' | 'version' | 'migrations'>, fromVersion: number, snapshot?: string | Buffer): Promise<string | undefined> {
  assertPersistenceVersion(contract, fromVersion)
  if (fromVersion === contract.version) return undefined
  const { directory } = persistenceBackupLocation(path.resolve(filePath), fromVersion, '0'.repeat(64))
  logger.info('升级前备份开始', { event: 'persistence.backup.start', context: { format: contract.id, fromVersion, toVersion: contract.version } })
  const temporary = path.join(directory, `.${randomUUID()}.tmp`)
  try {
    await fsp.mkdir(directory, { recursive: true })
    if (snapshot === undefined) await fsp.copyFile(filePath, temporary, constants.COPYFILE_EXCL)
    else await fsp.writeFile(temporary, snapshot, { flag: 'wx', mode: 0o600 })
    const handle = await fsp.open(temporary, 'r+')
    const hash = createHash('sha256')
    try { for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk); await handle.sync() }
    finally { await handle.close() }
    const fingerprint = hash.digest('hex')
    const { target } = persistenceBackupLocation(path.resolve(filePath), fromVersion, fingerprint)
    // Existing publication primitive also supports exFAT and network shares.
    try { await moveFileNoOverwrite(temporary, target) }
    catch (error) {
      if (!(error instanceof EntryExistsError)) throw error
      const existing = createHash('sha256')
      const reader = await fsp.open(target, 'r')
      try { for await (const chunk of reader.createReadStream({ autoClose: false })) existing.update(chunk) }
      finally { await reader.close() }
      if (existing.digest('hex') !== fingerprint) throw new Error('已存在的备份内容不一致')
    }
    logger.info('升级前备份完成', { event: 'persistence.backup.completed', context: { format: contract.id, fromVersion, toVersion: contract.version, backupPath: target } })
    return target
  } catch (error) {
    logger.error('升级前备份失败，未执行升级', { event: 'persistence.backup.failed', context: { format: contract.id, fromVersion, toVersion: contract.version }, error })
    throw new PersistenceError('backup-failed', contract.id, contract.name, fromVersion, contract.version, [], undefined, { cause: error })
  } finally { await fsp.unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn('备份暂存清理失败', { event: 'persistence.backup.cleanup.failed', error }) }) }
}
