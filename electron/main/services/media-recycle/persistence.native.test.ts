import Database from 'better-sqlite3'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ db: undefined as Database.Database | undefined, user: '', program: '' }))
vi.mock('electron', () => ({ shell: { trashItem: (file: string) => fs.rename(file, `${file}.trashed`) } }))
vi.mock('../db', () => ({ getDb: () => state.db! }))
vi.mock('../appPaths', () => ({
  getProgramDataDir: () => state.program,
  getProgramStoreDir: (key: string) => path.join(state.program, key),
  getUserRootDir: () => state.user,
  getUserFolderDir: (key: string) => path.join(state.user, key),
  getUserModelsLocation: () => ({ dir: path.join(state.user, 'models'), locale: 'en' }),
}))
vi.mock('../db-locations', () => ({ databaseLocationContext: () => ({ style: process.platform === 'win32' ? 'win32' : 'posix', userRoot: state.user, projects: [], programRoots: [state.program] }) }))
vi.mock('../logging/main-logger', () => ({ createMainLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('../image-editor-v3/resource-media-url', () => ({ resolveImageEditorV3ResourceMediaUrl: vi.fn() }))
vi.mock('../image/path-utils', () => ({ listUploadImageLeases: () => [] }))
vi.mock('../image/managed-media-leases', () => ({ listManagedMediaFileLeases: () => [] }))
import { runSchemaMigrations, SCHEMA_MIGRATIONS } from '../db-migrations'
import { assertMediaStorageCoverage, MEDIA_REFERENCE_TABLES } from './schema'
import { registerOwnedMedia, resetManagedMediaClaimsForTest } from './queue'
import { runMediaRecycle } from './runtime'
import { recordDocumentMediaPublished } from './providers'
import { DocumentIndexStore } from '../documents/index-store'

describe.skipIf(!process.versions.electron)('SQLite 21 media retirement', () => {
  it('项目移除保留素材原串，残留引用和候选不阻断其他回收，恢复后重新检查', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-recycle-project-'))
    state.user = path.join(root, 'user'); state.program = path.join(root, 'program')
    state.db = new Database(':memory:')
    try {
      const db = state.db; runSchemaMigrations(db)
      const catalog = new DocumentIndexStore(db, process.platform === 'win32' ? 'win32' : 'posix')
      const project = { id: 'removed', path: path.join(state.user, 'project'), name: '项目', locale: 'zh' as const, folders: { generated: 'generated', materials: 'materials' }, draft: false, mainVideoEditId: null, createdAt: 1, external: false, missing: false, manifestModifiedAt: 1, manifestSize: 1, folderCreatedAt: 1, lastOpenedAt: null }
      catalog.upsertProject(project)
      const insert = db.prepare("INSERT INTO assets(id,media_type,display_name,file_path,source,inspection_status,created_at,updated_at) VALUES (?,'image',?,?,'imported','ready',1,1)")
      insert.run('lost', '失联', 'henji://project/removed/a.png')
      insert.run('deleted', '删除候选', 'henji://project/removed/b.png')
      catalog.removeProject(project.id)
      expect(db.prepare("SELECT file_path, inspection_status FROM assets WHERE id='lost'").get()).toEqual({ file_path: 'henji://project/removed/a.png', inspection_status: 'missing' })
      db.prepare("DELETE FROM assets WHERE id='deleted'").run()
      await fs.mkdir(path.join(state.user, 'generated'), { recursive: true })
      const unused = path.join(state.user, 'generated', 'unused.png'); const held = path.join(state.user, 'generated', 'held.png')
      for (const file of [unused, held]) { await fs.writeFile(file, 'owned'); await registerOwnedMedia(file) }
      insert.run('held', '引用', held)
      db.prepare("INSERT INTO media_recycle_candidates(source,payload) VALUES ('paths',?)").run(JSON.stringify({ paths: [unused, held], protectedBy: [] }))
      // 已移除位置里的作品被删掉了（卷还在）：退出登记，不再挡住整轮回收。
      db.prepare('INSERT INTO media_recycle_retained(owner) VALUES (?)').run(path.join(root, 'deleted.hjcvs'))
      resetManagedMediaClaimsForTest()
      await runMediaRecycle(new AbortController().signal)
      expect(db.prepare('SELECT count(*) AS n FROM media_recycle_retained').get()).toEqual({ n: 0 })
      await expect(fs.stat(unused)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await fs.readFile(held, 'utf8')).toBe('owned')
      catalog.upsertProject(project)
      expect(db.prepare("SELECT file_path, inspection_status FROM assets WHERE id='lost'").get()).toEqual({ file_path: 'henji://project/removed/a.png', inspection_status: 'pending' })
    } finally { state.db.close(); state.db = undefined; await fs.rm(root, { recursive: true, force: true }) }
  })
  it('atomically transfers receipts to history; across restarts retains saved canvas/undo references, then reclaims after release', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-recycle-db-'))
    state.user = path.join(root, 'user'); state.program = path.join(root, 'program')
    const location = path.join(root, 'henji.db')
    state.db = new Database(location)
    const startup = async (): Promise<void> => {
      state.db!.close(); state.db = new Database(location)
      resetManagedMediaClaimsForTest()
      await runMediaRecycle(new AbortController().signal)
    }
    try {
      const db = state.db
      runSchemaMigrations(db, SCHEMA_MIGRATIONS.slice(0, 20))
      runSchemaMigrations(db)
      assertMediaStorageCoverage(db)
      db.exec('CREATE TABLE unregistered_media (file_path TEXT)')
      expect(() => assertMediaStorageCoverage(db)).toThrow('Missing media reference provider')
      db.exec('DROP TABLE unregistered_media')
      await fs.mkdir(path.join(state.user, 'generated'), { recursive: true })
      const media = path.join(state.user, 'generated', 'result.png')
      await fs.writeFile(media, 'owned result')
      await registerOwnedMedia(media)
      const response = JSON.stringify({ filePaths: [media], urls: [], status: 'completed' })
      db.prepare("INSERT INTO generation_submissions(request_id,input_digest,response_json,created_at,phase) VALUES ('request','digest',?,0,'completed')").run(response)
      expect(db.prepare('SELECT media_released FROM generation_submissions').get()).toEqual({ media_released: 0 })
      db.prepare("INSERT INTO history(id, provider_id, model_id, type, status, params, result_paths) VALUES ('result', 'test', 'test', 'image', 'completed', '{}', ?)").run(JSON.stringify([media]))
      expect(db.prepare('SELECT media_released FROM generation_submissions').get()).toEqual({ media_released: 1 })
      const count = (): unknown => db.prepare("SELECT count(*) AS n FROM media_recycle_candidates WHERE source='history'").get()
      const before = count()
      expect(() => db.transaction(() => { db.prepare("DELETE FROM history WHERE id='result'").run(); throw new Error('rollback') })()).toThrow('rollback')
      expect(count()).toEqual(before)
      db.prepare("DELETE FROM history WHERE id='result'").run()
      const triggers = db.prepare("SELECT name FROM sqlite_schema WHERE type='trigger' AND name LIKE 'media_recycle_%'").all()
      expect(triggers).toHaveLength(Object.keys(MEDIA_REFERENCE_TABLES).length * 2)
      // A document-only delivery is also handed off durably, without a history row.
      db.prepare("INSERT INTO generation_submissions(request_id,input_digest,response_json,created_at,phase) VALUES ('document-only','digest',?,0,'completed')").run(response)

      const canvas = path.join(state.user, 'canvas.hjcvs')
      const savedHistory = path.join(state.program, 'documentStore', 'session-state', 'canvas', 'canvas.history.json')
      await fs.mkdir(path.dirname(savedHistory), { recursive: true })
      await fs.writeFile(canvas, JSON.stringify({ content: { nodes: [{ data: { imageUrl: media } }] } }))
      await recordDocumentMediaPublished(canvas)
      expect(db.prepare("SELECT media_released FROM generation_submissions WHERE request_id='document-only'").get()).toEqual({ media_released: 1 })
      await fs.writeFile(savedHistory, JSON.stringify({ revision: 1, history: { past: [{ mediaPool: [media], nodes: [] }], future: [] } }))
      await startup()
      expect(await fs.readFile(media, 'utf8')).toBe('owned result')
      expect(state.db!.prepare("SELECT media_released FROM generation_submissions WHERE request_id='document-only'").get()).toEqual({ media_released: 1 })
      await fs.writeFile(canvas, JSON.stringify({ content: { nodes: [] } }))
      await startup()
      expect(await fs.readFile(media, 'utf8')).toBe('owned result')
      await fs.writeFile(savedHistory, JSON.stringify({ revision: 2, history: { past: [], future: [] } }))
      await startup()
      await expect(fs.stat(media)).rejects.toMatchObject({ code: 'ENOENT' })
      expect(state.db!.prepare('SELECT * FROM media_recycle_candidates').all()).toHaveLength(0)
      expect(state.db!.prepare('SELECT response_json, media_released FROM generation_submissions').all()).toEqual([{ response_json: response, media_released: 1 }, { response_json: response, media_released: 1 }])
    } finally { state.db?.close(); state.db = undefined; await fs.rm(root, { recursive: true, force: true }) }
  })
})

describe.skipIf(!process.versions.electron)('SQLite 27 guarded retirement outbox', () => {
  it('迁移只留下可能含路径的候选并删掉剪辑缓存设置；之后不含路径的改写不再入队，带路径的改写只记变化的列', () => {
    const db = new Database(':memory:')
    try {
      runSchemaMigrations(db, SCHEMA_MIGRATIONS.slice(0, 26))
      const enqueue = db.prepare('INSERT INTO media_recycle_candidates(source, payload) VALUES (?, ?)')
      const kept = [
        ['settings', { value: 'E:\\文档\\痕迹AI', type: 'string' }],
        ['settings', { value: JSON.stringify({ folders: ['D:\\音效'] }), type: 'json' }],
        ['application_invocations', { record_json: JSON.stringify({ media: 'henji://user/上传素材/a.png' }) }],
        ['audio_edit_tasks', { result_json: JSON.stringify({ file: '/Users/me/a.wav' }) }],
        ['generation_submissions', { response_json: JSON.stringify({ filePaths: ['E:/生成/a.png'] }), phase: 'completed', media_released: 0 }],
        ['history', { params: '{}', result_paths: '[]', id: 'h' }],
        ['paths', { paths: ['/x.png'], protectedBy: [] }],
      ] as const
      const dropped = [
        ['settings', { value: JSON.stringify({ a: 1, note: 'C: drive' }), type: 'json' }],
        ['application_invocations', { record_json: JSON.stringify({ state: 'completed' }) }],
        ['application_observations', { record_json: JSON.stringify({ text: 'see /docs' }) }],
        ['generation_submissions', { response_json: JSON.stringify({ filePaths: ['E:/生成/a.png'] }), phase: 'completed', media_released: 1 }],
      ] as const
      for (const [source, payload] of [...kept, ...dropped]) enqueue.run(source, JSON.stringify(payload))
      const setting = db.prepare("INSERT INTO settings(key, value, type) VALUES (?, ?, 'json') ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      setting.run(`cache.video-edit.code-metadata.v1:${'a'.repeat(64)}`, '{}')
      setting.run('cache.video-edit.render-performance.shown', '[]')
      setting.run('theme', '"dark"')
      runSchemaMigrations(db)
      const candidates = (): Array<{ source: string; payload: string }> => db.prepare('SELECT source, payload FROM media_recycle_candidates ORDER BY id').all() as Array<{ source: string; payload: string }>
      expect(candidates().map(row => [row.source, JSON.parse(row.payload)])).toEqual(kept.map(([source, payload]) => [source, payload]))
      expect(db.prepare("SELECT key FROM settings WHERE key GLOB 'cache.video-edit.*' OR key = 'theme'").pluck().all()).toEqual(['theme'])

      db.prepare("INSERT INTO application_invocations(operation_id, caller_id, state, record_json, updated_at) VALUES ('op', 'c', 'running', '{}', 0)").run()
      const invocation = db.prepare("UPDATE application_invocations SET record_json = ? WHERE operation_id = 'op'")
      for (let index = 0; index < 2000; index++) { setting.run('theme', JSON.stringify({ index })); invocation.run(JSON.stringify({ state: 'running', step: index })) }
      setting.run('theme', JSON.stringify({ index: 1999 }))
      expect(candidates()).toHaveLength(kept.length)

      db.prepare("INSERT INTO history(id, provider_id, model_id, type, params, result_paths, status) VALUES ('r', 'p', 'm', 'image', ?, ?, 'completed')").run(JSON.stringify({ image: 'D:\\上传\\in.png' }), JSON.stringify(['D:\\生成\\out.png']))
      db.prepare("UPDATE history SET result_paths = '[]' WHERE id = 'r'").run()
      expect(JSON.parse(candidates().at(-1)!.payload)).toEqual({ params: null, result_paths: JSON.stringify(['D:\\生成\\out.png']), id: null })
      db.prepare("UPDATE history SET status = 'failed', params = params WHERE id = 'r'").run()
      expect(candidates()).toHaveLength(kept.length + 1)
    } finally { db.close() }
  })
})
