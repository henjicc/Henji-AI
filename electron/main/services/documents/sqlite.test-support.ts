import type Database from 'better-sqlite3'
import { createRequire } from 'node:module'
import path from 'node:path'
import type { SQLInputValue } from 'node:sqlite'

// Vite 5 predates node:sqlite. Runtime require avoids its stale builtin inventory.
const { DatabaseSync } = createRequire(path.resolve('package.json'))('node:sqlite') as typeof import('node:sqlite')

/** Real SQLite SQL with a counted host adapter; no Electron native ABI needed. */
export function createCountedSqlite() {
  const native = new DatabaseSync(':memory:')
  const queries: string[] = []
  const adapter = {
    exec: (sql: string) => native.exec(sql),
    prepare(sql: string) {
      const statement = native.prepare(sql)
      const record = (values: SQLInputValue[]) => {
        if (values.length > 999) throw new Error('SQLite portable variable budget exceeded')
        queries.push(sql)
      }
      return {
        all(...values: SQLInputValue[]) { record(values); return statement.all(...values) },
        get(...values: SQLInputValue[]) { record(values); return statement.get(...values) },
        run(...values: SQLInputValue[]) { record(values); return statement.run(...values) },
      }
    },
    transaction<T>(operation: () => T) {
      return () => {
        native.exec('BEGIN')
        try { const result = operation(); native.exec('COMMIT'); return result }
        catch (error) { native.exec('ROLLBACK'); throw error }
      }
    },
  }
  return { native, queries, db: adapter as unknown as Database.Database }
}
