import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createCountedSqlite } from '../documents/sqlite.test-support'
import { createDocumentIndexSchemaV1, addDocumentIndexLastOpenedV1 } from '../documents/index-schema'
import { createAssetLibraryTablesV1, addAssetForeignMarker } from './schema'
import { DocumentIndexStore } from '../documents/index-store'

const state = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('../db', () => ({ getDb: state.getDb }))
vi.mock('electron', () => ({ app: { getPath: () => path.resolve('test-temp') }, protocol: {} }))
vi.mock('../appPaths', () => ({ getAppBaseDir: () => path.resolve('test-program'), getProgramDataDir: () => path.resolve('test-program'), getProgramStoreDir: () => path.resolve('test-program/thumbnails'), getUserRootDir: () => path.resolve('test-user'), CONTENT_ADDRESSED_FOLDER_NAMES: new Set() }))
vi.mock('../logging/main-logger', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
vi.mock('../media/rootGrants', () => ({ persistMediaRootGrant: vi.fn(), restorePersistedMediaRoots: () => [] }))
vi.mock('../image-editor-v3/resource-media-url', () => ({ IMAGE_EDITOR_V3_MEDIA_HOST: 'image-editor-v3', resolveImageEditorV3ResourceMediaUrl: vi.fn() }))
vi.mock('./mediaInspection', () => ({ inspectMedia: vi.fn(), normalizeAssetPath: (value: string) => value }))
vi.mock('./thumbnailService', () => ({ ensureAssetThumbnail: vi.fn() }))
import { createAsset, deleteAsset, getAssetFilePath, inspectAsset, queryAssets, relocateAsset } from './index'

let fixture: ReturnType<typeof createCountedSqlite>
let catalog: DocumentIndexStore
const project = { id: 'project_1', path: path.resolve('test-user/project'), name: '项目', locale: 'zh' as const, folders: { generated: 'generated', materials: 'materials' }, draft: false, mainVideoEditId: null, createdAt: 1, external: false, missing: false, manifestModifiedAt: 1, manifestSize: 1, folderCreatedAt: 1, lastOpenedAt: null }
beforeEach(() => {
  fixture = createCountedSqlite(); state.getDb.mockReturnValue(fixture.db)
  createDocumentIndexSchemaV1(fixture.db); addDocumentIndexLastOpenedV1(fixture.db); createAssetLibraryTablesV1(fixture.db); fixture.db.exec('ALTER TABLE assets ADD COLUMN deleted_at INTEGER; ALTER TABLE asset_libraries ADD COLUMN deleted_at INTEGER')
  catalog = new DocumentIndexStore(fixture.db, process.platform === 'win32' ? 'win32' : 'posix')
  catalog.upsertProject(project)
  const insert = fixture.db.prepare("INSERT INTO assets(id,media_type,display_name,file_path,source,inspection_status,created_at,updated_at) VALUES (?,'image',?,?,'imported','ready',1,1)")
  insert.run('lost', '项目素材', 'henji://project/project_1/materials/a.png')
  insert.run('normal', '正常素材', path.resolve('normal.png'))
})
afterEach(() => fixture.native.close())

it('历史 imported 代码资产保持本机身份，只有新导入和派生资产记录来源', () => {
  fixture.db.prepare("INSERT INTO assets(id,media_type,display_name,file_path,source,inspection_status,created_at,updated_at) VALUES ('history','code','历史代码',?,'imported','ready',1,1)").run(path.resolve('history.henji-code'))
  addAssetForeignMarker(fixture.db)
  expect(createAsset({ filePath: path.resolve('history.henji-code'), mediaType: 'code', source: 'imported' }).foreign).toBeUndefined()
  const external = createAsset({ filePath: path.resolve('shared.henji-code'), mediaType: 'code', source: 'imported' })
  expect(external.foreign).toMatchObject({ id: external.id, sourceType: 'code_asset' })
  expect(createAsset({ filePath: external.filePath, mediaType: 'code', source: 'video-edit' }).foreign).toEqual(external.foreign)
  expect(createAsset({ filePath: path.resolve('derived.henji-code'), mediaType: 'code', source: 'video-edit', foreign: external.foreign }).foreign).toEqual(external.foreign)
  expect(createAsset({ filePath: path.resolve('authored.henji-code'), mediaType: 'code', source: 'video-edit' }).foreign).toBeUndefined()
})

it('重新定位接受现有本地媒体引用，撤销可恢复失联项目原串，拒绝越界位置', async () => {
  catalog.removeProject(project.id)
  const replacement = path.resolve('relocated.png')
  await expect(relocateAsset('lost', `henji-media://local/${encodeURIComponent(replacement)}`)).resolves.toMatchObject({ filePath: replacement })
  await relocateAsset('lost', 'henji://project/project_1/materials/a.png')
  expect(fixture.db.prepare('SELECT file_path, inspection_status FROM assets WHERE id=?').get('lost')).toMatchObject({ file_path: 'henji://project/project_1/materials/a.png', inspection_status: 'missing' })
  await expect(relocateAsset('lost', 'henji://project/project_1/../escape.png')).rejects.toThrow()
  expect(fixture.db.prepare('SELECT file_path FROM assets WHERE id=?').get('lost')).toMatchObject({ file_path: 'henji://project/project_1/materials/a.png' })
})

it('未登记项目不会让整页查询或严格检查失败，也不向媒体消费者提供未解码串', async () => {
  fixture.db.prepare('DELETE FROM document_index_projects').run()
  const page = queryAssets({ page: 1, pageSize: 30 })
  expect(page.items.find(row => row.id === 'lost')).toMatchObject({ inspectionStatus: 'missing', filePath: 'henji://project/project_1/materials/a.png', displayUrl: '' })
  expect(page.items.find(row => row.id === 'normal')?.inspectionStatus).toBe('ready')
  expect(getAssetFilePath('lost')).toBeNull()
  await expect(inspectAsset('lost')).resolves.toMatchObject({ inspectionStatus: 'missing' })
  deleteAsset('lost')
  expect(queryAssets({ page: 1, pageSize: 30 }).total).toBe(1)
})

it('移除、扫描缺失与重建索引保留原串，项目重新登记后自动进入检查', () => {
  const stored = (): Record<string, unknown> => fixture.db.prepare('SELECT * FROM assets WHERE id=?').get('lost') as Record<string, unknown>
  for (const remove of [() => catalog.removeProject(project.id), () => catalog.upsertProject({ ...project, missing: true }), () => catalog.clearRebuildableIndex()]) {
    remove()
    expect(stored()).toMatchObject({ file_path: 'henji://project/project_1/materials/a.png', inspection_status: 'missing' })
    catalog.upsertProject(project)
    expect(stored()).toMatchObject({ file_path: 'henji://project/project_1/materials/a.png', inspection_status: 'pending', inspection_error: null })
    expect(queryAssets({ page: 1, pageSize: 30 }).items.find(row => row.id === 'lost')?.filePath).toMatch(/materials[\\/]a.png$/)
  }
})
