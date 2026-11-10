import { createRequire } from 'node:module'
import type Database from 'better-sqlite3'
import { expect, it } from 'vitest'
import { createRecycleStore } from './store'
const { DatabaseSync } = createRequire(__filename)('node:sqlite') as typeof import('node:sqlite')

function fixture() {
  const db = new DatabaseSync(':memory:')
  db.exec('CREATE TABLE media_recycle_candidates (id INTEGER PRIMARY KEY AUTOINCREMENT, source TEXT, payload TEXT); CREATE TABLE media_recycle_owned (path TEXT, identity TEXT, source_path TEXT)')
  for (let index = 1; index <= 5; index++) db.prepare('INSERT INTO media_recycle_candidates(source, payload) VALUES (?, ?)').run('paths', String(index))
  const open = (horizon: number, signal = new AbortController().signal) => createRecycleStore(db as unknown as Database.Database, signal, horizon, row => ({ id: row.id, paths: [row.payload] }))
  const rows = () => (db.prepare('SELECT id, payload FROM media_recycle_candidates ORDER BY id').all() as Array<{ id: number; payload: string }>)
  return { db, open, rows }
}

it('只处理本轮开始前入队的候选；留下的候选原地不动，回收的删除', async () => {
  const { db, open, rows } = fixture()
  try {
    const queue = open(4)
    const seen: string[] = []
    for await (const candidate of queue.store.candidates()) {
      seen.push(candidate.paths[0])
      if (candidate.id % 2) queue.store.forget(candidate.id)
    }
    expect(seen).toEqual(['1', '2', '3', '4'])
    expect(rows()).toEqual([{ id: 2, payload: '2' }, { id: 4, payload: '4' }, { id: 5, payload: '5' }])
    expect(queue.remaining()).toBe(3)
  } finally { db.close() }
})

it('中止后不再访问数据库', async () => {
  const { db, open } = fixture()
  const controller = new AbortController()
  try {
    const queue = open(5, controller.signal)
    const iterator = queue.store.candidates()[Symbol.asyncIterator]()
    const first = (await iterator.next()).value!
    controller.abort(new Error('stopped'))
    db.close()
    expect(() => queue.store.forget(first.id)).toThrow('stopped')
    await expect(iterator.next()).rejects.toThrow('stopped')
  } finally { if (db.isOpen) db.close() }
})
