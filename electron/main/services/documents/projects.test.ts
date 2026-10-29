import { PROJECT_MANIFEST_VERSION } from '../../../../src/core/documents/projectManifest'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestEnvironment, listFiles, type TestEnvironment } from './documents.test-support'

let env: TestEnvironment

async function manifestOf(root: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fsp.readFile(path.join(root, '.henji', 'project.json'), 'utf8')) as Record<string, unknown>
}

describe('项目：新建、改名、转正', () => {
  beforeEach(() => { env = createTestEnvironment() })
  afterEach(async () => { await env.cleanup() })

  it.each(['rename', 'finalize'] as const)('项目 %s 持锁且保存持文档锁等待时，刷新回退与迁移不会反向取锁或重入', async action => {
    const { service, workspace, scanner } = env.services
    const project = await service.createProject()
    const doc = await service.createDocument({ kind: 'canvas', name: '文档', container: { kind: 'project', projectId: project.id } })
    // 强制 requireProject 走正式 scanner.refresh 回退，覆盖项目锁内最深的分支。
    const indexed = env.catalog.getProject(project.id)!
    env.catalog.upsertProject({ ...indexed, path: path.join(env.workRoot, '过期位置') })
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    const original = workspace.withProjectMutation.bind(workspace)
    const lockSpy = vi.spyOn(workspace, 'withProjectMutation').mockImplementationOnce(
      <T>(id: string | null | undefined, operation: () => Promise<T>): Promise<T> => original(id, async () => {
        entered()
        await gate
        return operation()
      }),
    )
    const refreshSpy = vi.spyOn(scanner, 'refresh')
    const moving = action === 'rename'
      ? service.renameProject({ projectId: project.id, name: '新位置' })
      : service.finalizeProject({ projectId: project.id, name: '新位置', parentFolder: env.outside })
    await started
    const saving = service.saveDocument({ target: { id: doc.meta.id }, expectedRevision: 0, content: { latest: true } })
    try {
      await vi.waitFor(() => expect(lockSpy).toHaveBeenCalledTimes(2), { timeout: 1_000 })
      expect(fs.existsSync(path.join(env.programRoot, 'DocumentStore', 'locks', `${doc.meta.id}.lock`))).toBe(true)
    } finally { release() }
    try {
      const [moved] = await Promise.all([moving, saving])
      expect(refreshSpy).toHaveBeenCalledOnce()
      const read = await service.readDocument({ id: doc.meta.id })
      expect(read.content).toEqual({ latest: true })
      expect(read.meta.path).toBe(path.join(moved.path, '文档.hjcvs'))
      expect(fs.existsSync(project.path)).toBe(false)
    } finally { lockSpy.mockRestore(); refreshSpy.mockRestore() }
  }, 3_000)

  it.each(['rename', 'finalize'] as const)('保存定位后与项目 %s 交错：旧目录不重建，新位置保留最新内容', async action => {
    const { service, workspace } = env.services
    const project = await service.createProject()
    const doc = await service.createDocument({ kind: 'canvas', name: '文档', container: { kind: 'project', projectId: project.id } })
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let entered!: () => void
    const started = new Promise<void>(resolve => { entered = resolve })
    const original = workspace.containerForPath.bind(workspace)
    const spy = vi.spyOn(workspace, 'containerForPath').mockImplementationOnce(async file => {
      const container = await original(file)
      entered()
      await gate
      return container
    })
    const saving = service.saveDocument({ target: { id: doc.meta.id }, expectedRevision: 0, content: { latest: true } })
    await started
    const moving = action === 'rename'
      ? service.renameProject({ projectId: project.id, name: '新位置' })
      : service.finalizeProject({ projectId: project.id, name: '新位置' })
    try {
      await new Promise(resolve => setTimeout(resolve, 100))
    } finally { release() }
    const [, moved] = await Promise.all([saving, moving])
    spy.mockRestore()
    expect(fs.existsSync(project.path)).toBe(false)
    const read = await service.readDocument({ id: doc.meta.id })
    expect(read.content).toEqual({ latest: true })
    expect(read.meta.path).toBe(path.join(moved.path, '文档.hjcvs'))
  })

  it('新建项目以草稿建在“项目”里，自动名顺延，写入按语言命名子文件夹的项目说明', async () => {
    const { service } = env.services
    fs.mkdirSync(path.join(env.workRoot, '项目', '未命名项目 1'))
    const project = await service.createProject()
    expect(project).toMatchObject({ name: '未命名项目 2', draft: true, external: false, locale: 'zh', folders: { generated: '生成结果', materials: '素材' }, documentCount: 0 })
    expect(await manifestOf(project.path)).toMatchObject({ format: 'henji-project', version: PROJECT_MANIFEST_VERSION, id: project.id, locale: 'zh', draft: true })
    expect(await listFiles(project.path)).toEqual(['.henji/project.json'])
    expect((await service.listProjects()).map((item) => item.id)).toEqual([project.id])
  })

  it('英文作品目录建英文名项目；用户给的名字重名时报错，不加后缀', async () => {
    await env.cleanup()
    env = createTestEnvironment({ locale: 'en' })
    const { service } = env.services
    const untitled = await service.createProject()
    expect(untitled).toMatchObject({ name: 'Untitled Project 1', folders: { generated: 'Generated', materials: 'Media' } })
    const named = await service.createProject({ name: 'Trailer' })
    expect(named).toMatchObject({ name: 'Trailer', draft: false })
    await expect(service.createProject({ name: 'trailer.' })).rejects.toMatchObject({ name: 'DocumentNameConflictError' })
    await expect(service.createProject({ name: 'CON' })).rejects.toMatchObject({ name: 'DocumentNameInvalidError' })
  })

  it('改名就是改文件夹名：里面文档的位置随之更新、相对引用不用改写；重名报错；只改大小写可以', async () => {
    const { service } = env.services
    const project = await service.createProject({ name: '短片' })
    await service.createProject({ name: '已存在' })
    const doc = await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: project.id }, name: '分镜' })
    const media = path.join(project.path, '生成结果', 'a.png')
    fs.mkdirSync(path.dirname(media), { recursive: true })
    fs.writeFileSync(media, 'x')
    await service.saveDocument({ target: { id: doc.meta.id }, expectedRevision: 0, content: { media } })

    await expect(service.renameProject({ projectId: project.id, name: '已存在' })).rejects.toMatchObject({ name: 'DocumentNameConflictError' })
    const renamed = await service.renameProject({ projectId: project.id, name: '正片' })
    expect(renamed.path).toBe(path.join(env.workRoot, '项目', '正片'))
    expect(fs.existsSync(project.path)).toBe(false)
    const read = await service.readDocument({ id: doc.meta.id })
    expect(read.meta.path).toBe(path.join(renamed.path, '分镜.hjcvs'))
    expect(read.content).toEqual({ media: path.join(renamed.path, '生成结果', 'a.png') })
    const caseOnly = await service.renameProject({ projectId: project.id, name: 'ZHENG正片' })
    expect(caseOnly.name).toBe('ZHENG正片')
    expect((await service.renameProject({ projectId: project.id, name: 'zheng正片' })).name).toBe('zheng正片')
  })

  it('第一次保存：原地起名并去掉草稿标记', async () => {
    const { service } = env.services
    const draft = await service.createProject()
    const saved = await service.finalizeProject({ projectId: draft.id, name: '宣传片' })
    expect(saved).toMatchObject({ name: '宣传片', draft: false, external: false })
    expect(await manifestOf(saved.path)).not.toHaveProperty('draft')
  })

  it('第一次保存另选位置：整个项目文件夹移过去并登记为外部位置，文档跟着走', async () => {
    const { service } = env.services
    const draft = await service.createProject()
    const doc = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: draft.id } })
    const saved = await service.finalizeProject({ projectId: draft.id, name: '外部项目', parentFolder: env.outside })
    expect(saved).toMatchObject({ path: path.join(env.outside, '外部项目'), draft: false, external: true })
    expect(fs.existsSync(draft.path)).toBe(false)
    expect(env.catalog.listExternalLocations()).toEqual([expect.objectContaining({ path: saved.path, kind: 'project' })])
    const read = await service.readDocument({ id: doc.meta.id })
    expect(read.meta).toMatchObject({ path: path.join(saved.path, '未命名剪辑 1.hjvid'), container: { kind: 'project', projectId: draft.id } })
  })

  it('项目不能移动到自身内部，目标重名时原项目保留', async () => {
    const { service } = env.services
    const draft = await service.createProject()
    await expect(service.finalizeProject({ projectId: draft.id, name: 'x', parentFolder: path.join(draft.path, '子') })).rejects.toMatchObject({ name: 'DocumentLocationError' })
    fs.mkdirSync(path.join(env.outside, '占用'))
    await expect(service.finalizeProject({ projectId: draft.id, name: '占用', parentFolder: env.outside })).rejects.toMatchObject({ name: 'DocumentNameConflictError' })
    expect(fs.existsSync(draft.path)).toBe(true)
    expect((await manifestOf(draft.path)).draft).toBe(true)
  })
})

describe('项目：外部位置与回收站', () => {
  beforeEach(() => { env = createTestEnvironment() })
  afterEach(async () => { await env.cleanup() })

  it('打开作品目录之外的文件夹：没有项目说明的补写一份（按已有子文件夹推断语言）并登记', async () => {
    const { service } = env.services
    const folder = path.join(env.outside, 'Old Project')
    fs.mkdirSync(path.join(folder, 'Generated'), { recursive: true })
    const project = await service.registerExternalProject(folder)
    expect(project).toMatchObject({ name: 'Old Project', external: true, draft: false, locale: 'en', folders: { generated: 'Generated', materials: 'Media' } })
    expect(await manifestOf(folder)).toMatchObject({ id: project.id, locale: 'en' })
    expect(env.catalog.listExternalLocations().map((location) => location.kind)).toEqual(['project'])
    await expect(service.registerExternalProject(env.workRoot)).resolves.toMatchObject({ path: env.workRoot })
    await expect(service.registerExternalProject(path.join(folder, 'Generated'))).resolves.toMatchObject({ path: path.join(folder, 'Generated') })
  })

  it('打开拷贝出来的项目：与仍然存在的原项目同 ID 时换新 ID', async () => {
    const { service } = env.services
    const original = await service.createProject({ name: '原项目' })
    const copy = path.join(env.outside, '原项目 - 副本')
    await fsp.cp(original.path, copy, { recursive: true })
    const opened = await service.registerExternalProject(copy)
    expect(opened.id).not.toBe(original.id)
    expect((await manifestOf(copy)).id).toBe(opened.id)
    expect((await manifestOf(original.path)).id).toBe(original.id)
  })

  it('项目移到回收站：整个文件夹进回收站，索引与外部位置一并清理；忘记外部位置不动文件', async () => {
    const { service } = env.services
    const project = await service.createProject({ name: '要删的' })
    await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: project.id } })
    await service.trashProject(project.id)
    expect(env.trashed).toEqual([project.path])
    expect(await service.listProjects()).toEqual([])
    expect(await service.listDocuments()).toEqual([])

    const folder = path.join(env.outside, '外部')
    fs.mkdirSync(folder)
    const external = await service.registerExternalProject(folder)
    await service.forgetExternalLocation(folder)
    expect(env.catalog.getProject(external.id)).toBeNull()
    expect(env.catalog.listExternalLocations()).toEqual([])
    expect(fs.existsSync(path.join(folder, '.henji', 'project.json'))).toBe(true)
  })
})

describe('项目：主剪辑（3.1）', () => {
  beforeEach(() => { env = createTestEnvironment() })
  afterEach(async () => { await env.cleanup() })

  it('设置主剪辑写进项目说明，只能是本项目里的剪辑；清除后为空', async () => {
    const { service } = env.services
    const project = await service.createProject({ name: '短片' })
    const other = await service.createProject({ name: '别的' })
    const edit = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: project.id }, name: '短片' })
    const foreign = await service.createDocument({ kind: 'video_edit', container: { kind: 'project', projectId: other.id }, name: '别的' })
    const canvas = await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: project.id }, name: '画布' })
    const updated = await service.setProjectMainDocument({ projectId: project.id, documentId: edit.meta.id })
    expect(updated.mainVideoEditId).toBe(edit.meta.id)
    const manifest = JSON.parse(fs.readFileSync(path.join(project.path, '.henji', 'project.json'), 'utf8')) as Record<string, unknown>
    expect(manifest.mainVideoEditId).toBe(edit.meta.id)
    expect((await service.listProjects()).find((item) => item.id === project.id)?.mainVideoEditId).toBe(edit.meta.id)
    await expect(service.setProjectMainDocument({ projectId: project.id, documentId: foreign.meta.id })).rejects.toMatchObject({ name: 'DocumentLocationError' })
    await expect(service.setProjectMainDocument({ projectId: project.id, documentId: canvas.meta.id })).rejects.toMatchObject({ name: 'DocumentLocationError' })
    expect((await service.setProjectMainDocument({ projectId: project.id, documentId: null })).mainVideoEditId).toBeNull()
  })
})

describe('项目：新建与扫描并发（3.1 真实验收发现）', () => {
  beforeEach(() => { env = createTestEnvironment() })
  afterEach(async () => { await env.cleanup() })

  it('新建草稿项目时同时扫描：扫描不会把半建好的文件夹当成手动建的项目补写说明（ID 与草稿标记不变）', async () => {
    const { service } = env.services
    for (let round = 0; round < 8; round += 1) {
      const [project] = await Promise.all([service.createProject(), service.refreshIndex(), service.refreshIndex()])
      const manifest = await manifestOf(project.path)
      expect(manifest).toMatchObject({ id: project.id, draft: true })
      expect((await service.listProjects()).find((item) => item.id === project.id)?.draft).toBe(true)
    }
    expect(fs.readdirSync(path.join(env.workRoot, '项目')).some((name) => name.startsWith('.henji-new-'))).toBe(false)
  })
})
