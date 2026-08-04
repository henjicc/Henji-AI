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

import { deleteLibrary, inspectLibrary, restoreLibrary } from './index'

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
