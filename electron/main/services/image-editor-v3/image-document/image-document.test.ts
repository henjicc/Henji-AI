import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '../../../../../src/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '../../../../../src/core/imageEdit/v3/documentTypes'
import type { DocumentSummary } from '../../../../../src/core/documents/types'
import { openZip, iterateEntries, readEntryBytes } from '../../zip-archive'
import { createMainLogger } from '../../logging'
import type { ResourceId } from '../contracts'
import { ImageEditDocumentRepository } from '../document-repository'
import { HenjiImagePackageCodec } from '../package-codec'
import { ContentAddressedResourceStore } from '../resource-store'
import { HENJI_IMAGE_DOCUMENT_HEADER_ENTRY, HENJI_IMAGE_PACKAGE_MANIFEST } from '../package-types'
import { ImageDocumentService, type ImageDocumentOpenResult, type ImageDocumentRecoveryRequired } from './image-document-service'
import { createImageDocumentPackageAdapter } from './package-adapter'
import { readImageDocumentPackageHeader } from './package-file'
import { ImageDocumentWorkingCopyLinks } from './working-copy-links'

/*
 * 图片文档（3.5）主进程部分：单文件包适配器（读头、换 ID 改包内清单、改名不重写、旧包补头）、
 * 新建草稿、写回（原子、无变化不写、版本冲突与覆盖）、意外退出后的工作副本恢复、包里不出现程序目录路径。
 */

let root = ''
let programDir = ''
let workRoot = ''
let resources: ContentAddressedResourceStore
let documents: ImageEditDocumentRepository
let packages: HenjiImagePackageCodec
let service: ImageDocumentService
let refreshes = 0

async function listPackages(directory: string): Promise<string[]> {
  const found: string[] = []
  for (const entry of await fsp.readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(directory, entry.name)
    if (entry.isDirectory()) found.push(...await listPackages(full))
    else if (entry.name.toLowerCase().endsWith('.henjiimg')) found.push(full)
  }
  return found
}

/** 作品索引替身：每次列出都按磁盘上的包头现算（相当于随时扫描过）。 */
async function listDocuments(): Promise<DocumentSummary[]> {
  const rows: DocumentSummary[] = []
  for (const file of await listPackages(workRoot)) {
    const { header } = await readImageDocumentPackageHeader(file)
    rows.push({
      id: header.id, kind: 'image_document', name: path.basename(file, '.henjiimg'), path: file,
      container: { kind: 'user' }, draft: header.draft, revision: header.revision, kindVersion: header.kindVersion,
      createdAt: Date.parse(header.createdAt), updatedAt: Date.parse(header.updatedAt), projectName: null,
      external: false, missing: false, fileModifiedAt: 0, sizeBytes: 0, coverPath: null, summary: { ...header.summary }, lastOpenedAt: null,
    })
  }
  return rows
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-document-'))
  programDir = path.join(root, '程序目录', 'ImageEditorV3')
  workRoot = path.join(root, '文档', '痕迹AI')
  resources = new ContentAddressedResourceStore(path.join(programDir, 'resources'))
  documents = new ImageEditDocumentRepository(path.join(programDir, 'documents'))
  packages = new HenjiImagePackageCodec(resources)
  refreshes = 0
  service = new ImageDocumentService({
    documents,
    packages,
    links: new ImageDocumentWorkingCopyLinks(path.join(programDir, 'document-links')),
    catalog: {
      listDocuments,
      listProjects: async () => [],
      refreshIndex: async () => { refreshes += 1 },
      saveDocumentCover: async () => undefined,
      layout: () => ({ root: workRoot, locale: 'zh' }),
    },
    lockDirectory: path.join(root, '程序目录', 'DocumentStore', 'locks'),
    logger: createMainLogger('test.image_document'),
    validateDocument: () => undefined,
    resourceFilePath: (resourceId) => path.join(programDir, 'resources', resourceId),
    resourceMediaUrl: async () => null,
  })
})

afterEach(async () => {
  await fsp.rm(root, { recursive: true, force: true })
})

async function workingCopy(documentId: string, revision = 0): Promise<ResourceId> {
  const source = await resources.putBuffer(Buffer.from(`pixels of ${documentId}`), { mediaType: 'image/png' })
  const document: ImageEditDocumentV3 = {
    ...createImageEditDocumentV3({ width: 120, height: 80, documentId }),
    revision,
    layers: [createImageEditRasterLayerV3(`base-${documentId}`, '原图', source.id)],
  }
  await documents.create({ documentId, revision, document, resourceRefs: [source.id] })
  return source.id
}

/** 模拟编辑器把修改高频保存进工作副本（文档版本前进）。 */
async function editWorkingCopy(documentId: string): Promise<number> {
  const current = await documents.load(documentId)
  const body = current.document as ImageEditDocumentV3
  const next = current.revision + 1
  await documents.save({
    documentId,
    expectedRevision: current.revision,
    nextRevision: next,
    document: { ...body, revision: next, layers: [...body.layers, createImageEditRasterLayerV3(`layer-${next}`, `图层 ${next}`)] },
    resourceRefs: current.resourceRefs,
  })
  return next
}

async function readEntries(file: string): Promise<Map<string, Buffer>> {
  const archive = await openZip(file)
  const entries = new Map<string, Buffer>()
  try {
    for await (const entry of iterateEntries(archive)) entries.set(entry.fileName, await readEntryBytes(archive, entry, entry.fileName))
  } finally {
    archive.close()
  }
  return entries
}

function ready(result: ImageDocumentOpenResult | ImageDocumentRecoveryRequired): ImageDocumentOpenResult {
  if (result.status !== 'ready') throw new Error('expected ready')
  return result
}

it('同文档并发写回按顺序核对版本，只打包一次；无变化不打开资源流', async () => {
  await workingCopy('ordered-save')
  const created = await service.create({ documentId: 'ordered-save', container: { kind: 'user' }, emptyUntilRevision: null })
  await editWorkingCopy('ordered-save')
  const write = vi.spyOn(packages, 'writeStaged')
  const target = { id: 'ordered-save', path: created.read.meta.path }
  const results = await Promise.allSettled([
    service.commit({ target, expectedRevision: 0 }),
    service.commit({ target, expectedRevision: 0 }),
  ])
  expect(results[0].status).toBe('fulfilled')
  expect(results[1].status).toBe('rejected')
  expect(write).toHaveBeenCalledTimes(1)
  const open = vi.spyOn(resources, 'openVerifiedReadStream')
  expect((await service.commit({ target, expectedRevision: 1 })).unchanged).toBe(true)
  expect(open).not.toHaveBeenCalled()
  write.mockRestore()
  open.mockRestore()
})

it('暂存包完成后取消也不替换原文档，工作副本修改保留', async () => {
  await workingCopy('cancel-save')
  const created = await service.create({ documentId: 'cancel-save', container: { kind: 'user' }, emptyUntilRevision: null })
  await editWorkingCopy('cancel-save')
  const original = await fsp.readFile(created.read.meta.path)
  const controller = new AbortController()
  const writeStaged = packages.writeStaged.bind(packages)
  const write = vi.spyOn(packages, 'writeStaged').mockImplementation(async (request, stagedPath) => {
    const result = await writeStaged(request, stagedPath)
    controller.abort()
    return result
  })
  await expect(service.commit({ target: { id: 'cancel-save', path: created.read.meta.path }, expectedRevision: 0,
    signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(await fsp.readFile(created.read.meta.path)).toEqual(original)
  expect((await documents.load('cancel-save')).revision).toBe(1)
  expect((await fsp.readdir(path.dirname(created.read.meta.path))).filter((name) => name.endsWith('.tmp'))).toEqual([])
  write.mockRestore()
})

describe('图片文档新建与适配器', () => {
  it('新建草稿写进“图片文档/未命名图片 N.henjiimg”，头里有 ID、草稿标记与摘要；适配器能读', async () => {
    await workingCopy('doc-a')
    const created = await service.create({ documentId: 'doc-a', container: { kind: 'user' }, emptyUntilRevision: 0 })
    expect(created.read.meta).toMatchObject({ id: 'doc-a', kind: 'image_document', name: '未命名图片 1', draft: true, revision: 0 })
    expect(created.read.meta.path).toBe(path.join(workRoot, '图片文档', '未命名图片 1.henjiimg'))
    expect(created.read.content).toMatchObject({ workingRevision: 0, emptyUntilRevision: 0, width: 120, height: 80, layers: 1 })

    await workingCopy('doc-b')
    const second = await service.create({ documentId: 'doc-b', container: { kind: 'user' }, emptyUntilRevision: null })
    expect(second.read.meta.name).toBe('未命名图片 2')

    const adapter = createImageDocumentPackageAdapter()
    const header = await adapter.readHeader(created.read.meta.path)
    expect(header).toMatchObject({ id: 'doc-a', draft: true, revision: 0, summary: { width: 120, height: 80, layers: 1 } })
    expect(await adapter.isEmpty(created.read.meta.path)).toBe(true)
    expect(await adapter.isEmpty(second.read.meta.path)).toBe(false)
    // 程序目录文档列表据此去掉图片文档的工作副本，画布内嵌文档照常列出
    await workingCopy('canvas-embedded')
    expect(await service.isWorkingCopy('doc-a')).toBe(true)
    expect(await service.isWorkingCopy('canvas-embedded')).toBe(false)
  })

  it('换 ID（副本、扫描发现拷贝）时包头与包内清单的 V3 文档 ID 一起改；只改名不重写包', async () => {
    await workingCopy('doc-a')
    const created = await service.create({ documentId: 'doc-a', container: { kind: 'user' }, emptyUntilRevision: null })
    const file = created.read.meta.path
    const adapter = createImageDocumentPackageAdapter()

    const before = await fsp.stat(file)
    await adapter.writeHeader(file, { name: '改个名字', draft: true })
    expect((await fsp.stat(file)).mtimeMs).toBe(before.mtimeMs)

    const copy = path.join(path.dirname(file), '副本.henjiimg')
    await fsp.copyFile(file, copy)
    await adapter.writeHeader(copy, { id: 'doc-copy', draft: false })
    const entries = await readEntries(copy)
    const header = JSON.parse(entries.get(HENJI_IMAGE_DOCUMENT_HEADER_ENTRY)!.toString('utf8')) as { id: string; draft?: boolean }
    const manifest = JSON.parse(entries.get(HENJI_IMAGE_PACKAGE_MANIFEST)!.toString('utf8')) as { document: { documentId: string; document: { id: string } } }
    expect(header.id).toBe('doc-copy')
    expect(header.draft).toBeUndefined()
    expect(manifest.document.documentId).toBe('doc-copy')
    expect(manifest.document.document.id).toBe('doc-copy')
    // 原件不受影响，资源条目原样复制
    expect((await adapter.readHeader(file)).id).toBe('doc-a')
    expect([...entries.keys()].filter((name) => name.startsWith('resources/'))).toHaveLength(1)
  })

  it('改写包头失败时原文件保持原样，不留暂存文件', async () => {
    await workingCopy('doc-a')
    const created = await service.create({ documentId: 'doc-a', container: { kind: 'user' }, emptyUntilRevision: null })
    const broken = path.join(path.dirname(created.read.meta.path), '坏的.henjiimg')
    await fsp.writeFile(broken, 'not a zip')
    await expect(createImageDocumentPackageAdapter().writeHeader(broken, { draft: false })).rejects.toThrow()
    expect(await fsp.readFile(broken, 'utf8')).toBe('not a zip')
    expect((await fsp.readdir(path.dirname(broken))).filter((name) => name.endsWith('.tmp'))).toEqual([])
  })

  it('没有文档头的旧包：ID 由包内文档派生（不与画布内嵌文档冲突），写头后补上', async () => {
    await workingCopy('canvas-embedded')
    const legacy = path.join(workRoot, '图片文档', '旧包.henjiimg')
    await fsp.mkdir(path.dirname(legacy), { recursive: true })
    await packages.export({ targetPath: legacy, document: await documents.load('canvas-embedded') })
    const adapter = createImageDocumentPackageAdapter()
    const header = await adapter.readHeader(legacy)
    expect(header.id).toMatch(/^img-[a-f0-9]{32}$/)
    expect(header.id).not.toBe('canvas-embedded')
    expect((await adapter.readHeader(legacy)).id).toBe(header.id)

    const opened = ready(await service.open({ id: header.id, path: legacy }, 'ask'))
    expect(opened.working.documentRef).toBe(`image-edit-v3:${header.id}`)
    // 画布那份工作文档没有被覆盖
    expect((await documents.load('canvas-embedded')).documentId).toBe('canvas-embedded')

    await adapter.writeHeader(legacy, { draft: false })
    expect((await readImageDocumentPackageHeader(legacy)).legacy).toBe(false)
  })
})

describe('图片文档写回与恢复', () => {
  async function createSaved(id: string): Promise<{ path: string; revision: number }> {
    await workingCopy(id)
    const created = await service.create({ documentId: id, container: { kind: 'user' }, emptyUntilRevision: null })
    return { path: created.read.meta.path, revision: created.read.meta.revision }
  }

  it('写回原子替换文件、版本加一；工作副本没变时不写', async () => {
    const doc = await createSaved('doc-a')
    await editWorkingCopy('doc-a')
    const committed = await service.commit({ target: { id: 'doc-a', path: doc.path }, expectedRevision: doc.revision })
    expect(committed.unchanged).toBe(false)
    expect(committed.meta.revision).toBe(1)
    const header = (await readImageDocumentPackageHeader(doc.path)).header
    expect(header).toMatchObject({ revision: 1, contentRevision: 1, summary: { layers: 2 } })
    expect((await fsp.readdir(path.dirname(doc.path))).filter((name) => name.endsWith('.tmp'))).toEqual([])

    const before = await fsp.stat(doc.path)
    const again = await service.commit({ target: { id: 'doc-a', path: doc.path }, expectedRevision: 1 })
    expect(again.unchanged).toBe(true)
    expect((await fsp.stat(doc.path)).mtimeMs).toBe(before.mtimeMs)
  })

  it('文件在别处被换掉（版本不一致）时报冲突，选择覆盖后照写', async () => {
    const doc = await createSaved('doc-a')
    await editWorkingCopy('doc-a')
    await service.commit({ target: { id: 'doc-a', path: doc.path }, expectedRevision: 0 })
    await editWorkingCopy('doc-a')
    await expect(service.commit({ target: { id: 'doc-a', path: doc.path }, expectedRevision: 0 }))
      .rejects.toMatchObject({ name: 'DocumentRevisionConflictError' })
    const forced = await service.commit({ target: { id: 'doc-a', path: doc.path }, expectedRevision: 0, force: true })
    expect(forced.meta.revision).toBe(2)
  })

  it('文件被改名后按 ID 找到新位置写回', async () => {
    const doc = await createSaved('doc-a')
    const renamed = path.join(path.dirname(doc.path), '海报.henjiimg')
    await fsp.rename(doc.path, renamed)
    await editWorkingCopy('doc-a')
    const committed = await service.commit({ target: { id: 'doc-a', path: doc.path }, expectedRevision: 0 })
    expect(committed.meta).toMatchObject({ path: renamed, name: '海报', revision: 1 })
  })

  it('意外退出后工作副本比文件新：打开时先提示恢复；恢复用工作副本，放弃按文件重新解包', async () => {
    const doc = await createSaved('doc-a')
    await editWorkingCopy('doc-a')
    // 没有写回就“退出”了
    const asked = await service.open({ id: 'doc-a', path: doc.path }, 'ask')
    expect(asked.status).toBe('recovery')

    const restored = ready(await service.open({ id: 'doc-a', path: doc.path }, 'restore'))
    expect(restored.imported).toBe(false)
    expect(restored.working.revision).toBe(1)
    // 恢复后写回不报冲突
    const committed = await service.commit({ target: { id: 'doc-a', path: doc.path }, expectedRevision: restored.read.meta.revision })
    expect(committed.meta.revision).toBe(1)

    await editWorkingCopy('doc-a')
    const discarded = ready(await service.open({ id: 'doc-a', path: doc.path }, 'discard'))
    expect(discarded.imported).toBe(true)
    expect(discarded.working.revision).toBe(1)
    expect((await documents.load('doc-a')).revision).toBe(1)
    // 一致后再打开直接复用工作副本，不提示
    const reused = ready(await service.open({ id: 'doc-a', path: doc.path }, 'ask'))
    expect(reused.imported).toBe(false)
  })

  it('文件被换成别处拷来的同 ID 版本时按文件重新解包', async () => {
    const doc = await createSaved('doc-a')
    await editWorkingCopy('doc-a')
    await service.commit({ target: { id: 'doc-a', path: doc.path }, expectedRevision: 0 })
    const snapshot = await fsp.readFile(doc.path)
    await editWorkingCopy('doc-a')
    await service.commit({ target: { id: 'doc-a', path: doc.path }, expectedRevision: 1 })
    await fsp.writeFile(doc.path, snapshot)
    const reopened = ready(await service.open({ id: 'doc-a', path: doc.path }, 'ask'))
    expect(reopened.imported).toBe(true)
    expect(reopened.working.revision).toBe(1)
  })

  it('包里不出现程序目录路径', async () => {
    const doc = await createSaved('doc-a')
    await editWorkingCopy('doc-a')
    await service.commit({ target: { id: 'doc-a', path: doc.path }, expectedRevision: 0 })
    const entries = await readEntries(doc.path)
    const texts = [HENJI_IMAGE_PACKAGE_MANIFEST, HENJI_IMAGE_DOCUMENT_HEADER_ENTRY].map((name) => entries.get(name)!.toString('utf8'))
    for (const text of texts) {
      expect(text).not.toContain(root)
      expect(text).not.toContain(root.split(path.sep).join('/'))
      expect(text).not.toContain('henji-media://')
      expect(text).not.toContain('ImageEditorV3')
    }
    expect(refreshes).toBeGreaterThan(0)
  })
})

describe('工作副本回收（4.1）', () => {
  it('只回收与文件一致、本次运行没用过的图片文档工作副本；未写回的、画布内嵌的不动，回收后再打开按文件解包', async () => {
    for (const id of ['doc-a', 'doc-b', 'doc-c']) {
      await workingCopy(id)
      await service.create({ documentId: id, container: { kind: 'user' }, emptyUntilRevision: null })
    }
    await editWorkingCopy('doc-c')
    await workingCopy('canvas-embedded')
    // 新的一次运行：之前的打开记录不算数
    const restarted = new ImageDocumentService({
      documents,
      packages,
      links: new ImageDocumentWorkingCopyLinks(path.join(programDir, 'document-links')),
      catalog: { listDocuments, listProjects: async () => [], refreshIndex: async () => undefined, saveDocumentCover: async () => undefined, layout: () => ({ root: workRoot, locale: 'zh' }) },
      lockDirectory: path.join(root, '程序目录', 'DocumentStore', 'locks'),
      logger: createMainLogger('test.image_document'),
      validateDocument: () => undefined,
      resourceFilePath: (resourceId) => path.join(programDir, 'resources', resourceId),
      resourceMediaUrl: async () => null,
    })
    const docA = (await listDocuments()).find((row) => row.id === 'doc-a')!
    ready(await restarted.open({ id: 'doc-a', path: docA.path }, 'ask'))

    expect(await restarted.pruneWorkingCopies(0)).toBe(1)
    await expect(documents.load('doc-b')).rejects.toThrow()
    expect(await restarted.isWorkingCopy('doc-b')).toBe(false)
    expect((await documents.load('doc-a')).documentId).toBe('doc-a')
    expect((await documents.load('doc-c')).revision).toBe(1)
    expect((await documents.load('canvas-embedded')).documentId).toBe('canvas-embedded')

    const docB = (await listDocuments()).find((row) => row.id === 'doc-b')!
    const reopened = ready(await restarted.open({ id: 'doc-b', path: docB.path }, 'ask'))
    expect(reopened.imported).toBe(true)
    expect(await restarted.pruneWorkingCopies(0)).toBe(0)
  })
})
