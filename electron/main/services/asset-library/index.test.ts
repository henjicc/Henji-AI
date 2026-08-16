import { beforeEach, describe, expect, it, vi } from 'vitest'

interface LibraryRow { id: string; name: string; created_at: number; updated_at: number }
interface ItemRow { library_id: string; asset_id: string; added_at: number }

class FakeAssetLibraryDb {
  readonly assets = new Set(['asset-1', 'asset-2'])
  readonly libraries = new Map<string, LibraryRow>()
  readonly items: ItemRow[] = []

  prepare(sql: string) {
    if (sql.startsWith('SELECT * FROM asset_libraries')) {
      return { get: (id: string) => this.libraries.get(id) }
    }
    if (sql.startsWith('SELECT asset_id FROM asset_library_items')) {
      return { all: (libraryId: string) => this.items.filter((item) => item.library_id === libraryId) }
    }
    if (sql.startsWith('DELETE FROM asset_libraries')) {
      return { run: (id: string) => {
        this.libraries.delete(id)
        for (let index = this.items.length - 1; index >= 0; index -= 1) {
          if (this.items[index]?.library_id === id) this.items.splice(index, 1)
        }
      } }
    }
    if (sql.startsWith('INSERT INTO asset_libraries')) {
      return { run: (id: string, name: string, createdAt: number, updatedAt: number) => {
        if (this.libraries.has(id)) throw new Error('UNIQUE constraint failed')
        for (const row of this.libraries.values()) {
          if (row.name === name) throw new Error('UNIQUE constraint failed: asset_libraries.name')
        }
        this.libraries.set(id, { id, name, created_at: createdAt, updated_at: updatedAt })
      } }
    }
    if (sql.startsWith('INSERT INTO asset_library_items')) {
      return { run: (libraryId: string, assetId: string, addedAt: number) => {
        if (!this.libraries.has(libraryId) || !this.assets.has(assetId)) throw new Error('FOREIGN KEY constraint failed')
        this.items.push({ library_id: libraryId, asset_id: assetId, added_at: addedAt })
      } }
    }
    throw new Error(`UNSUPPORTED_SQL:${sql}`)
  }

  transaction(operation: () => void) {
    return () => {
      const libraries = structuredClone([...this.libraries.entries()])
      const items = structuredClone(this.items)
      try {
        operation()
      } catch (error) {
        this.libraries.clear()
        for (const [id, row] of libraries) this.libraries.set(id, row)
        this.items.splice(0, this.items.length, ...items)
        throw error
      }
    }
  }
}

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }))

vi.mock('../db', () => ({ getDb: mocks.getDb }))
vi.mock('../../protocol', () => ({ allowMediaRoot: vi.fn() }))
vi.mock('../logging', () => ({
  createMainLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

import { createLibrary, deleteLibrary, inspectLibrary, restoreLibrary } from './index'

describe('素材集合快照恢复', () => {
  let database: FakeAssetLibraryDb

  beforeEach(() => {
    database = new FakeAssetLibraryDb()
    database.libraries.set('library-1', {
      id: 'library-1', name: '原集合', created_at: 10, updated_at: 20,
    })
    database.items.push(
      { library_id: 'library-1', asset_id: 'asset-1', added_at: 20 },
      { library_id: 'library-1', asset_id: 'asset-2', added_at: 20 },
    )
    mocks.getDb.mockReturnValue(database)
  })

  it('删除后按原稳定 ID、时间与成员关系恢复', () => {
    const snapshot = inspectLibrary('library-1')
    deleteLibrary('library-1')
    expect(() => inspectLibrary('library-1')).toThrow('资产库不存在')

    restoreLibrary(snapshot)
    expect(inspectLibrary('library-1')).toEqual(snapshot)
  })

  it('成员缺失时事务整体失败，不留下半个集合', () => {
    deleteLibrary('library-1')
    expect(() => restoreLibrary({
      id: 'library-1', name: '原集合', createdAt: 10, updatedAt: 20,
      assetIds: ['asset-missing'],
    })).toThrow('FOREIGN KEY')
    expect(() => inspectLibrary('library-1')).toThrow('资产库不存在')
  })
})

/*
 * 名称冲突要翻译成人话：`UNIQUE constraint failed: asset_libraries.name` 对调用方等于没有信息，
 * 它既不知道哪个字段冲突（name 是列名不是属性 ID），也不知道该改名还是改用已存在的那个。
 * 实测助手连撞两次，每次都原样重试同一个名称。
 */
describe('素材集合名称冲突', () => {
  beforeEach(() => {
    const db = new FakeAssetLibraryDb()
    mocks.getDb.mockReturnValue(db)
  })

  it('重名时给出被占用的名称和两条可行出路，不泄露 SQL 原文', () => {
    createLibrary('验收素材库')
    let message = ''
    try {
      createLibrary('验收素材库')
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    expect(message).toContain('验收素材库')
    expect(message).toContain('已被占用')
    expect(message).not.toContain('UNIQUE constraint')
  })
})

