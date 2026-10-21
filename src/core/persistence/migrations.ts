import type { z } from 'zod'
import { persistenceMessage } from './messages'
import { persistenceForwardReadable, readForwardCompatible, type ForwardField } from './forwardCompat'

/** Key N owns exactly N → N+1. No catch-all upgrade or implicit identity steps. */
export type PersistenceMigrations = Readonly<Record<number, (content: unknown) => unknown>>
export type PersistenceFailure = 'newer-version' | 'unsupported-version' | 'migration-failed' | 'invalid-content' | 'corrupt' | 'backup-failed'

export interface PersistenceContract {
  id: string
  name: string
  version: number
  /** 本程序写出的文件需要的最低程序版本；只新增可选字段时不变，改变已有含义时提高。省略即等于 version。 */
  minReaderVersion?: number
  schema: z.ZodType
  migrations: PersistenceMigrations
}
export function persistenceMinReaderVersion(contract: Pick<PersistenceContract, 'version' | 'minReaderVersion'>): number { return contract.minReaderVersion ?? contract.version }

export class PersistenceError extends Error {
  readonly name = 'PersistenceError'
  constructor(
    readonly code: PersistenceFailure,
    readonly formatId: string,
    readonly formatName: string,
    readonly fromVersion: number,
    readonly toVersion: number,
    readonly fields: readonly string[] = [],
    readonly backupPath?: string,
    options?: { cause?: unknown },
  ) {
    super(persistenceMessage(code, { format: formatName, from: fromVersion, to: toVersion, backup: backupPath ?? persistenceMessage('backup-unavailable', {}) }), options)
  }
}

/** minReaderVersion 来自文件：更新版本写出、但声明本程序可读时按前向读取打开；否则提示升级。 */
export function assertPersistenceVersion(contract: Pick<PersistenceContract, 'id' | 'name' | 'version' | 'migrations'>, version: number, minReaderVersion?: number): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new PersistenceError('invalid-content', contract.id, contract.name, version, contract.version, ['version'])
  if (version > contract.version) {
    if (persistenceForwardReadable(version, minReaderVersion, contract.version)) return
    throw new PersistenceError('newer-version', contract.id, contract.name, version, contract.version)
  }
  for (let next = version; next < contract.version; next++) {
    if (!Object.hasOwn(contract.migrations, next)) throw new PersistenceError('unsupported-version', contract.id, contract.name, next, next + 1)
  }
}

/** Does not mutate caller input. I/O and backup happen before this pure executor. */
export function migratePersistenceContent(contract: Pick<PersistenceContract, 'id' | 'name' | 'version' | 'migrations'>, content: unknown, version: number, backupPath?: string): unknown {
  assertPersistenceVersion(contract, version)
  let value: unknown = content
  if (version < contract.version) {
    try { value = structuredClone(content) }
    catch (cause) { throw new PersistenceError('migration-failed', contract.id, contract.name, version, version + 1, [], backupPath, { cause }) }
  }
  for (let next = version; next < contract.version; next++) {
    try { value = contract.migrations[next](value) }
    catch (cause) { throw new PersistenceError('migration-failed', contract.id, contract.name, next, next + 1, [], backupPath, { cause }) }
  }
  return value
}

const forwardFields = new WeakMap<object, readonly ForwardField[]>()
/** 前向读取时本程序不认识、保存时须放回的字段；当前或更旧版本的内容返回空数组。 */
export function persistenceForwardFields(value: unknown): readonly ForwardField[] {
  return value && typeof value === 'object' ? forwardFields.get(value) ?? [] : []
}

export function upgradePersistenceContent(contract: PersistenceContract, content: unknown, version: number, backupPath?: string, minReaderVersion?: number): unknown {
  if (version > contract.version) {
    assertPersistenceVersion(contract, version, minReaderVersion)
    // 版本号写在内容里的格式（项目说明、包说明、代码资产）按本程序版本校验其余字段。
    const input = content && typeof content === 'object' && !Array.isArray(content) && (content as { version?: unknown }).version === version ? { ...content, version: contract.version } : content
    let read: ReturnType<typeof readForwardCompatible>
    try { read = readForwardCompatible(contract.schema, input) }
    catch (cause) {
      const issues = (cause as { issues?: Array<{ path: PropertyKey[] }> }).issues ?? []
      throw new PersistenceError('invalid-content', contract.id, contract.name, version, contract.version, issues.map(issue => issue.path.map(String).join('.')), backupPath, { cause })
    }
    if (read.value && typeof read.value === 'object') forwardFields.set(read.value, read.fields)
    return read.value
  }
  const value = migratePersistenceContent(contract, content, version, backupPath)
  const parsed = contract.schema.safeParse(value)
  if (!parsed.success) {
    throw new PersistenceError(version < contract.version ? 'migration-failed' : 'invalid-content', contract.id, contract.name,
      version < contract.version ? contract.version - 1 : version, contract.version,
      parsed.error.issues.map(issue => issue.path.map(String).join('.')), backupPath, { cause: parsed.error })
  }
  return parsed.data
}
