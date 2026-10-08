import type { z } from 'zod'
import { persistenceMessage } from './messages'

/** Key N owns exactly N → N+1. No catch-all upgrade or implicit identity steps. */
export type PersistenceMigrations = Readonly<Record<number, (content: unknown) => unknown>>
export type PersistenceFailure = 'newer-version' | 'unsupported-version' | 'migration-failed' | 'invalid-content' | 'corrupt' | 'backup-failed'

export interface PersistenceContract {
  id: string
  name: string
  version: number
  schema: z.ZodType
  migrations: PersistenceMigrations
}

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

export function assertPersistenceVersion(contract: Pick<PersistenceContract, 'id' | 'name' | 'version' | 'migrations'>, version: number): void {
  if (!Number.isSafeInteger(version) || version < 1) throw new PersistenceError('invalid-content', contract.id, contract.name, version, contract.version, ['version'])
  if (version > contract.version) throw new PersistenceError('newer-version', contract.id, contract.name, version, contract.version)
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

export function upgradePersistenceContent(contract: PersistenceContract, content: unknown, version: number, backupPath?: string): unknown {
  const value = migratePersistenceContent(contract, content, version, backupPath)
  const parsed = contract.schema.safeParse(value)
  if (!parsed.success) {
    throw new PersistenceError(version < contract.version ? 'migration-failed' : 'invalid-content', contract.id, contract.name,
      version < contract.version ? contract.version - 1 : version, contract.version,
      parsed.error.issues.map(issue => issue.path.map(String).join('.')), backupPath, { cause: parsed.error })
  }
  return parsed.data
}
