import fsp from 'node:fs/promises'
import fs from 'node:fs'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import { createTestEnvironment, silentLogger } from './documents.test-support'
import { DocumentReadFailures } from './read-failures'

it('同一坏文件重复扫描只告警一次，大小或修改时间变化后重新读取，修复后恢复索引', async () => {
  const logger = { ...silentLogger(), warn: vi.fn() }
  const env = createTestEnvironment({ logger })
  try {
    const { service, scanner } = env.services
    const good = await service.createDocument({ kind: 'canvas', name: '正常', container: { kind: 'user' } })
    const raw = JSON.parse(await fsp.readFile(good.meta.path, 'utf8')) as Record<string, unknown>
    const bad = path.join(path.dirname(good.meta.path), '打不开.hjcvs')
    await fsp.writeFile(bad, '{')
    const reads = vi.spyOn(fs, 'createReadStream')
    const badReads = () => reads.mock.calls.filter(([target]) => String(target) === bad).length
    const warnings = () => logger.warn.mock.calls.filter(([, meta]) => meta?.event === 'documents.index.document_invalid')
    for (let i = 0; i < 3; i++) await expect(scanner.refresh()).resolves.toMatchObject({ invalid: 1, documents: 1 })
    expect(warnings()).toHaveLength(1)
    expect(badReads()).toBe(1)
    expect(warnings()[0][1]).toMatchObject({ context: { path: bad }, error: expect.any(Error) })
    expect(env.catalog.getDocumentByPath(bad)).toBeNull()
    await fsp.writeFile(bad, '{{')
    for (let i = 0; i < 2; i++) await scanner.refresh()
    expect(warnings()).toHaveLength(2)
    expect(badReads()).toBe(2)
    const stat = await fsp.stat(bad)
    await fsp.utimes(bad, stat.atime, new Date(stat.mtimeMs + 2000))
    await scanner.refresh()
    expect(warnings()).toHaveLength(3)
    expect(badReads()).toBe(3)
    await fsp.writeFile(bad, JSON.stringify({ ...raw, id: 'repaired' }))
    await scanner.refresh()
    expect(env.catalog.getDocument('repaired')).toMatchObject({ path: bad, missing: false })
  } finally { vi.restoreAllMocks(); await env.cleanup() }
})

it('项目说明读不出时重复扫描只告警一次，内容变化后重报，修复后恢复项目', async () => {
  const logger = { ...silentLogger(), warn: vi.fn() }
  const env = createTestEnvironment({ logger })
  try {
    const { service, scanner, workspace } = env.services
    const project = await service.createProject({ name: '说明坏了' })
    const file = workspace.manifestPath(project.path)
    const original = await fsp.readFile(file, 'utf8')
    await fsp.writeFile(file, '{')
    const warnings = () => logger.warn.mock.calls.filter(([, meta]) => meta?.event === 'documents.index.project_invalid')
    for (let i = 0; i < 3; i++) await expect(scanner.refresh()).resolves.toMatchObject({ invalid: 1 })
    expect(warnings()).toHaveLength(1)
    expect(warnings()[0][1]).toMatchObject({ context: { path: project.path }, error: expect.any(Error) })
    await fsp.writeFile(file, '{{')
    for (let i = 0; i < 2; i++) await scanner.refresh()
    expect(warnings()).toHaveLength(2)
    await fsp.writeFile(file, original)
    await expect(scanner.refresh()).resolves.toMatchObject({ invalid: 0 })
    expect(env.catalog.getProject(project.id)).toMatchObject({ path: project.path })
  } finally { await env.cleanup() }
})

it('项目里没有项目说明的普通子文件夹不进读取失败缓存', async () => {
  const env = createTestEnvironment()
  try {
    const { service, scanner } = env.services
    const project = await service.createProject({ name: '普通子文件夹' })
    const plain = path.join(project.path, '分镜')
    await fsp.mkdir(plain)
    const reads = vi.spyOn(DocumentReadFailures.prototype, 'read')
    await scanner.refresh()
    expect(reads.mock.calls.filter(([target]) => String(target).startsWith(plain))).toHaveLength(0)
    expect(reads.mock.calls.some(([target]) => String(target).startsWith(project.path))).toBe(true)
  } finally { vi.restoreAllMocks(); await env.cleanup() }
})

it.each(['json', 'version', 'content'])('内容读取失败（%s）重复调用仍拒绝但只报一次，变化后重报，修复后可读', async failure => {
  const logger = { ...silentLogger(), error: vi.fn(), warn: vi.fn() }
  const env = createTestEnvironment({ logger })
  try {
    const { service, scanner } = env.services
    const doc = await service.createDocument({ kind: 'canvas', name: '打不开', container: { kind: 'user' } })
    const original = await fsp.readFile(doc.meta.path, 'utf8')
    const broken = failure === 'json' ? '{' : JSON.stringify({ ...JSON.parse(original), ...(failure === 'version' ? { kindVersion: 0 } : { content: [] }) })
    await fsp.writeFile(doc.meta.path, broken)
    const failures = () => [...logger.error.mock.calls, ...logger.warn.mock.calls].filter(([, meta]) => meta?.event === 'documents.read.failed')
    for (let i = 0; i < 3; i++) {
      await scanner.refresh()
      await expect(service.readDocument({ id: doc.meta.id })).rejects.toBeInstanceOf(Error)
    }
    expect(failures()).toHaveLength(1)
    expect(failures()[0][1]).toMatchObject({ context: { documentId: doc.meta.id }, error: expect.any(Error) })
    expect(env.catalog.getDocument(doc.meta.id)?.missing).toBe(false)
    await fsp.writeFile(doc.meta.path, broken + ' ')
    await expect(service.readDocument({ id: doc.meta.id })).rejects.toBeInstanceOf(Error)
    expect(failures()).toHaveLength(2)
    await fsp.writeFile(doc.meta.path, original)
    await expect(service.readDocument({ id: doc.meta.id })).resolves.toMatchObject({ meta: { id: doc.meta.id } })
  } finally { await env.cleanup() }
})

it('内容失败缓存不阻断文档身份回退，也不把旧快照错误绑定到修复后的文件', async () => {
  const env = createTestEnvironment()
  try {
    const { service, workspace } = env.services
    const a = await service.createDocument({ kind: 'canvas', name: '坏内容', container: { kind: 'user' } })
    const b = await service.createDocument({ kind: 'canvas', name: '正常内容', container: { kind: 'user' } })
    const original = await fsp.readFile(a.meta.path, 'utf8')
    const broken = JSON.stringify({ ...JSON.parse(original), content: [] })
    await fsp.writeFile(a.meta.path, broken)
    await expect(service.readDocument({ id: a.meta.id })).rejects.toBeInstanceOf(Error)
    await expect(service.readDocument({ id: b.meta.id, path: a.meta.path })).resolves.toMatchObject({ meta: { id: b.meta.id } })
    await fsp.writeFile(a.meta.path, broken + ' ')
    const containerForPath = workspace.containerForPath.bind(workspace)
    vi.spyOn(workspace, 'containerForPath').mockImplementationOnce(async filePath => {
      await fsp.writeFile(a.meta.path, original)
      return containerForPath(filePath)
    })
    await expect(service.readDocument({ id: a.meta.id })).rejects.toBeInstanceOf(Error)
    await expect(service.readDocument({ id: a.meta.id })).resolves.toMatchObject({ meta: { id: a.meta.id } })
  } finally { vi.restoreAllMocks(); await env.cleanup() }
})
