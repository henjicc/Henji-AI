import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { createProjectPersistenceQueue } from './projectPersistenceQueue'

// 与主进程原生 SQLite 测试一致：使用 Electron ABI，不能在普通 Node 中伪装执行成功。
it.skipIf(!process.versions.electron)('真实临时 SQLite 拒绝后不能确认成功，解除只读后原样重试可以重载', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'henji-canvas-persistence-'))
  const file = join(directory, 'projects.sqlite')
  let database: Database.Database | undefined
  try {
    const storage = new Database(file)
    database = storage
    storage.exec('CREATE TABLE projects (id TEXT PRIMARY KEY, content TEXT NOT NULL)')
    const queue = createProjectPersistenceQueue({
      getProjectId: (project: { id: string; content: string }) => project.id,
      upsertProject: async (project) => {
        storage.prepare('INSERT INTO projects VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET content=excluded.content')
          .run(project.id, project.content)
      },
      updateViewport: async () => undefined,
      deleteProject: async (id) => { storage.prepare('DELETE FROM projects WHERE id=?').run(id) },
      onBackgroundError: vi.fn(),
    })
    database.pragma('query_only = ON')
    const snapshot = { id: 'isolated-project', content: JSON.stringify({ nodes: [{ id: 'once' }] }) }
    await expect(queue.flushProject(snapshot)).rejects.toThrow(/readonly/i)
    expect(database.prepare('SELECT * FROM projects').all()).toEqual([])
    database.pragma('query_only = OFF')
    await queue.flushProject(snapshot)
    const reader = new Database(file, { readonly: true })
    try { expect(reader.prepare('SELECT * FROM projects').all()).toEqual([snapshot]) }
    finally { reader.close() }
  } finally {
    database?.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
