import { constants } from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { assertPersistenceVersion, PersistenceError, type PersistenceContract } from '../../../../src/core/persistence/migrations'
import { createMainLogger } from '../logging/main-logger'
import { EntryExistsError, moveFileNoOverwrite } from '../fs/no-overwrite'
import { persistenceBackupLocation } from '../../../../src/core/persistence/backup'

const logger = createMainLogger('main.persistence')

async function sha256File(filePath: string, sync = false): Promise<string> {
  const hash = createHash('sha256')
  const handle = await fsp.open(filePath, sync ? 'r+' : 'r')
  try {
    for await (const chunk of handle.createReadStream({ autoClose: false })) hash.update(chunk)
    if (sync) await handle.sync()
  } finally { await handle.close() }
  return hash.digest('hex')
}

/** Immutable, content-addressed original, streamed by copyFile (no whole-file buffering). */
export async function backupBeforePersistenceUpgrade(filePath: string, contract: Pick<PersistenceContract, 'id' | 'name' | 'version' | 'migrations'>, fromVersion: number, snapshot?: string | Buffer, forceSnapshot = false, expectedFingerprint?: string): Promise<string | undefined> {
  assertPersistenceVersion(contract, fromVersion)
  if (fromVersion === contract.version && !forceSnapshot) return undefined
  const context = { format: contract.id, fromVersion, toVersion: contract.version }
  let temporary: string | undefined
  try {
    const source = snapshot === undefined ? await sha256File(filePath) : createHash('sha256').update(snapshot).digest('hex')
    // 分块解析不保留原文副本；备份必须与实际解析的字节一致，外部修改后应重新读取。
    if (expectedFingerprint !== undefined && source !== expectedFingerprint) throw new Error('文件在读取期间被修改，请重新打开后重试。')
    const { directory, target: existing } = persistenceBackupLocation(path.resolve(filePath), fromVersion, source)
    // 备份按内容寻址：同一份原文已经备份过就直接复用，旧版本文件被反复读取时不再整份复制。
    const existingHash = await sha256File(existing).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error })
    if (existingHash === source) return existing
    if (existingHash !== null) throw new Error('已存在的备份内容不一致')
    logger.info('升级前备份开始', { event: 'persistence.backup.start', context })
    await fsp.mkdir(directory, { recursive: true })
    temporary = path.join(directory, `.${randomUUID()}.tmp`)
    if (snapshot === undefined) await fsp.copyFile(filePath, temporary, constants.COPYFILE_EXCL)
    else await fsp.writeFile(temporary, snapshot, { flag: 'wx', mode: 0o600 })
    const fingerprint = await sha256File(temporary, true)
    if (expectedFingerprint !== undefined && fingerprint !== expectedFingerprint) throw new Error('文件在读取期间被修改，请重新打开后重试。')
    const { target } = persistenceBackupLocation(path.resolve(filePath), fromVersion, fingerprint)
    // Existing publication primitive also supports exFAT and network shares.
    try { await moveFileNoOverwrite(temporary, target) }
    catch (error) {
      if (!(error instanceof EntryExistsError)) throw error
      if (await sha256File(target) !== fingerprint) throw new Error('已存在的备份内容不一致')
    }
    logger.info('升级前备份完成', { event: 'persistence.backup.completed', context: { ...context, backupPath: target } })
    return target
  } catch (error) {
    logger.error('升级前备份失败，未执行升级', { event: 'persistence.backup.failed', context, error })
    throw new PersistenceError('backup-failed', contract.id, contract.name, fromVersion, contract.version, [], undefined, { cause: error })
  } finally {
    if (temporary !== undefined) await fsp.unlink(temporary).catch(error => { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') logger.warn('备份暂存清理失败', { event: 'persistence.backup.cleanup.failed', error }) })
  }
}
