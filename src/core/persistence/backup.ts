import { baseName, joinRelativeSegments, parentPath, type PathStyle } from '../storage/pathSyntax'
import { sha256Hex } from '../../utils/save/hash'
import { assertPersistenceVersion, PersistenceError, type PersistenceContract } from './migrations'

export function persistenceBackupLocation(filePath: string, version: number, hash: string): { directory: string; target: string } {
  const style: PathStyle = /^(?:[a-z]:|\\\\)/i.test(filePath) ? 'win32' : 'posix'
  const parent = parentPath(style, filePath)
  const name = baseName(style, filePath)
  if (!parent || !name || !/^[a-f0-9]{64}$/.test(hash)) throw new Error('备份需要真实文件路径与内容摘要')
  const internalParent = style === 'win32' ? baseName(style, parent)?.toLowerCase() === '.henji' : baseName(style, parent) === '.henji'
  const directory = joinRelativeSegments(style, parent, internalParent ? ['backups'] : ['.henji', 'backups'])!
  return { directory, target: joinRelativeSegments(style, directory, [`${name}.v${version}.${hash}.bak`])! }
}

export interface PersistenceBackupIo {
  mkdir(path: string, options: { recursive: boolean }): Promise<void>
  writeFile(path: string, bytes: Uint8Array, options: { exclusive: boolean }): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  exists(path: string): Promise<boolean>
}

/** Small already-read files. Hosts supply their existing atomic exclusive publication and fsync. */
export async function backupPersistenceSnapshot(filePath: string, contract: Pick<PersistenceContract, 'id' | 'name' | 'version' | 'migrations'>, version: number, bytes: Uint8Array, io: PersistenceBackupIo): Promise<string | undefined> {
  assertPersistenceVersion(contract, version)
  if (version === contract.version) return undefined
  let target: string | undefined
  try {
    const hash = await sha256Hex(bytes.slice().buffer)
    const location = persistenceBackupLocation(filePath, version, hash)
    target = location.target
    await io.mkdir(location.directory, { recursive: true })
    try { await io.writeFile(target, bytes, { exclusive: true }) }
    catch (cause) {
      if (!await io.exists(target) || await sha256Hex((await io.readFile(target)).slice().buffer) !== hash) throw cause
    }
    return target
  } catch (cause) { throw new PersistenceError('backup-failed', contract.id, contract.name, version, contract.version, [], target, { cause }) }
}
