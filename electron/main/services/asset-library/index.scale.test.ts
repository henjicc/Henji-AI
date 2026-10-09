import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createCountedSqlite } from '../documents/sqlite.test-support'

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }))
vi.mock('../db', () => ({ getDb: mocks.getDb }))
vi.mock('../db-locations', async () => ({ databaseLocations: (await import('../db-locations-identity.test-support')).identityDatabaseLocations }))
vi.mock('../appPaths', () => ({ getProgramStoreDir: () => '/program/thumbnails' }))
vi.mock('../../protocol', () => ({ allowMediaRoot: vi.fn() }))
vi.mock('../logging', () => ({ createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }))
import { createAssetLibraryTablesV1 } from './schema'
import { queryAssets, setAssetTags } from './index'

describe('素材列表规模与标签完整性', () => {
  let fixture: ReturnType<typeof createCountedSqlite>
  beforeEach(() => {
    fixture = createCountedSqlite()
    createAssetLibraryTablesV1(fixture.db)
    mocks.getDb.mockReturnValue(fixture.db)
    const insert = fixture.db.prepare("INSERT INTO assets(id,media_type,display_name,file_path,source,created_at,updated_at) VALUES (?,'image',?,?,'imported',1,1)")
    for (let index = 0; index < 1200; index++) insert.run(`a${index.toString().padStart(4, '0')}`, `素材${index}`, path.resolve(path.sep, 'media', `${index}.png`))
    fixture.db.prepare("INSERT INTO asset_libraries VALUES ('library','集合',1,1)").run()
    fixture.db.prepare("INSERT INTO asset_library_items(library_id,asset_id,added_at) VALUES ('library','a0000',1)").run()
    fixture.queries.length = 0
  })
  afterEach(() => fixture.native.close())

  it('1、30、48 行都是 4 次查询，大页按变量预算分批且所有关系完整', () => {
    setAssetTags('a0000', ['首标签'])
    for (const size of [1, 30, 48, 1200]) {
      fixture.queries.length = 0
      const page = queryAssets({ sort: 'created', page: 1, pageSize: size })
      expect(page.items).toHaveLength(size)
      expect(page.total).toBe(1200)
      expect(page.items[0]).toMatchObject({ id: 'a0000', tags: ['首标签'], libraryIds: ['library'] })
      expect(fixture.queries).toHaveLength(2 + 2 * Math.ceil(size / 999))
    }
  })

  it('65 个标签完整写入并从批量列表读回，空白与重复仍过滤', () => {
    const tags = Array.from({ length: 65 }, (_, index) => `标签${index}`)
    const written = setAssetTags('a0000', [...tags, '  ', ' 标签0 ', '标签0'])
    expect(new Set(written.tags)).toEqual(new Set(tags))
    const read = queryAssets({ sort: 'created', page: 1, pageSize: 30 }).items[0]
    expect(read.tags).toHaveLength(65)
    expect(new Set(read.tags)).toEqual(new Set(tags))
  })

  it('相同创建时间跨素材页无重无漏，空页不补关系查询', () => {
    const ids: string[] = []
    for (let page = 1; page <= 40; page++) ids.push(...queryAssets({ sort: 'created', page, pageSize: 30 }).items.map(row => row.id))
    expect(ids).toHaveLength(1200)
    expect(new Set(ids).size).toBe(1200)
    fixture.queries.length = 0
    expect(queryAssets({ sort: 'created', page: 41, pageSize: 30 }).items).toEqual([])
    expect(fixture.queries).toHaveLength(2)
  })
})
