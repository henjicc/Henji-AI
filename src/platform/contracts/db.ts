export type SqlBindValue = string | number | boolean | null | Uint8Array

export interface SqlExecuteResult {
  rowsAffected: number
  lastInsertId?: number
}

/**
 * 通用 SQL 执行接口，复用同一个 henji.db 连接。
 * 现状有 DatabaseService（history/presets/settings）、
 * projectState.ts（storyboard_projects）、progress_learning（progress_samples）
 * 三处独立消费方，迁移后应共用同一个 db 实例。
 */
export interface DbPlatform {
  execute(sql: string, params?: SqlBindValue[]): Promise<SqlExecuteResult>
  select<T = DynamicValue>(sql: string, params?: SqlBindValue[]): Promise<T[]>
}
