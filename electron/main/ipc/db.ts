import { executeSql, selectSql, type SqlBindValue, type SqlExecuteResult } from '../services/db'
import { isAutomationTestMode } from '../services/automationMode'
import { createMainLogger } from '../services/logging/main-logger'
import { parseRecord, registerIpcHandler } from './registry'

/*
 * 原始 SQL 通道（测试专用，存储底座 2.3 起）。
 *
 * 生产代码已全部改用各主进程仓库的类型化接口；这里只在自动化 / 隔离测试模式下注册，
 * 留给尚未改写、仍直接写 storyboard_projects 造画布数据的测试脚本。正常启动不注册，渲染层调用会失败。
 * 3.4 画布接入文档文件、脚本改写后连同 preload 的 `henjiNative.db` 一起删除。
 */

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
  if (!isAutomationTestMode()) return
  createMainLogger('main.db').info('自动化测试模式：已开放原始 SQL 测试通道', { event: 'db.raw_channel.enabled' })

  registerIpcHandler<SqlPayload, SqlExecuteResult>('db:execute', parseSqlPayload, ({ sql, params }) => {
    return executeSql(sql, params)
  })

  registerIpcHandler<SqlPayload, unknown[]>('db:select', parseSqlPayload, ({ sql, params }) => {
    return selectSql(sql, params)
  })
}
