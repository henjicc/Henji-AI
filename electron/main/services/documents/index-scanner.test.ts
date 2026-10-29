import fsp from 'node:fs/promises'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { createTestEnvironment, silentLogger } from './documents.test-support'
import { createPackageAdapterRegistry } from './package-adapters'
import { createImageDocumentPackageAdapter } from '../image-editor-v3/image-document/package-adapter'

it.each(['ENOENT', 'ENOTDIR'])('扫描根缺失（%s）时标记文档缺失，可选目录未创建不告警', async code => {
  const logger = { ...silentLogger(), warn: vi.fn() }
  const env = createTestEnvironment({ logger })
  try {
    const { service, scanner } = env.services
    await service.createProject({ name: '可选素材目录' })
    const doc = await service.createDocument({ kind: 'canvas', name: '独立画布', container: { kind: 'user' } })
    const external = await service.createDocument({ kind: 'canvas', name: '外部画布', container: { kind: 'user' } })
    const externalPath = path.join(env.outside, path.basename(external.meta.path))
    await fsp.rename(external.meta.path, externalPath)
    await service.registerExternalDocument(externalPath)
    const root = path.dirname(doc.meta.path)
    await fsp.rm(root, { recursive: true })
    await fsp.rm(env.outside, { recursive: true })
    if (code === 'ENOTDIR') {
      await fsp.writeFile(root, '同名文件')
      await fsp.writeFile(env.outside, '同名文件')
    }
    await scanner.refresh()
    expect(env.catalog.getDocument(doc.meta.id)?.missing).toBe(true)
    expect(env.catalog.getDocument(external.meta.id)?.missing).toBe(true)
    expect(logger.warn).not.toHaveBeenCalled()
  } finally { await env.cleanup() }
})

it('外部另存位置只索引当前层，普通文档和目录不逐项调用 realpath', async () => {
  const env = createTestEnvironment()
  try {
    const { service, scanner } = env.services
    const created = await service.createDocument({ kind: 'canvas', name: '外部', container: { kind: 'user' } })
    const target = path.join(env.outside, '外部.hjcvs')
    const nested = path.join(env.outside, '子目录')
    await fsp.mkdir(nested)
    await fsp.rename(created.meta.path, target)
    const raw = JSON.parse(await fsp.readFile(target, 'utf8')) as Record<string, unknown>
    await fsp.writeFile(path.join(nested, '内部.hjcvs'), JSON.stringify({ ...raw, id: 'unregistered-nested' }))
    const realpath = vi.spyOn(fsp, 'realpath')
    await service.registerExternalDocument(target)
    await scanner.rebuild()
    expect(env.catalog.getDocument(created.meta.id)?.path).toBe(target)
    expect(env.catalog.getDocument('unregistered-nested')).toBeNull()
    expect(realpath).not.toHaveBeenCalled()
  } finally { vi.restoreAllMocks(); await env.cleanup() }
})

it('子目录无权限或链接无法解析时跳过并告警，保留已有索引并扫描其他文档', async () => {
  const logger = { ...silentLogger(), warn: vi.fn() }
  const env = createTestEnvironment({ logger })
  try {
    const { service, scanner } = env.services
    const project = await service.createProject({ name: '可访问部分' })
    const good = await service.createDocument({ kind: 'canvas', name: '正常', container: { kind: 'project', projectId: project.id } })
    const blocked = path.join(project.path, '受限目录')
    await fsp.mkdir(blocked)
    const raw = JSON.parse(await fsp.readFile(good.meta.path, 'utf8')) as Record<string, unknown>
    await fsp.writeFile(path.join(blocked, '已有.hjcvs'), JSON.stringify({ ...raw, id: 'blocked-document' }))
    await scanner.refresh()
    const dangling = path.join(project.path, '悬空链接')
    const mount = path.join(project.path, '挂载卷')
    await fsp.symlink(path.join(env.outside, '不存在'), dangling, process.platform === 'win32' ? 'junction' : 'dir')
    await fsp.symlink(env.outside, mount, process.platform === 'win32' ? 'junction' : 'dir')
    const readdir = fsp.readdir.bind(fsp)
    vi.spyOn(fsp, 'readdir').mockImplementation((target, ...args) => {
      if (String(target) === blocked) return Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
      return Reflect.apply(readdir, fsp, [target, ...args]) as ReturnType<typeof fsp.readdir>
    })
    const realpath = fsp.realpath.bind(fsp)
    vi.spyOn(fsp, 'realpath').mockImplementation(target => String(target) === mount
      ? Promise.reject(Object.assign(new Error('unresolved volume'), { code: 'UNKNOWN' }))
      : realpath(target))
    await scanner.rebuild()
    expect(env.catalog.getDocument(good.meta.id)?.missing).toBe(false)
    expect(env.catalog.getDocument('blocked-document')?.missing).toBe(false)
    for (const target of [blocked, dangling, mount]) {
      expect(logger.warn).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'documents.index.entry_skipped', context: { path: target } }))
    }
  } finally { vi.restoreAllMocks(); await env.cleanup() }
})

it('目录别名和交叠扫描根不改写原文档身份，保留已经索引的位置', async () => {
  const env = createTestEnvironment()
  try {
    const { service, scanner } = env.services
    const project = await service.createProject({ name: '别名项目' })
    const created = await service.createDocument({ kind: 'canvas', name: '分镜', container: { kind: 'project', projectId: project.id } })
    const folder = path.join(project.path, 'z-docs')
    await fsp.mkdir(folder)
    const target = path.join(folder, path.basename(created.meta.path))
    await fsp.rename(created.meta.path, target)
    await scanner.refresh()
    const alias = path.join(project.path, 'a-docs')
    await fsp.symlink(folder, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await service.registerExternalDocument(path.join(alias, path.basename(target)))
    await scanner.rebuild()
    expect(JSON.parse(await fsp.readFile(target, 'utf8')).id).toBe(created.meta.id)
    expect(env.catalog.listDocuments()).toHaveLength(1)
    expect(env.catalog.getDocument(created.meta.id)?.path).toBe(target)
  } finally { await env.cleanup() }
})

it('从项目外的目录别名首次打开外来文档时保留信任标记', async () => {
  const env = createTestEnvironment()
  try {
    const { service } = env.services
    const project = await service.createProject({ name: '本机项目' })
    const source = await service.createDocument({ kind: 'video_edit', name: '外来剪辑', container: { kind: 'user' } })
    const directory = path.join(project.path, 'z-docs')
    await fsp.mkdir(directory)
    const target = path.join(directory, path.basename(source.meta.path))
    await fsp.rename(source.meta.path, target)
    env.catalog.removeDocument(source.meta.id)
    const alias = path.join(env.outside, '文档别名')
    await fsp.symlink(directory, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const opened = await service.registerExternalDocument(path.join(alias, path.basename(target)))
    expect(opened.id).toBe(source.meta.id)
    expect(JSON.parse(await fsp.readFile(target, 'utf8')).content.foreign).toMatchObject({ sourceType: 'document_package' })
  } finally { await env.cleanup() }
})

it('不可读的版本、外壳、项目说明和图片包只计 invalid，正常文档仍入索引', async () => {
  const env = createTestEnvironment({ adapters: createPackageAdapterRegistry([createImageDocumentPackageAdapter()]) })
  try {
    const good = await env.services.service.createDocument({ kind: 'canvas', name: '正常', container: { kind: 'user' } })
    const raw = JSON.parse(await fsp.readFile(good.meta.path, 'utf8')) as Record<string, unknown>
    for (const [name, content] of Object.entries({ kind: { ...raw, kindVersion: 999, kindMinReaderVersion: 999 }, envelope: { ...raw, envelopeVersion: 999, minReaderVersion: 999 }, missing: {} })) {
      await fsp.writeFile(path.join(path.dirname(good.meta.path), `${name}.hjcvs`), JSON.stringify(content))
    }
    for (const version of [999, 'future']) {
      const project = await env.services.service.createProject({ name: `坏项目-${version}` })
      const file = path.join(project.path, '.henji', 'project.json')
      const manifest = JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, unknown>
      await fsp.writeFile(file, JSON.stringify({ ...manifest, version, minReaderVersion: version }))
    }
    await fsp.writeFile(path.join(path.dirname(good.meta.path), 'empty.hjimg'), '')
    await expect(env.services.scanner.rebuild()).resolves.toMatchObject({ invalid: 6, documents: 1 })
    expect(env.catalog.getDocument(good.meta.id)?.missing).toBe(false)
    await expect(env.services.scanner.refresh()).resolves.toMatchObject({ invalid: 6, documents: 1 })
  } finally { await env.cleanup() }
})

it('嵌套的无效项目说明不冒充普通目录，已索引旧副本不可读也不阻断新位置', async () => {
  const env = createTestEnvironment()
  try {
    const doc = await env.services.service.createDocument({ kind: 'canvas', name: '旧位置', container: { kind: 'user' } })
    const raw = await fsp.readFile(doc.meta.path, 'utf8')
    const folder = path.dirname(doc.meta.path)
    const moved = path.join(folder, '新位置.hjcvs')
    await fsp.writeFile(moved, raw)
    await fsp.writeFile(doc.meta.path, '{}')
    const nested = path.join(folder, '嵌套项目', '.henji')
    await fsp.mkdir(nested, { recursive: true })
    await fsp.writeFile(path.join(nested, 'project.json'), JSON.stringify({ version: 999 }))
    await expect(env.services.scanner.refresh()).resolves.toMatchObject({ invalid: 2, documents: 1, moved: 1 })
    expect(env.catalog.getDocument(doc.meta.id)?.path).toBe(moved)
  } finally { await env.cleanup() }
})

it('权限/I/O 故障保留原索引并拒绝扫描；只有确定不存在才标记缺失', async () => {
  const logger = { ...silentLogger(), info: vi.fn(), error: vi.fn() }
  const env = createTestEnvironment({ logger })
  try {
    const project = await env.services.service.createProject({ name: '保留' })
    const doc = await env.services.service.createDocument({ kind: 'canvas', name: '保留文档', container: { kind: 'project', projectId: project.id } })
    const before = { projects: env.catalog.listProjects(), documents: env.catalog.listDocuments() }
    const describe = env.services.workspace.describeProject.bind(env.services.workspace)
    vi.spyOn(env.services.workspace, 'describeProject').mockImplementationOnce(async (root, manifest) => {
      const row = await describe(root, manifest)
      // 项目更新已经暂存后才注入目录读取失败，验证失败不会留下半轮索引。
      vi.spyOn(fsp, 'readdir').mockRejectedValueOnce(Object.assign(new Error('access denied'), { code: 'EACCES' }))
      return { ...row, draft: !row.draft }
    })
    await expect(env.services.scanner.rebuild()).rejects.toThrow('原有索引已保留')
    vi.restoreAllMocks()
    expect({ projects: env.catalog.listProjects(), documents: env.catalog.listDocuments() }).toEqual(before)
    const stat = vi.spyOn(fsp, 'stat').mockRejectedValueOnce(Object.assign(new Error('I/O failure'), { code: 'EIO' }))
    await expect(env.services.scanner.refresh()).rejects.toThrow('访问权限')
    stat.mockRestore()
    expect({ projects: env.catalog.listProjects(), documents: env.catalog.listDocuments() }).toEqual(before)
    expect(logger.info.mock.calls.some(([, meta]) => meta.event === 'documents.index.scan.completed')).toBe(false)
    expect(logger.error).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ event: 'documents.index.scan.failed' }))
    await fsp.rm(doc.meta.path)
    await env.services.scanner.refresh()
    expect(env.catalog.getDocument(doc.meta.id)?.missing).toBe(true)
  } finally { vi.restoreAllMocks(); await env.cleanup() }
})

it('嵌套项目随父项目搬移后身份、文档与外部定位保持一致，重建不重复认领', async () => {
  const env = createTestEnvironment()
  try {
    const { service, scanner } = env.services
    const parent = await service.createProject({ name: '父项目' })
    const childPath = path.join(parent.path, '子项目')
    await fsp.mkdir(childPath)
    const child = await service.registerExternalProject(childPath)
    const document = await service.createDocument({ kind: 'canvas', container: { kind: 'project', projectId: child.id }, name: '分镜' })
    const moved = await service.renameProject({ projectId: parent.id, name: '改名父项目' })
    const destination = path.join(moved.path, '子项目')
    expect(env.catalog.getProject(child.id)?.path).toBe(destination)
    expect(env.catalog.listExternalLocations()).toContainEqual(expect.objectContaining({ path: destination, kind: 'project' }))
    expect((await service.readDocument({ id: document.meta.id })).meta).toMatchObject({ path: path.join(destination, '分镜.hjcvs'), container: { kind: 'project', projectId: child.id } })
    await scanner.rebuild()
    expect(env.catalog.listDocuments()).toHaveLength(1)
    expect(env.catalog.getDocument(document.meta.id)?.projectId).toBe(child.id)
  } finally { await env.cleanup() }
})
