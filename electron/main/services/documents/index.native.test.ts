import Database from 'better-sqlite3'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { runSchemaMigrations, SCHEMA_MIGRATIONS, type SchemaMigration } from '../db-migrations'
import { createTestEnvironment, HOST_STYLE, type TestEnvironment } from './documents.test-support'
import { DocumentIndexStore } from './index-store'

describe.skipIf(!process.versions.electron)('代码文件与原生作品索引', () => {
  it('源码引用经 SQLite 文档索引存取、移动、复制与项目包往返仍可按 hash 读取', async () => {
    const db = new Database(':memory:'); runSchemaMigrations(db)
    const env = createTestEnvironment({ catalog: new DocumentIndexStore(db, HOST_STYLE) })
    try {
      const { service } = env.services
      const project = await service.createProject({ name: '源码项目' }); const container = { kind: 'project' as const, projectId: project.id }
      const created = await service.createDocument({ kind: 'video_edit', container, name: '源码剪辑' }); const target = { id: created.meta.id }
      const stored = await service.writeCodeVersion({ target, definitionId: 'code', name: '人名条', contents: { entry: 'main.ts', files: { 'main.ts': 'export default {}', 'parts/card.ts': 'export const value=1;' } } })
      const component = await service.publishCodeComponent({ target, name: '共享', source: 'export const width=16;', description: '', imports: [], exports: ['width'] })
      const content = { media: [], bins: [], items: [], sequences: [], codeMaterials: [{ id: 'code', folder: stored.folder, versions: [{ files: stored.files, imports: [{ name: component.name, version: component.version, hash: component.hash, location: component.location, imports: [] }] }] }] }
      await service.saveDocument({ target, expectedRevision: 0, content })
      expect(await fsp.readFile(created.meta.path, 'utf8')).toContain('henji:/代码/')
      const destination = await service.createProject({ name: '目标' })
      const copied = await service.duplicateDocument({ target, container: { kind: 'project', projectId: destination.id }, onConflict: 'keepBoth' }); expect(copied.copiedFiles).toBe(3)
      await service.moveDocument({ target, container: { kind: 'project', projectId: destination.id }, onConflict: 'keepBoth' })
      const moved = (await service.readDocument(target)).content as typeof content
      expect(await service.readCodeFile(moved.codeMaterials[0].versions[0].files[0])).toBe('export default {}')
      const archive = await service.exportProjectPackage({ projectId: destination.id, destination: path.join(env.outside, '代码包') })
      const imported = await service.importPackage({ source: archive.path }); expect(imported.type).toBe('project'); if (imported.type !== 'project') throw new Error('项目包导入结果类型错误')
      const importedDoc = (await service.listDocuments({ container: { kind: 'project', projectId: imported.project!.id } }))[0]
      const loaded = (await service.readDocument({ id: importedDoc.id })).content as typeof content
      expect(await service.readCodeFile(loaded.codeMaterials[0].versions[0].files[1])).toBe('export const value=1;')
      expect((await service.listCodeComponents({ id: importedDoc.id }))[0].name).toBe('共享')
    } finally { db.close(); await env.cleanup() }
  })
})

vi.mock('../logging/main-logger', () => ({
  createMainLogger: () => ({ trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}))

// 原生驱动使用 Electron ABI；登记在 scripts/lib/testSuites.cjs 的原生清单里，由 test:assistant-persistence 执行。
describe.skipIf(!process.versions.electron)('统一迁移账本', () => {
  it('首批迁移建立作品索引表并记账；重复执行不再迁移', () => {
    const db = new Database(':memory:')
    try {
      const all = SCHEMA_MIGRATIONS.map((migration) => migration.version)
      expect(runSchemaMigrations(db)).toEqual({ applied: all, currentVersion: all.length, backupPath: null })
      expect(runSchemaMigrations(db)).toEqual({ applied: [], currentVersion: all.length, backupPath: null })
      const tables = (db.prepare("SELECT name FROM sqlite_schema WHERE type='table' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name)
      expect(tables).toEqual(expect.arrayContaining(['document_external_locations', 'document_index_documents', 'document_index_projects', 'schema_migrations']))
      expect(db.prepare('SELECT version, name FROM schema_migrations WHERE version = 1').all()).toEqual([{ version: 1, name: 'document_index' }])
    } finally { db.close() }
  })

  it('追加迁移按顺序在各自事务里执行；失败整体回滚、账本不记；账本名称不一致拒绝；未知更高版本保留', () => {
    const db = new Database(':memory:')
    try {
      runSchemaMigrations(db)
      const next = SCHEMA_MIGRATIONS.length + 1
      const failing: SchemaMigration = { version: next, name: 'broken', up: (conn) => { conn.exec('CREATE TABLE half_done (id TEXT)'); throw new Error('boom') } }
      expect(() => runSchemaMigrations(db, [...SCHEMA_MIGRATIONS, failing])).toThrow('boom')
      expect(db.prepare("SELECT name FROM sqlite_schema WHERE name='half_done'").get()).toBeUndefined()
      expect(db.prepare('SELECT max(version) AS version FROM schema_migrations').get()).toEqual({ version: next - 1 })
      const second: SchemaMigration = { version: next, name: 'second', up: (conn) => conn.exec('CREATE TABLE second_table (id TEXT)') }
      expect(runSchemaMigrations(db, [...SCHEMA_MIGRATIONS, second]).applied).toEqual([next])
      expect(() => runSchemaMigrations(db, [...SCHEMA_MIGRATIONS, { ...second, name: 'renamed' }])).toThrow('迁移账本与程序不一致')
      expect(runSchemaMigrations(db).currentVersion).toBe(next)
      expect(() => runSchemaMigrations(db, [{ ...SCHEMA_MIGRATIONS[0], version: 2 }])).toThrow('连续递增')
    } finally { db.close() }
  })
})

describe.skipIf(!process.versions.electron)('作品索引（SQLite）与扫描', () => {
  let db: Database.Database
  let env: TestEnvironment

  beforeEach(() => {
    db = new Database(':memory:')
    runSchemaMigrations(db)
    env = createTestEnvironment({ catalog: new DocumentIndexStore(db, HOST_STYLE) })
  })

  afterEach(async () => {
    db.close()
    await env.cleanup()
  })

  it('索引行按 ID 写入、同一位置唯一；项目改名整体换位置；清空可重建部分时保留外部位置', async () => {
    const { service } = env.services
    const project = await service.createProject({ name: '短片' })
    const doc = await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: project.id }, name: '分镜' })
    const store = env.catalog
    expect(store.getDocumentByPath(doc.meta.path)?.id).toBe(doc.meta.id)
    if (HOST_STYLE === 'win32') expect(store.getDocumentByPath(doc.meta.path.toUpperCase())?.id).toBe(doc.meta.id)
    store.upsertDocument({ ...store.getDocument(doc.meta.id)!, id: 'replacement' })
    expect(store.getDocument(doc.meta.id)).toBeNull()
    expect(store.getDocumentByPath(doc.meta.path)?.id).toBe('replacement')
    store.rebaseDocuments(project.path, path.join(env.outside, '新位置'))
    expect(store.getDocument('replacement')?.path).toBe(path.join(env.outside, '新位置', '分镜.henji-canvas'))
    store.addExternalLocation(env.outside, 'folder')
    store.clearRebuildableIndex()
    expect(store.listDocuments()).toEqual([])
    expect(store.listProjects()).toEqual([])
    expect(store.listExternalLocations().map((location) => location.path)).toEqual([env.outside])
  })

  it('最近打开时间：记到文档与所在项目，扫描与改动写回索引行时保留，列表与项目摘要带出', async () => {
    const { service, scanner } = env.services
    const project = await service.createProject({ name: '短片' })
    const doc = await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: project.id }, name: '分镜' })
    const loose = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '独立' })
    expect((await service.listDocuments()).every((item) => item.lastOpenedAt === null)).toBe(true)
    expect((await service.listProjects())[0].lastOpenedAt).toBeNull()

    await service.markDocumentOpened(doc.meta.id)
    await service.markDocumentOpened('not-indexed')
    const opened = env.catalog.getDocument(doc.meta.id)?.lastOpenedAt
    expect(typeof opened).toBe('number')
    await service.saveDocument({ target: { id: doc.meta.id }, expectedRevision: 0, content: { ...(doc.content as object) } })
    await scanner.refresh()
    const listed = await service.listDocuments()
    expect(listed.find((item) => item.id === doc.meta.id)?.lastOpenedAt).toBe(opened)
    expect(listed.find((item) => item.id === loose.meta.id)?.lastOpenedAt).toBeNull()
    expect((await service.listProjects())[0]).toMatchObject({ id: project.id, lastOpenedAt: opened })
  })

  it('索引删光后扫描能恢复（外部位置保留）；没变的文件不重新读取', async () => {
    const { service, scanner } = env.services
    const project = await service.createProject({ name: '短片' })
    await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '正片' })
    await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '独立画布' })
    const outsideDoc = await service.createDocument({ kind: 'audio_edit', container: { kind: 'user' } })
    await service.finalizeDocument({ target: { id: outsideDoc.meta.id }, name: '外部口播', folder: env.outside })
    const before = (await service.listDocuments()).map((doc) => [doc.id, doc.path, doc.container]).sort()

    const rebuilding = scanner.rebuild()
    const rebuilt = await rebuilding
    expect(rebuilt).toMatchObject({ projects: 1, documents: 3, readDocuments: 3, reassignedIds: 0, invalid: 0 })
    expect((await service.listDocuments()).map((doc) => [doc.id, doc.path, doc.container]).sort()).toEqual(before)
    expect((await service.listProjects()).map((item) => item.id)).toEqual([project.id])

    const again = await scanner.refresh()
    expect(again).toMatchObject({ documents: 3, readDocuments: 0, moved: 0, missing: 0 })
  })

  it('增量：修改过的文件重新读取；资源管理器里改名视为移动（ID 不变）；删除的标缺失', async () => {
    const { service, scanner } = env.services
    const a = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '甲' })
    const b = await service.createDocument({ kind: 'canvas', container: { kind: 'user' }, name: '乙' })
    await scanner.refresh()

    const raw = JSON.parse(await fsp.readFile(a.meta.path, 'utf8')) as Record<string, unknown>
    await fsp.writeFile(a.meta.path, JSON.stringify({ ...raw, content: { changed: true } }))
    const movedPath = path.join(path.dirname(b.meta.path), '乙（改名）.henji-canvas')
    await fsp.rename(b.meta.path, movedPath)
    const report = await scanner.refresh()
    expect(report).toMatchObject({ readDocuments: 2, moved: 1, reassignedIds: 0 })
    expect(env.catalog.getDocument(b.meta.id)).toMatchObject({ path: movedPath, name: '乙（改名）', missing: false })

    await fsp.rm(a.meta.path)
    expect(await scanner.refresh()).toMatchObject({ missing: 1 })
    expect((await service.listDocuments({ includeMissing: false })).map((doc) => doc.id)).toEqual([b.meta.id])
    expect((await service.listDocuments()).find((doc) => doc.id === a.meta.id)?.missing).toBe(true)
  })

  it('拷贝出来的文档与原件同 ID：新发现的副本换新 ID 并写回文件头，原件不变', async () => {
    const { service, scanner } = env.services
    const original = await service.createDocument({ kind: 'camera_stage', container: { kind: 'user' }, name: '镜头' })
    await scanner.refresh()
    const copyPath = path.join(path.dirname(original.meta.path), '镜头 - 副本.henji-stage')
    await fsp.copyFile(original.meta.path, copyPath)
    const report = await scanner.refresh()
    expect(report.reassignedIds).toBe(1)
    const copyHeader = JSON.parse(await fsp.readFile(copyPath, 'utf8')) as { id: string }
    const originalHeader = JSON.parse(await fsp.readFile(original.meta.path, 'utf8')) as { id: string }
    expect(originalHeader.id).toBe(original.meta.id)
    expect(copyHeader.id).not.toBe(original.meta.id)
    expect(env.catalog.getDocument(copyHeader.id)?.path).toBe(copyPath)
    expect(env.catalog.getDocument(original.meta.id)?.path).toBe(original.meta.path)
    expect((await scanner.refresh()).reassignedIds).toBe(0)
  })

  it('拷贝整个项目文件夹：副本项目与其中文档都换新 ID，主剪辑指向副本自己的剪辑；相对引用指向副本自己的文件', async () => {
    const { service, scanner } = env.services
    const project = await service.createProject({ name: '原项目' })
    const edit = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '主剪辑' })
    const manifestPath = path.join(project.path, '.henji', 'project.json')
    const manifest = JSON.parse(await fsp.readFile(manifestPath, 'utf8')) as Record<string, unknown>
    await fsp.writeFile(manifestPath, JSON.stringify({ ...manifest, mainVideoEditId: edit.meta.id }))
    const media = path.join(project.path, '素材', 'clip.mp4')
    fs.mkdirSync(path.dirname(media), { recursive: true })
    fs.writeFileSync(media, 'x')
    // 3.1 起剪辑有真实内容 schema：在空内容上放一条引用素材的媒体
    const mediaItem = { id: 'clip', name: 'clip.mp4', path: media, kind: 'video', durationSeconds: 1, width: 16, height: 16 }
    await service.saveDocument({ target: { id: edit.meta.id }, expectedRevision: 0, content: { ...(edit.content as object), media: [mediaItem] } })
    await scanner.refresh()

    const copyRoot = path.join(env.workRoot, '项目', '原项目 - 副本')
    await fsp.cp(project.path, copyRoot, { recursive: true })
    const report = await scanner.refresh()
    expect(report.reassignedIds).toBe(2)
    const copyManifest = JSON.parse(await fsp.readFile(path.join(copyRoot, '.henji', 'project.json'), 'utf8')) as { id: string; mainVideoEditId: string }
    expect(copyManifest.id).not.toBe(project.id)
    const copyEdit = env.catalog.getDocumentByPath(path.join(copyRoot, '主剪辑.henji-video'))
    expect(copyEdit?.id).not.toBe(edit.meta.id)
    expect(copyManifest.mainVideoEditId).toBe(copyEdit?.id)
    expect(copyEdit?.projectId).toBe(copyManifest.id)
    const read = await service.readDocument({ id: copyEdit!.id })
    expect((read.content as { media: Array<{ path: string }> }).media[0].path).toBe(path.join(copyRoot, '素材', 'clip.mp4'))
  })

  it('扫描范围：项目里的自建子文件夹会扫描，生成结果 / 素材 / .henji 与嵌套项目不扫；没有说明的项目文件夹补写；损坏的文件跳过', async () => {
    const { service, scanner } = env.services
    const project = await service.createProject({ name: '项目甲' })
    const doc = await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: project.id }, name: '分镜' })
    const text = await fsp.readFile(doc.meta.path, 'utf8')
    const place = async (relative: string, id: string): Promise<string> => {
      const target = path.join(project.path, relative)
      fs.mkdirSync(path.dirname(target), { recursive: true })
      await fsp.writeFile(target, text.replace(doc.meta.id, id))
      return target
    }
    const inSubfolder = await place(path.join('整理', '分镜二.henji-canvas'), 'sub-doc')
    await place(path.join('生成结果', '不扫.henji-canvas'), 'generated-doc')
    await place(path.join('素材', '不扫.henji-canvas'), 'materials-doc')
    await place(path.join('.henji', '不扫.henji-canvas'), 'internal-doc')
    fs.writeFileSync(path.join(project.path, '坏的.henji-canvas'), '{')
    const plainFolder = path.join(env.workRoot, '项目', '手动建的')
    fs.mkdirSync(plainFolder)

    const report = await scanner.refresh()
    expect(report.invalid).toBe(1)
    expect(env.catalog.getDocument('sub-doc')).toMatchObject({ path: inSubfolder, projectId: project.id })
    for (const id of ['generated-doc', 'materials-doc', 'internal-doc']) expect(env.catalog.getDocument(id)).toBeNull()
    expect(fs.existsSync(path.join(plainFolder, '.henji', 'project.json'))).toBe(true)
    expect((await service.listProjects()).map((item) => item.name).sort()).toEqual(['手动建的', '项目甲'])
  })

  it('外部项目所在位置不在时标缺失，回来后恢复', async () => {
    const { service, scanner } = env.services
    const folder = path.join(env.outside, '移动硬盘上的项目')
    fs.mkdirSync(folder)
    const project = await service.registerExternalProject(folder)
    const doc = await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: project.id }, name: '画布' })
    await scanner.refresh()
    const parked = path.join(env.base, '拔掉的盘')
    await fsp.rename(folder, parked)
    await scanner.refresh()
    expect((await service.listProjects())[0]).toMatchObject({ id: project.id, missing: true })
    expect((await service.listDocuments())[0]).toMatchObject({ id: doc.meta.id, missing: true })
    await fsp.rename(parked, folder)
    await scanner.refresh()
    expect((await service.listProjects())[0]).toMatchObject({ id: project.id, missing: false })
    expect((await service.listDocuments())[0]).toMatchObject({ id: doc.meta.id, missing: false, projectName: '移动硬盘上的项目', external: true })
  })
})
