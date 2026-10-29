import { createRequire } from 'node:module'
import type Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { createRecycleStore } from './store'
const { DatabaseSync } = createRequire(__filename)('node:sqlite') as typeof import('node:sqlite')

function fixture() {
  const db = new DatabaseSync(':memory:')
  const connection = {
    prepare: db.prepare.bind(db),
    get open() { return db.isOpen },
    transaction<T>(action: () => T) { return () => {
      db.exec('BEGIN')
      try { const result = action(); db.exec('COMMIT'); return result }
      catch (error) { db.exec('ROLLBACK'); throw error }
    } },
  }
  db.exec('CREATE TABLE media_recycle_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, payload TEXT); CREATE TABLE media_recycle_owned (path TEXT, identity TEXT, source_path TEXT)')
  for (let index = 1; index <= 5; index++) db.prepare('INSERT INTO media_recycle_candidates(source, payload) VALUES (?, ?)').run('paths', String(index))
  const open = (signal = new AbortController().signal) => createRecycleStore(connection as unknown as Database.Database, signal, row => ({ id: row.id, paths: [row.payload] }))
  return { db, open }
}

it('保留的队首原子轮换到队尾，新一轮覆盖尾部；单轮不重复追逐已轮换的候选', async () => {
  const { db, open } = fixture()
  try {
    const first = open(); const revision = first.revision()
    const seen: string[] = []
    for await (const candidate of first.store.candidates()) { seen.push(candidate.paths[0]); if (seen.length === 2) break }
    expect(first.revision()).toBe(revision)
    expect(seen).toEqual(['1', '2'])
    const second = open()
    const rest: string[] = []
    for await (const candidate of second.store.candidates()) rest.push(candidate.paths[0])
    expect(rest).toEqual(['3', '4', '5', '1', '2'])
    expect(second.remaining()).toBe(5)
  } finally { db.close() }
})

it('已引用候选在同一引用集合下休眠，引用移除后重新检查，取消后不访问已关闭数据库', async () => {
  const { db, open } = fixture()
  const controller = new AbortController()
  try {
    const first = open()
    first.referencesReady(new Set(['held']))
    for await (const candidate of first.store.candidates()) first.store.referenced?.(candidate.id)
    const same = open()
    same.referencesReady(new Set(['held']))
    const sleeping: unknown[] = []
    for await (const candidate of same.store.candidates()) sleeping.push(candidate)
    expect(sleeping).toEqual([])
    const changed = open(controller.signal)
    changed.referencesReady(new Set())
    const ready = changed.store.candidates()[Symbol.asyncIterator]()
    expect((await ready.next()).value?.paths).toEqual(['1'])
    controller.abort(new Error('deadline'))
    expect(db.prepare('SELECT payload FROM media_recycle_candidates ORDER BY id LIMIT 1').get()?.payload).toBe('2')
    db.close()
    await expect(ready.next()).rejects.toThrow('deadline')
    expect(changed.remaining()).toBe(5)
  } finally { if (db.isOpen) db.close() }
})
