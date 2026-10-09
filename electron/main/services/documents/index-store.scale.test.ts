import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createCountedSqlite } from './sqlite.test-support'
import { addDocumentIndexLastOpenedV1, createDocumentIndexSchemaV1 } from './index-schema'
import { DocumentIndexStore } from './index-store'

describe('作品索引游标分页', () => {
  let fixture: ReturnType<typeof createCountedSqlite>
  let store: DocumentIndexStore
  beforeEach(() => {
    fixture = createCountedSqlite()
    createDocumentIndexSchemaV1(fixture.db); addDocumentIndexLastOpenedV1(fixture.db)
    store = new DocumentIndexStore(fixture.db, process.platform === 'win32' ? 'win32' : 'posix')
    for (let index = 0; index < 237; index++) {
      const id = `id-${index.toString().padStart(4, '0')}`
      store.upsertProject({ id, path: path.resolve(path.sep, 'projects', id), name: index % 2 ? '同名' : 'a', locale: 'zh', folders: { generated: '生成', materials: '素材' }, draft: index % 7 === 0, mainVideoEditId: null, createdAt: index % 3, external: false, missing: index % 11 === 0, manifestModifiedAt: 1, manifestSize: 1, folderCreatedAt: 1 })
      store.upsertDocument({ id, kind: 'canvas', path: path.resolve(path.sep, 'docs', `${id}.henji-canvas`), name: index % 2 ? '同名' : 'a', projectId: id, draft: index % 7 === 0, revision: 0, kindVersion: 1, createdAt: 1, updatedAt: index % 3, fileModifiedAt: 1, fileSize: 1, fileCreatedAt: 1, summary: {}, missing: index % 11 === 0 })
    }
  })
  afterEach(() => fixture.native.close())

  it('同名、同时间按 ID 破平，文档与项目跨页完整且过滤和总数一致', () => {
    const filter = { includeDrafts: false, includeMissing: false }
    for (const list of [store.listDocumentsPage.bind(store), store.listProjectsPage.bind(store)]) {
      const ids: string[] = []
      let cursor: string | undefined
      let total = 0
      do {
        const page = list(filter, { cursor, pageSize: 17 })
        total = page.total
        ids.push(...page.items.map(row => row.id))
        cursor = page.nextCursor ?? undefined
      } while (cursor)
      expect(ids).toHaveLength(total)
      expect(new Set(ids).size).toBe(total)
      expect(new Set(ids)).toEqual(new Set(Array.from({ length: 237 }, (_, i) => i).filter(i => i % 7 && i % 11).map(i => `id-${i.toString().padStart(4, '0')}`)))
    }
    expect(store.listDocuments()).toHaveLength(237)
    expect(store.listProjects()).toHaveLength(237)
    expect(fixture.queries.filter(sql => /^SELECT \* FROM document_index_(documents|projects)/.test(sql)).every(sql => sql.includes('LIMIT'))).toBe(true)
  })

  it('游标锚点被删除仍能继续，项目数量按页内项目聚合', () => {
    const first = store.listDocumentsPage({}, { pageSize: 17 })
    store.removeDocument(first.items.at(-1)!.id)
    const second = store.listDocumentsPage({}, { pageSize: 17, cursor: first.nextCursor! })
    expect(second.items.every(row => !first.items.some(item => item.id === row.id))).toBe(true)
    const projects = store.listProjectsPage({}, { pageSize: 30 })
    fixture.queries.length = 0
    const counts = store.getProjectDocumentCounts(projects.items.map(row => row.id))
    expect(fixture.queries).toHaveLength(1)
    for (const project of projects.items) expect(counts.get(project.id) ?? 0).toBe(store.getDocument(project.id)?.missing === false ? 1 : 0)
    expect(() => store.listProjectsPage({}, { cursor: '{}' })).toThrow('列表位置无效')
  })
})
