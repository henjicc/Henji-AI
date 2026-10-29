import { createProviderSettingsFileStorage } from '../llm/provider-settings-storage'
import { llmProviderSettingsService } from '../llm/provider-settings'
import { SoundLibraryService } from '../sound-library/service'
import type { LlmConfigState, LlmProviderConfig } from '@henjicc/ai-sdk'
import Database from 'better-sqlite3'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AudioCaptureFiles } from '../audio-capture/files'
import { getSettingsStore } from '../settings/store'
import { RECYCLE_RETENTION_MS } from '../../../../src/core/localRecords/recycle'

const state = vi.hoisted(() => ({ root: '', db: undefined as Database.Database | undefined, trash: vi.fn(async (_target: string): Promise<void> => {}) }))
vi.mock('electron', () => ({ app: { getPath: () => state.root }, shell: { trashItem: (target: string) => state.trash(target) } }))
vi.mock('../appPaths', () => ({ getProgramDataDir: () => state.root, getUserRootDir: () => state.root }))
vi.mock('../logging/main-logger', () => ({ createMainLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() }) }))
vi.mock('../db', async original => ({ ...await original<typeof import('../db')>(), getDb: () => state.db! }))
import { initializeSchema } from '../db'
import { SCHEMA_MIGRATIONS } from '../db-migrations'
import { PresetStore } from '../presets/store'
import { testDatabaseLocations, testLocationContext } from '../db.test-support'
import { RecycleStore, softDelete } from './store'
import { listRecycledItems, readRecycledJsonContents, preserveUserFile, purgeRecycledItems, restoreRecycledItem, trashUserFile } from './runtime'

const integrations = { listDeletedWebRecordings: async () => [], restoreWebRecording: vi.fn(async () => {}), restoreDocumentLocation: vi.fn(async () => {}) }

describe.skipIf(!process.versions.electron)('通用回收与恢复：真实文件及 SQLite', () => {
  beforeEach(async () => {
    state.root = await fs.mkdtemp(path.join(os.tmpdir(), 'henji-recycle-'))
    state.db = new Database(':memory:')
    state.db.pragma('foreign_keys = ON')
    initializeSchema(state.db)
    state.trash.mockImplementation(async target => { await fs.rename(target, path.join(state.root, `system-trash-${crypto.randomUUID()}`)) })
  })
  afterEach(async () => { state.db?.close(); await fs.rm(state.root, { recursive: true, force: true }); vi.clearAllMocks() })

  it('重复删除与恢复覆盖均保留不同内容，失败前原件仍可读，30 天后才清理副本', async () => {
    const target = path.join(state.root, '文档.json')
    await fs.writeFile(target, '第一份')
    await trashUserFile(target)
    const first = (await listRecycledItems(integrations))[0]
    await fs.writeFile(target, '第二份')
    await trashUserFile(target)
    const second = (await listRecycledItems(integrations)).find(item => item.id !== first.id)!
    await restoreRecycledItem(first.id, integrations)
    expect(await fs.readFile(target, 'utf8')).toBe('第一份')
    await restoreRecycledItem(second.id, integrations)
    expect(await fs.readFile(target, 'utf8')).toBe('第二份')
    const displaced = (await listRecycledItems(integrations))[0]
    await restoreRecycledItem(displaced.id, integrations)
    expect(await fs.readFile(target, 'utf8')).toBe('第一份')
    state.trash.mockRejectedValueOnce(new Error('文件占用'))
    await expect(trashUserFile(target)).rejects.toThrow('文件占用')
    expect(await fs.readFile(target, 'utf8')).toBe('第一份')
    const store = new RecycleStore(state.db!)
    const expired = store.files()[0]
    state.db!.prepare('UPDATE recycled_items SET deleted_at = ? WHERE id = ?').run(Date.now() - RECYCLE_RETENTION_MS - 1, expired.id)
    await purgeRecycledItems()
    expect(store.get(expired.id)).toBeUndefined()
    await expect(fs.access(expired.payload)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(target, 'utf8')).toBe('第一份')
  })

  it('文件夹备份包含子文件，保留失败时不执行系统回收', async () => {
    const target = path.join(state.root, '技能')
    await fs.mkdir(path.join(target, 'references'), { recursive: true })
    await fs.writeFile(path.join(target, 'references', '内容.md'), '完整原文')
    await trashUserFile(target)
    await restoreRecycledItem((await listRecycledItems(integrations))[0].id, integrations)
    expect(await fs.readFile(path.join(target, 'references', '内容.md'), 'utf8')).toBe('完整原文')
    const cp = vi.spyOn(fs, 'copyFile').mockRejectedValueOnce(new Error('备份写入失败'))
    await expect(trashUserFile(target)).rejects.toThrow('备份写入失败')
    expect(state.trash).toHaveBeenCalledTimes(1)
    cp.mockRestore()
  })

  it('暂存内容按正式目标保存恢复身份，原目标与源暂存文件都不被提前改写', async () => {
    const target = path.join(state.root, '图片.hjimg'), staging = path.join(state.root, 'working.tmp')
    await fs.writeFile(target, '文件版本'); await fs.writeFile(staging, '工作版本')
    await preserveUserFile(target, '图片工作副本', staging)
    const item = (await listRecycledItems(integrations))[0]
    expect(item.path).toBe(target)
    expect(await fs.readFile(target, 'utf8')).toBe('文件版本')
    await fs.rm(staging)
    await restoreRecycledItem(item.id, integrations)
    expect(await fs.readFile(target, 'utf8')).toBe('工作版本')
    await restoreRecycledItem((await listRecycledItems(integrations))[0].id, integrations)
    expect(await fs.readFile(target, 'utf8')).toBe('文件版本')
  })

  it('预设墓碑隐藏且恢复完整参数；同 ID 配置快照交换不会吞掉当前版本', async () => {
    const db = state.db!, recycle = new RecycleStore(db)
    const presets = new PresetStore(() => db, testDatabaseLocations(testLocationContext(state.root)))
    presets.insert({ id: 'p', name: '人像', description: null, modelId: null, params: { strength: .7 }, isFavorite: true })
    presets.delete('p')
    expect(presets.list()).toEqual([]); expect(presets.get('p')).toBeNull()
    await restoreRecycledItem('presets:p', integrations)
    expect(presets.get('p')).toMatchObject({ params: { strength: .7 }, isFavorite: true })
    db.prepare('INSERT INTO custom_models(id,name,provider_id,config) VALUES (?,?,?,?)').run('m', '原配置', 'test', '{}')
    recycle.preserveRow('custom_models', 'm')
    const snapshot = recycle.list()[0]
    db.prepare('UPDATE custom_models SET name=? WHERE id=?').run('当前配置', 'm')
    await restoreRecycledItem(snapshot.id, integrations)
    expect(db.prepare('SELECT name FROM custom_models WHERE id=?').get('m')).toEqual({ name: '原配置' })
    await restoreRecycledItem(recycle.list()[0].id, integrations)
    expect(db.prepare('SELECT name FROM custom_models WHERE id=?').get('m')).toEqual({ name: '当前配置' })
  })

  it('升级集合唯一索引保留外键关系；删除后可建同名集合，恢复时只调整重名', () => {
    const db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    try {
      for (const migration of SCHEMA_MIGRATIONS.filter(item => item.version < 24)) migration.up(db, { locations: () => testLocationContext(state.root) })
      db.prepare('INSERT INTO assets(id,media_type,display_name,file_path,source,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run('a', 'image', '素材', 'a.png', 'imported', 1, 1)
      db.prepare('INSERT INTO asset_libraries VALUES (?,?,?,?)').run('l', '海报', 1, 1)
      db.prepare('INSERT INTO asset_library_items(library_id,asset_id,added_at,sort_order) VALUES (?,?,?,?)').run('l', 'a', 1, 4)
      db.transaction(() => SCHEMA_MIGRATIONS.find(item => item.version === 24)!.up(db, { locations: () => testLocationContext(state.root) }))()
      softDelete(db, 'asset_libraries', 'l')
      db.prepare('INSERT INTO asset_libraries(id,name,created_at,updated_at) VALUES (?,?,?,?)').run('other', '海报', 2, 2)
      new RecycleStore(db).restoreRow('asset_libraries:l')
      expect(db.prepare('SELECT name FROM asset_libraries WHERE id=?').get('l')).toEqual({ name: '海报 (2)' })
      expect(db.prepare('SELECT asset_id,sort_order FROM asset_library_items WHERE library_id=?').all('l')).toEqual([{ asset_id: 'a', sort_order: 4 }])
      expect(db.pragma('foreign_key_check')).toEqual([])
    } finally { db.close() }
  })
  it('坏 JSON、BOM 文件和断链互不影响扫描，读不懂时通知资源保留', async () => {
    const dir = path.join(state.root, '备份内容'); await fs.mkdir(dir)
    await fs.writeFile(path.join(dir, 'good.json'), '\uFEFF{"resources":["image-1"]}')
    await fs.writeFile(path.join(dir, 'broken.json'), '{broken')
    await trashUserFile(dir)
    const unreadable: string[] = [], values: unknown[] = []
    for await (const value of readRecycledJsonContents(file => unreadable.push(file))) values.push(value)
    expect(values).toEqual([{ resources: ['image-1'] }])
    expect(unreadable).toHaveLength(1)
  })

  it('目录链接创建失败只保留链接指向，普通内容照常备份和恢复', async () => {
    const outside = path.join(state.root, '外部'); await fs.mkdir(outside); await fs.writeFile(path.join(outside, '不能复制.txt'), '外部内容')
    const project = path.join(state.root, '项目'); await fs.mkdir(project); await fs.writeFile(path.join(project, '文档.json'), '{}')
    await fs.symlink(outside, path.join(project, '目录链接'), 'junction')
    const link = vi.spyOn(fs, 'symlink').mockRejectedValueOnce(Object.assign(new Error('权限不足'), { code: 'EPERM' }))
    try { await trashUserFile(project) } finally { link.mockRestore() }
    const recycle = new RecycleStore(state.db!), item = recycle.list()[0]
    const saved = JSON.parse(recycle.get(item.id)!.payload)
    expect(saved.links).toMatchObject([{ relativePath: '目录链接', target: outside }])
    await expect(fs.access(path.join(saved.backup, '目录链接'))).rejects.toMatchObject({ code: 'ENOENT' })
    await restoreRecycledItem(item.id, integrations)
    expect((await fs.lstat(path.join(project, '目录链接'))).isSymbolicLink()).toBe(true)
    expect(await fs.readFile(path.join(outside, '不能复制.txt'), 'utf8')).toBe('外部内容')
  })

  it('放弃的录音恢复后重新出现在待处理录音中，保留原拼接位置', async () => {
    const files = new AudioCaptureFiles(() => state.root, getSettingsStore, (file, placement) => trashUserFile(file, undefined, placement))
    const placement = { projectId: 'p', startFrame: 10, endFrame: 20, revision: 2, spliceId: crypto.randomUUID() }
    const file = await files.prepare(undefined, placement); await fs.writeFile(file.outputPath, Buffer.alloc(92))
    await files.discard(file.outputPath)
    expect(await files.pending()).toEqual([])
    await restoreRecycledItem((await listRecycledItems(integrations)).find(item => item.path === file.outputPath)!.id, integrations)
    expect(await files.pending()).toMatchObject([{ outputPath: file.outputPath, placement }])
  })

  it('清空历史生成一个回收项，可整批恢复且不影响清空后新增的记录', async () => {
    const { GenerationHistoryStore } = await import('../generation-history/store')
    const history = new GenerationHistoryStore(() => state.db!, testDatabaseLocations(testLocationContext(state.root)))
    const insert = state.db!.prepare("INSERT INTO history(id,provider_id,model_id,type,prompt,params,result_paths,status) VALUES (?,'p','m','image',?,'{}','[]','completed')")
    insert.run('h1', '第一条'); insert.run('h2', '第二条')
    expect(history.clear()).toBe(2)
    const items = await listRecycledItems(integrations); expect(items).toHaveLength(1); expect(items[0].category).toBe('生成历史')
    insert.run('h3', '后来新增')
    await restoreRecycledItem(items[0].id, integrations)
    expect(state.db!.prepare('SELECT id FROM history WHERE deleted_at IS NULL ORDER BY id').all()).toEqual([{ id: 'h1' }, { id: 'h2' }, { id: 'h3' }])
  })

  it('素材重导入与重定位不占用墓碑路径，恢复时保留双方身份和文件', async () => {
    const db = state.db!, recycle = new RecycleStore(db), file = path.join(state.root, 'image.png')
    await fs.writeFile(file, 'image')
    const insert = db.prepare("INSERT INTO assets(id,media_type,display_name,file_path,source,created_at,updated_at) VALUES (?,'image',?,?,'imported',1,1)")
    insert.run('a1', '旧名称', file); softDelete(db, 'assets', 'a1')
    insert.run('a2', '新导入', file)
    expect(recycle.list()).toMatchObject([{ id: 'assets:a1', name: '旧名称' }])
    await restoreRecycledItem('assets:a1', integrations)
    const rows = db.prepare('SELECT id,display_name,file_path FROM assets ORDER BY id').all() as Array<{ id: string; display_name: string; file_path: string }>
    expect(rows[1]).toEqual({ id: 'a2', display_name: '新导入', file_path: file })
    const { databaseLocations } = await import('../db-locations')
    expect(await fs.readFile(databaseLocations.use(scope => scope.decodePath(rows[0].file_path)), 'utf8')).toBe('image')
    expect(rows[0].display_name).toBe('旧名称')
  })

  it('音效只备份被取消登记的文件夹，恢复不撤掉后续登记和改名，同 ID 冲突分开保留', async () => {
    const { readSoundLibraryFolders, writeSoundLibraryFolders } = await import('../sound-library/registry')
    const folder = { id: crypto.randomUUID(), path: path.join(state.root, '被删音效'), addedAt: new Date().toISOString() }
    const another = { ...folder, id: crypto.randomUUID(), path: path.join(state.root, '保留音效') }
    await writeSoundLibraryFolders([folder, another]); await writeSoundLibraryFolders([another])
    const recycle = new RecycleStore(state.db!), item = recycle.list()[0]
    expect(item.name).toBe('被删音效'); expect(recycle.get(item.id)!.kind).toBe('member')
    const changed = { ...folder, path: path.join(state.root, '后来登记') }
    await writeSoundLibraryFolders([changed, { ...another, path: path.join(state.root, '后来改名') }])
    await restoreRecycledItem(item.id, integrations)
    const restored = await readSoundLibraryFolders()
    expect(restored.slice(0, 2)).toEqual([changed, { ...another, path: path.join(state.root, '后来改名') }])
    expect(restored[2]).toMatchObject({ path: folder.path }); expect(restored[2].id).not.toBe(folder.id)
  })

  it('供应商文件只登记被删项，恢复后保留其余供应商的后续改动', async () => {
    const removed: LlmProviderConfig = { providerId: 'p', displayName: '被删供应商', adapter: 'openai', baseUrl: 'https://example.com/v1', providerFamilyId: 'openai-compatible', endpointProfile: 'default', setup: { kind: 'custom', apiKeyManagementUrl: 'https://example.com/keys' }, credentialId: 'slot', enabled: true }
    const kept = { ...removed, providerId: 'q', displayName: '保留供应商' }
    const config: LlmConfigState = { providers: [removed, kept], models: [], promptProfiles: [], agentProfiles: [], textProcessingPromptTemplates: [], tools: [], policy: { allowedTools: [], requireHumanConfirmation: false }, memory: {} }
    const storage = createProviderSettingsFileStorage()
    await storage.writeConfig(config); await storage.writeConfig({ ...config, providers: [kept] })
    const recycle = new RecycleStore(state.db!), item = recycle.list()[0]
    expect(item.name).toBe(removed.displayName)
    expect(JSON.parse(recycle.get(item.id)!.payload)).toEqual({ provider: removed, models: [] })
    const changed = { ...kept, displayName: '后来改名', baseUrl: 'https://changed.example/v1' }
    await storage.writeConfig({ ...config, providers: [changed] })
    await restoreRecycledItem(item.id, integrations)
    expect((await llmProviderSettingsService.readConfig())!.providers).toEqual([changed, removed])
  })

  it('恢复音效文件夹同步已加载服务，直接搜索和后续登记不会丢失恢复项', async () => {
    const { readSoundLibraryFolders, writeSoundLibraryFolders, restoreSoundLibraryFolder, onSoundLibraryFoldersRestored } = await import('../sound-library/registry')
    const folder = { id: crypto.randomUUID(), path: path.join(state.root, '音效'), addedAt: new Date().toISOString() }
    await fs.mkdir(folder.path); await writeSoundLibraryFolders([folder])
    const service = new SoundLibraryService({ readFolders: readSoundLibraryFolders, writeFolders: writeSoundLibraryFolders, chooseFolder: async () => null, allowFolder: file => file, analyze: async () => ({ provider: null, decodeMs: 0, inferenceMs: 0, files: [] }), embedText: async () => [], clapModels: async () => null, cache: null, emit: vi.fn(), log: vi.fn() })
    const unsubscribe = onSoundLibraryFoldersRestored(() => service.reloadFolders())
    try {
      await service.removeFolder(folder.id)
      await restoreSoundLibraryFolder(folder)
      await expect(service.search({ folderIds: [folder.id], keywords: ['音效'], limit: 1 })).resolves.toMatchObject({ noGoodMatch: true })
      const another = path.join(state.root, '另一个'); await fs.mkdir(another); await service.addFolder(another)
      expect((await readSoundLibraryFolders()).map(value => value.id)).toContain(folder.id)
    } finally { unsubscribe() }
  })

})
