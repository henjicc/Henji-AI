import fsp from 'node:fs/promises'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { createTestEnvironment, silentLogger } from './documents.test-support'
import { createPackageAdapterRegistry } from './package-adapters'
import { createImageDocumentPackageAdapter } from '../image-editor-v3/image-document/package-adapter'

it('不可读的版本、外壳、项目说明和图片包只计 invalid，正常文档仍入索引', async () => {
  const env = createTestEnvironment({ adapters: createPackageAdapterRegistry([createImageDocumentPackageAdapter()]) })
  try {
    const good = await env.services.service.createDocument({ kind: 'canvas', name: '正常', container: { kind: 'user' } })
    const raw = JSON.parse(await fsp.readFile(good.meta.path, 'utf8')) as Record<string, unknown>
    for (const [name, content] of Object.entries({ kind: { ...raw, kindVersion: 999, kindMinReaderVersion: 999 }, envelope: { ...raw, envelopeVersion: 999, minReaderVersion: 999 }, missing: {} })) {
      await fsp.writeFile(path.join(path.dirname(good.meta.path), `${name}.henji-canvas`), JSON.stringify(content))
    }
    for (const version of [999, 'future']) {
      const project = await env.services.service.createProject({ name: `坏项目-${version}` })
      const file = path.join(project.path, '.henji', 'project.json')
      const manifest = JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, unknown>
      await fsp.writeFile(file, JSON.stringify({ ...manifest, version, minReaderVersion: version }))
    }
    await fsp.writeFile(path.join(path.dirname(good.meta.path), 'empty.henjiimg'), '')
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
    const moved = path.join(folder, '新位置.henji-canvas')
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
