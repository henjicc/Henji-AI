import Database from 'better-sqlite3'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LocationContext } from '../../../src/core/storage/locationCodec'

vi.mock('./logging/main-logger', () => ({
  createMainLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { initializeSchema } from './db'
import { createLegacyDatabase } from './db-legacy-schema.test-support'
import { runSchemaMigrations, SCHEMA_MIGRATIONS } from './db-migrations'
import { testDatabaseLocations, testLocationContext } from './db.test-support'
import { GenerationHistoryStore } from './generation-history/store'
import { PresetStore } from './presets/store'
import { SettingsStore } from './settings/store'

/*
 * 存储底座 2.3：旧库就地进入迁移账本、数据保留、生成记录结果改数组、路径换成位置写法、重复执行幂等；
 * 以及各仓库按位置写法存取（换作品目录后记录不用改写）。原生驱动使用 Electron ABI，
 * 登记在 scripts/lib/testSuites.cjs 的原生清单里，由 test:assistant-persistence 执行。
 */

const ALL_VERSIONS = SCHEMA_MIGRATIONS.map((migration) => migration.version)

function ledger(db: Database.Database): number[] {
  return (db.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>).map((row) => row.version)
}

function columns(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => column.name)
}

describe.skipIf(!process.versions.electron)('统一迁移账本：旧库就地升级', () => {
  let base: string
  let context: LocationContext

  beforeEach(async () => {
    base = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-db-migration-'))
    context = testLocationContext(base)
  })

  afterEach(async () => {
    await fsp.rm(base, { recursive: true, force: true })
  })

  function seedLegacy(db: Database.Database): { userFile: string; externalFile: string; thumbnail: string } {
    createLegacyDatabase(db)
    const userFile = path.join(context.userRoot, '生成结果', 'a.png')
    const externalFile = path.join(base, '外部', 'b.mp4')
    const thumbnail = path.join(context.programRoots![0]!, 'Thumbnails', `${'c'.repeat(64)}.webp`)
    // 生成记录：结果用 ||| 拼接；第一个是旧版相对作品目录的写法，第二个是外部绝对路径。
    db.prepare('INSERT INTO history (id,provider_id,model_id,type,prompt,params,file_path,status,created_at) VALUES (?,?,?,?,?,?,?,?,?)').run(
      'h1', 'kie', 'model', 'image', '一只橘猫趴在窗台上晒太阳',
      JSON.stringify({ uploadedFilePaths: ['上传素材/ref.png', externalFile], __resultUrl: 'henji-media://local/x', size: '1:1' }),
      `生成结果/a.png|||${externalFile}`, 'success', '2026-01-01 00:00:00')
    db.prepare('INSERT INTO history (id,provider_id,model_id,type,prompt,params,file_path,status) VALUES (?,?,?,?,?,?,?,?)').run(
      'h2', 'kie', 'model', 'video', null, '', null, 'error')
    db.prepare('INSERT INTO presets (id,name,model_id,params,is_favorite,use_count) VALUES (?,?,?,?,?,?)').run(
      'p1', '预设', 'model', JSON.stringify({ reference: userFile }), 1, 3)
    db.prepare('INSERT INTO settings (key,value,type) VALUES (?,?,?)').run('custom_data_directory', context.userRoot, 'string')
    db.prepare('INSERT INTO settings (key,value,type) VALUES (?,?,?)').run('voice_library', JSON.stringify([{ sample: userFile }]), 'json')
    db.prepare('INSERT INTO settings (key,value,type) VALUES (?,?,?)').run('theme', 'dark', 'string')
    db.prepare('INSERT INTO custom_models (id,name,provider_id,config) VALUES (?,?,?,?)').run('m1', '自定义', 'modelscope', '{"a":1}')
    db.prepare("INSERT INTO assets (id,media_type,display_name,file_path,source,thumbnail_path,inspection_status,content_identity,created_at,updated_at) VALUES (?,?,?,?,?,?,'ready',?,?,?)").run(
      'a1', 'image', '素材', userFile, 'imported', thumbnail, 'd'.repeat(64), 1, 2)
    db.prepare("INSERT INTO assets (id,media_type,display_name,file_path,source,thumbnail_path,inspection_status,content_identity,created_at,updated_at) VALUES (?,?,?,?,?,?,'ready',?,?,?)").run(
      'a2', 'video', '外部素材', externalFile, 'external', path.join(base, 'old-thumb.png'), 'e'.repeat(64), 1, 2)
    db.prepare('INSERT INTO asset_libraries (id,name,created_at,updated_at) VALUES (?,?,?,?)').run('lib', '库', 1, 1)
    db.prepare('INSERT INTO asset_library_items (library_id,asset_id,added_at) VALUES (?,?,?)').run('lib', 'a1', 1)
    db.prepare('INSERT INTO pending_task_results (server_task_id,result_json,completed_at) VALUES (?,?,?)').run('t1', JSON.stringify({ filePath: userFile }), 1)
    db.prepare('INSERT INTO generation_submissions (request_id,input_digest,response_json,created_at) VALUES (?,?,?,?)').run('r1', 'digest', JSON.stringify({ status: 'completed', filePath: userFile }), 1)
    db.prepare('INSERT INTO camera_stage_render_tasks (request_id,record_json) VALUES (?,?)').run('c1', JSON.stringify({ requestId: 'c1', outputPath: userFile }))
    db.prepare('INSERT INTO camera_stage_projects (id,name,created_at,updated_at,object_count,scene_json) VALUES (?,?,?,?,?,?)').run('stage', '旧镜头', 1, 1, 1, '{}')
    db.prepare("INSERT INTO agent_memories (memory_id,scope_type,kind,content,source_label,sensitivity,status,created_at,updated_at) VALUES ('mem','global','fact','记住','测试','C0','active',1,1)").run()
    return { userFile, externalFile, thumbnail }
  }

  it('旧库（含 2.2 账本第 1 项）进入账本：数据保留、结果改数组、路径换写法、缩略图只存文件名，再次执行不改动', () => {
    const db = new Database(':memory:')
    try {
      const { userFile, externalFile } = seedLegacy(db)
      // 2.2 已经执行过第 1 项的库。
      runSchemaMigrations(db, SCHEMA_MIGRATIONS.slice(0, 1))
      const resolver = vi.fn(() => context)
      initializeSchema(db, { locationContext: resolver })
      expect(ledger(db)).toEqual(ALL_VERSIONS)
      expect(resolver).toHaveBeenCalledTimes(1)

      // 生成记录：新结构、结果数组、位置写法；旧的空 params 补成 {}。
      expect(columns(db, 'history')).toContain('result_paths')
      expect(columns(db, 'history')).not.toContain('file_path')
      const h1 = db.prepare('SELECT * FROM history WHERE id = ?').get('h1') as Record<string, string>
      expect(JSON.parse(h1.result_paths)).toEqual(['henji://user/生成结果/a.png', externalFile])
      expect(JSON.parse(h1.params)).toEqual({ uploadedFilePaths: ['henji://user/上传素材/ref.png', externalFile], size: '1:1' })
      expect(h1).toMatchObject({ prompt: '一只橘猫趴在窗台上晒太阳', status: 'success', created_at: '2026-01-01 00:00:00' })
      expect(db.prepare('SELECT params, result_paths FROM history WHERE id = ?').get('h2')).toEqual({ params: '{}', result_paths: '[]' })

      // 预设、设置（作品目录本身不换算）、自定义模型、助手记忆原样保留。
      expect(JSON.parse((db.prepare('SELECT params FROM presets').get() as { params: string }).params)).toEqual({ reference: 'henji://user/生成结果/a.png' })
      expect(db.prepare('SELECT is_favorite, use_count FROM presets').get()).toEqual({ is_favorite: 1, use_count: 3 })
      const settings = new Map((db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>).map((row) => [row.key, row.value]))
      expect(settings.get('custom_data_directory')).toBe(context.userRoot)
      expect(JSON.parse(settings.get('voice_library')!)).toEqual([{ sample: 'henji://user/生成结果/a.png' }])
      expect(settings.get('theme')).toBe('dark')
      expect(db.prepare('SELECT config FROM custom_models').get()).toEqual({ config: '{"a":1}' })
      expect(db.prepare('SELECT content FROM agent_memories').get()).toEqual({ content: '记住' })

      // 素材库：位置写法；本程序生成的缩略图只留文件名，其他缩略图清空并让下次检查重建。
      expect(columns(db, 'assets')).toEqual(expect.arrayContaining(['thumbnail_name', 'content_identity']))
      expect(columns(db, 'assets')).not.toContain('thumbnail_path')
      expect(db.prepare('SELECT file_path, thumbnail_name, content_identity FROM assets WHERE id = ?').get('a1'))
        .toEqual({ file_path: 'henji://user/生成结果/a.png', thumbnail_name: `${'c'.repeat(64)}.webp`, content_identity: 'd'.repeat(64) })
      expect(db.prepare('SELECT file_path, thumbnail_name, content_identity FROM assets WHERE id = ?').get('a2'))
        .toEqual({ file_path: externalFile, thumbnail_name: null, content_identity: null })
      expect(db.prepare('SELECT * FROM asset_library_items').all()).toHaveLength(1)

      // 回执 JSON 整份换算；生成提交账本补齐当时散写的列。
      expect(JSON.parse((db.prepare('SELECT result_json FROM pending_task_results').get() as { result_json: string }).result_json)).toEqual({ filePath: 'henji://user/生成结果/a.png' })
      expect(columns(db, 'generation_submissions')).toEqual(expect.arrayContaining(['phase', 'model_id']))
      expect(db.prepare('SELECT phase FROM generation_submissions').get()).toEqual({ phase: 'provider' })
      expect(JSON.parse((db.prepare('SELECT response_json FROM generation_submissions').get() as { response_json: string }).response_json)).toMatchObject({ filePath: 'henji://user/生成结果/a.png' })
      // 3.2 第 15 项：镜头参考旧工程表删除，引用旧工程 ID 的渲染回执清空（不迁移内容，重要记录 008）。
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'camera_stage_projects'").get()).toBeUndefined()
      // 3.4 第 17 项：两张旧画布工程表删除。
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('storyboard_projects', 'canvas_projects')").all()).toEqual([])
      expect(db.prepare('SELECT * FROM camera_stage_render_tasks').all()).toEqual([])
      expect(fs.existsSync(userFile)).toBe(false) // 只改记录，不碰文件

      // 再次初始化：账本已满，不再执行，也不再解析作品目录。
      const snapshot = db.prepare('SELECT * FROM history ORDER BY id').all()
      initializeSchema(db, { locationContext: resolver })
      expect(resolver).toHaveBeenCalledTimes(1)
      expect(db.prepare('SELECT * FROM history ORDER BY id').all()).toEqual(snapshot)
    } finally { db.close() }
  })

  it('全新库：全部迁移执行、不解析作品目录、不备份', () => {
    const db = new Database(path.join(base, 'fresh.db'))
    try {
      const resolver = vi.fn(() => context)
      const result = runSchemaMigrations(db, undefined, { locationContext: resolver, backupDirectory: path.join(base, 'backups') })
      expect(result).toEqual({ applied: ALL_VERSIONS, currentVersion: ALL_VERSIONS.length, backupPath: null })
      expect(resolver).not.toHaveBeenCalled()
      expect(fs.existsSync(path.join(base, 'backups'))).toBe(false)
    } finally { db.close() }
  })

  it('镜头参考退役（第 15 项）：已在第 14 项的库先备份再删旧工程表、清空旧回执；之前的回执换算照常', () => {
    const file = path.join(base, 'henji-v14.db')
    const db = new Database(file)
    try {
      const { userFile } = seedLegacy(db)
      runSchemaMigrations(db, SCHEMA_MIGRATIONS.slice(0, 14), { locationContext: () => context, backupDirectory: path.join(base, 'backups-14') })
      expect(JSON.parse((db.prepare('SELECT record_json FROM camera_stage_render_tasks').get() as { record_json: string }).record_json))
        .toMatchObject({ outputPath: 'henji://user/生成结果/a.png' })
      expect(fs.existsSync(userFile)).toBe(false)
      const backupDirectory = path.join(base, 'backups')
      const result = runSchemaMigrations(db, undefined, { locationContext: () => context, backupDirectory })
      expect(result.applied).toEqual([15, 16, 17])
      expect(fs.readdirSync(backupDirectory)).toEqual([expect.stringMatching(/-before-v15\.db$/)])
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%camera_stage_projects%'").all()).toEqual([])
      expect(db.prepare('SELECT * FROM camera_stage_render_tasks').all()).toEqual([])
      const copy = new Database(path.join(backupDirectory, fs.readdirSync(backupDirectory)[0]!), { readonly: true })
      try {
        expect(copy.prepare('SELECT name FROM camera_stage_projects').all()).toEqual([{ name: '旧镜头' }])
      } finally { copy.close() }
    } finally { db.close() }
  })

  it('口播退役（第 16 项）：已在第 15 项的库先备份再删旧工程表，任务表重建为按文档 ID 归属', () => {
    const file = path.join(base, 'henji-v15.db')
    const db = new Database(file)
    try {
      seedLegacy(db)
      runSchemaMigrations(db, SCHEMA_MIGRATIONS.slice(0, 15), { locationContext: () => context, backupDirectory: path.join(base, 'backups-15') })
      // 2.3 之前每次启动由 initializeLegacyProjectTables 建的两张旧表（带级联外键）。
      db.exec(`
        CREATE TABLE audio_edit_projects (id TEXT PRIMARY KEY, name TEXT NOT NULL, document_json TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX idx_audio_edit_projects_updated_at ON audio_edit_projects(updated_at DESC);
        CREATE TABLE audio_edit_tasks (request_id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES audio_edit_projects(id) ON DELETE CASCADE,
          kind TEXT NOT NULL, state TEXT NOT NULL, provider_task_id TEXT, input_digest TEXT NOT NULL, result_json TEXT, error_message TEXT,
          created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
        CREATE INDEX idx_audio_edit_tasks_project ON audio_edit_tasks(project_id, updated_at DESC);
      `)
      db.prepare('INSERT INTO audio_edit_projects VALUES (?,?,?,?,?)').run('voice', '旧口播', '{}', 1, 1)
      db.prepare("INSERT INTO audio_edit_tasks VALUES ('t1','voice','transcription','completed',NULL,'digest',NULL,NULL,1,1)").run()
      const backupDirectory = path.join(base, 'backups')
      const result = runSchemaMigrations(db, undefined, { locationContext: () => context, backupDirectory })
      expect(result.applied).toEqual([16, 17])
      expect(fs.readdirSync(backupDirectory)).toEqual([expect.stringMatching(/-before-v16\.db$/)])
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%audio_edit_projects%'").all()).toEqual([])
      expect(columns(db, 'audio_edit_tasks')).toContain('document_id')
      expect(columns(db, 'audio_edit_tasks')).not.toContain('project_id')
      expect(db.prepare('SELECT * FROM audio_edit_tasks').all()).toEqual([])
      // 新表不再引用工程表：按文档 ID 直接写入
      db.prepare("INSERT INTO audio_edit_tasks (request_id,document_id,kind,state,input_digest,created_at,updated_at) VALUES ('t2','doc-1','silence','queued','d',1,1)").run()
      const copy = new Database(path.join(backupDirectory, fs.readdirSync(backupDirectory)[0]!), { readonly: true })
      try {
        expect(copy.prepare('SELECT name FROM audio_edit_projects').all()).toEqual([{ name: '旧口播' }])
      } finally { copy.close() }
    } finally { db.close() }
  })

  it('画布退役（第 17 项）：有旧画布工程的库先备份再删两张旧表，内容不迁移', () => {
    const file = path.join(base, 'henji-v16.db')
    const db = new Database(file)
    try {
      seedLegacy(db)
      runSchemaMigrations(db, SCHEMA_MIGRATIONS.slice(0, 16), { locationContext: () => context, backupDirectory: path.join(base, 'backups-16') })
      db.prepare('INSERT INTO storyboard_projects (id,name,created_at,updated_at,node_count,nodes_json,edges_json,viewport_json,history_json) VALUES (?,?,?,?,?,?,?,?,?)')
        .run('canvas-1', '旧画布', 1, 1, 0, '[]', '[]', '{}', '{}')
      const backupDirectory = path.join(base, 'backups')
      const result = runSchemaMigrations(db, undefined, { locationContext: () => context, backupDirectory })
      expect(result.applied).toEqual([17])
      expect(fs.readdirSync(backupDirectory)).toEqual([expect.stringMatching(/-before-v17\.db$/)])
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE '%storyboard_projects%' OR name LIKE '%canvas_projects%'").all()).toEqual([])
      const copy = new Database(path.join(backupDirectory, fs.readdirSync(backupDirectory)[0]!), { readonly: true })
      try {
        expect(copy.prepare('SELECT name FROM storyboard_projects').all()).toEqual([{ name: '旧画布' }])
      } finally { copy.close() }
    } finally { db.close() }
  })

  it('全新库：不再有账本之外的旧工程表', () => {
    const db = new Database(':memory:')
    try {
      initializeSchema(db)
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name IN ('storyboard_projects', 'canvas_projects', 'camera_stage_projects', 'audio_edit_projects')").all()).toEqual([])
    } finally { db.close() }
  })

  it('全新库：口播任务表由账本建出，按文档 ID 归属', () => {
    const db = new Database(':memory:')
    try {
      initializeSchema(db)
      expect(columns(db, 'audio_edit_tasks')).toContain('document_id')
      expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'audio_edit_projects'").get()).toBeUndefined()
    } finally { db.close() }
  })

  it('有数据的旧库在破坏性迁移前先整库备份，备份里是迁移前的数据', () => {
    const file = path.join(base, 'henji.db')
    const db = new Database(file)
    try {
      seedLegacy(db)
      const backupDirectory = path.join(base, 'backups')
      initializeSchema(db, { locationContext: () => context, backupDirectory })
      const backups = fs.readdirSync(backupDirectory)
      expect(backups).toHaveLength(1)
      expect(backups[0]).toMatch(/^henji-.*-before-v5\.db$/)
      const copy = new Database(path.join(backupDirectory, backups[0]!), { readonly: true })
      try {
        expect(columns(copy, 'history')).toContain('file_path')
        expect(copy.prepare('SELECT file_path FROM history WHERE id = ?').get('h1')).toMatchObject({ file_path: expect.stringContaining('|||') })
      } finally { copy.close() }
    } finally { db.close() }
  })
})

describe.skipIf(!process.versions.electron)('数据库仓库按位置写法存取', () => {
  let base: string
  let db: Database.Database

  beforeEach(async () => {
    base = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-db-stores-'))
    db = new Database(':memory:')
    initializeSchema(db)
  })

  afterEach(async () => {
    db.close()
    await fsp.rm(base, { recursive: true, force: true })
  })

  it('生成记录：结果数组与参数按位置写法存储，换作品目录后读出新位置；全文检索与前缀筛选', () => {
    const first = testLocationContext(path.join(base, 'old'), [{ id: 'proj_1', root: path.join(base, 'old', '痕迹AI', '项目', '海报') }])
    const store = new GenerationHistoryStore(() => db, testDatabaseLocations(first))
    const inUser = path.join(first.userRoot, '生成结果', 'a.png')
    const inProject = path.join(first.projects[0]!.root, '生成结果', 'b.png')
    const external = path.join(base, '外部', 'c.png')
    store.insert({ id: 'fixture_1', providerId: 'kie', modelId: 'model', type: 'image', prompt: '黄昏时分的海港，渔船缓缓驶入',
      params: { uploadedFilePaths: [inUser, external], strength: 0.5 }, resultPaths: [inUser, inProject, external],
      taskId: null, status: 'success', errorMessage: null, cost: null, duration: null, createdAt: '2026-02-01T00:00:00.000Z' })
    store.insert({ id: 'other', providerId: 'kie', modelId: 'model', type: 'image', prompt: '一只猫', params: {}, resultPaths: [],
      taskId: null, status: 'pending', errorMessage: null, cost: null, duration: null })

    const raw = db.prepare('SELECT params, result_paths FROM history WHERE id = ?').get('fixture_1') as { params: string; result_paths: string }
    expect(JSON.parse(raw.result_paths)).toEqual(['henji://user/生成结果/a.png', 'henji://project/proj_1/生成结果/b.png', external])
    expect(JSON.parse(raw.params)).toEqual({ uploadedFilePaths: ['henji://user/生成结果/a.png', external], strength: 0.5 })
    expect(store.get('fixture_1')).toMatchObject({ resultPaths: [inUser, inProject, external], params: { uploadedFilePaths: [inUser, external] } })

    // 换作品目录、项目移到别处：表不改写，读出的就是新位置。
    const moved = testLocationContext(path.join(base, 'new'), [{ id: 'proj_1', root: path.join(base, '别处', '海报') }])
    const after = new GenerationHistoryStore(() => db, testDatabaseLocations(moved)).get('fixture_1')
    expect(after?.resultPaths).toEqual([
      path.join(moved.userRoot, '生成结果', 'a.png'),
      path.join(base, '别处', '海报', '生成结果', 'b.png'),
      external,
    ])

    expect(store.list({ search: '渔船缓缓' }).map((record) => record.id)).toEqual(['fixture_1'])
    expect(store.list({ search: '猫' }).map((record) => record.id)).toEqual(['other'])
    expect(store.list({ idPrefix: 'fixture_' }).map((record) => record.id)).toEqual(['fixture_1'])
    expect(store.getStatus('fixture_1')).toMatchObject({ hasResult: true, status: 'success' })

    store.update('fixture_1', { prompt: '清晨的海港', resultPaths: [inUser] })
    expect(store.list({ search: '黄昏时分' })).toEqual([])
    expect(store.list({ search: '清晨的海港' }).map((record) => record.id)).toEqual(['fixture_1'])
    expect(store.get('fixture_1')?.resultPaths).toEqual([inUser])
    expect(store.deleteMany(['fixture_1', 'missing'])).toBe(1)
    expect(store.list({ search: '清晨的海港' })).toEqual([])
    expect(store.count()).toBe(1)
  })

  it('设置与预设：路径值按位置写法存储；作品目录本身的设置原样存取；不含路径的值不解析作品目录', () => {
    const context = testLocationContext(base)
    const resolver = vi.fn(() => context)
    const locations = testDatabaseLocations(context)
    const settings = new SettingsStore(() => db, { use: (run) => { resolver(); return locations.use(run) } })
    settings.set('theme', 'dark')
    settings.set('mcp.preferences', JSON.stringify({ enabled: true }), 'json')
    expect(resolver).not.toHaveBeenCalled()
    const sample = path.join(context.userRoot, '素材', 'voice.wav')
    settings.set('voice_library', JSON.stringify([{ sample }]), 'json')
    settings.set('custom_data_directory', context.userRoot)
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('voice_library')).toEqual({ value: JSON.stringify([{ sample: 'henji://user/素材/voice.wav' }]) })
    expect(db.prepare('SELECT value FROM settings WHERE key = ?').get('custom_data_directory')).toEqual({ value: context.userRoot })
    expect(settings.getEntry('voice_library')).toEqual({ key: 'voice_library', value: JSON.stringify([{ sample }]), type: 'json' })
    expect(settings.get('theme')).toBe('dark')
    expect(settings.get('custom_data_directory')).toBe(context.userRoot)
    settings.delete('theme')
    expect(settings.get('theme')).toBeNull()

    const presets = new PresetStore(() => db, locations)
    presets.insert({ id: 'p', name: '预设', description: null, modelId: null, params: { ref: sample }, isFavorite: false })
    expect(db.prepare('SELECT params FROM presets').get()).toEqual({ params: JSON.stringify({ ref: 'henji://user/素材/voice.wav' }) })
    presets.incrementUsage('p')
    expect(presets.list({ modelId: 'any-model' })).toMatchObject([{ id: 'p', params: { ref: sample }, useCount: 1 }])
    presets.update('p', { isFavorite: true })
    expect(presets.list({ onlyFavorites: true })).toHaveLength(1)
  })
})
