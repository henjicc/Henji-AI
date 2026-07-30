import type Database from 'better-sqlite3'

export class AgentThreadDeletionStore {
  constructor(private readonly database: Database.Database) {}

  delete(threadIds: string[]): string[] {
    if (threadIds.length === 0) return []
    const uniqueThreadIds = [...new Set(threadIds)]
    const placeholders = uniqueThreadIds.map(() => '?').join(', ')
    const rows = this.database.prepare(`
      SELECT thread_id FROM agent_threads WHERE thread_id IN (${placeholders})
    `).all(...uniqueThreadIds) as Array<{ thread_id: string }>
    const existingIds = new Set(rows.map((row) => row.thread_id))
    const deletedThreadIds = uniqueThreadIds.filter((threadId) => existingIds.has(threadId))
    if (deletedThreadIds.length === 0) return []

    this.database.transaction(() => {
      this.database.prepare(`
        DELETE FROM agent_threads WHERE thread_id IN (${placeholders})
      `).run(...uniqueThreadIds)
    })()
    return deletedThreadIds
  }
}
