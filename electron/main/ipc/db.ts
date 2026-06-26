import { executeSql, selectSql, type SqlBindValue, type SqlExecuteResult } from '../services/db'
import { parseRecord, registerIpcHandler } from './registry'

interface SqlPayload {
  sql: string
  params?: SqlBindValue[]
}

function isSqlBindValue(value: unknown): value is SqlBindValue {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    value instanceof Uint8Array
  )
}

function parseSqlPayload(input: unknown): SqlPayload {
  const record = parseRecord(input)
  const sql = record.sql
  const rawParams = record.params

  if (typeof sql !== 'string' || sql.trim().length === 0) {
    throw new Error('Expected non-empty SQL string')
  }

  if (rawParams === undefined) {
    return { sql }
  }

  if (!Array.isArray(rawParams) || !rawParams.every(isSqlBindValue)) {
    throw new Error('Expected SQL params array')
  }

  return { sql, params: rawParams }
}

export function registerDbIpc(): void {
  registerIpcHandler<SqlPayload, SqlExecuteResult>('db:execute', parseSqlPayload, ({ sql, params }) => {
    return executeSql(sql, params)
  })

  registerIpcHandler<SqlPayload, unknown[]>('db:select', parseSqlPayload, ({ sql, params }) => {
    return selectSql(sql, params)
  })
}

