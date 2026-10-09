import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  createImageEditDocumentV3,
  createImageEditRasterLayerV3,
} from '../../../../../src/core/imageEdit/v3/documentFactory'
import type { ImageEditDocumentV3 } from '../../../../../src/core/imageEdit/v3/documentTypes'
import type { DocumentContainerRef } from '../../../../../src/core/documents/types'
import { createMainLogger } from '../../logging'
import { ImageEditDocumentRepository } from '../document-repository'
import { HenjiImagePackageCodec } from '../package-codec'
import { ContentAddressedResourceStore } from '../resource-store'
import { CanvasLayerPackageService, forkedCanvasLayerDocumentId } from './canvas-layer-packages'

/*
 * 画布内嵌图片文档（3.4）：写回时打包进容器 `.henji/canvas-layers/`，没变不重写；
 * 移动后（包随画布复制）只更新记录；副本画布分出新文档；换机器（没有工作副本）按包解出。
 */

let root = ''
let programDir = ''
let resources: ContentAddressedResourceStore
let documents: ImageEditDocumentRepository
let service: CanvasLayerPackageService
/** 别的画布内容里提到的文档（测试里直接给出；null = 读别的画布失败）。 */
let otherCanvasRefs: Set<string> | null = new Set()

function containerRoot(container: DocumentContainerRef): string {
  return container.kind === 'user' ? path.join(root, '作品') : path.join(root, '项目', container.projectId)
}

function createService(): CanvasLayerPackageService {
  return new CanvasLayerPackageService({
    documents,
    packages: new HenjiImagePackageCodec(resources),
    linksDirectory: path.join(programDir, 'canvas-layer-links'),
    logger: createMainLogger('test.canvas_layers'),
    validateDocument: () => undefined,
    resolveInternalFolder: async (container) => {
      const folder = path.join(containerRoot(container), '.henji')
      await fsp.mkdir(folder, { recursive: true })
      return folder
    },
    referencedByOtherCanvases: async (_canvasId, documentIds) => {
      if (!otherCanvasRefs) throw new Error('读不了别的画布')
      return new Set(documentIds.filter((id) => otherCanvasRefs!.has(id)))
    },
  })
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-canvas-layers-'))
  programDir = path.join(root, '程序目录', 'ImageEditorV3')
  resources = new ContentAddressedResourceStore(path.join(programDir, 'resources'))
  documents = new ImageEditDocumentRepository(path.join(programDir, 'documents'))
  service = createService()
  otherCanvasRefs = new Set()
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fsp.rm(root, { recursive: true, force: true })
})

async function workingCopy(documentId: string): Promise<void> {
  const source = await resources.putBuffer(Buffer.from(`pixels of ${documentId}`), { mediaType: 'image/png' })
  const document: ImageEditDocumentV3 = {
    ...createImageEditDocumentV3({ width: 64, height: 48, documentId }),
    revision: 0,
    layers: [createImageEditRasterLayerV3(`base-${documentId}`, '原图', source.id)],
  }
  await documents.create({ documentId, revision: 0, document, resourceRefs: [source.id] })
}

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

/** 换一台机器：程序目录清空（工作副本、资源、记录都没有）。 */
async function freshMachine(): Promise<void> {
  await fsp.rm(programDir, { recursive: true, force: true })
  resources = new ContentAddressedResourceStore(path.join(programDir, 'resources'))
  documents = new ImageEditDocumentRepository(path.join(programDir, 'documents'))
  service = createService()
}

const user: DocumentContainerRef = { kind: 'user' }

it('同画布并发保存排队，第二次走未改动快速路径', async () => {
  await workingCopy('ordered-layer')
  const results = await Promise.all([
    service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['ordered-layer'] }),
    service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['ordered-layer'] }),
  ])
  expect(results.map((result) => result.written)).toEqual([1, 0])
})

it('画布暂存包完成后的取消保持原包与工作副本', async () => {
  await workingCopy('cancel-layer')
  const initial = await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['cancel-layer'] })
  const target = initial.packages['cancel-layer']
  const original = await fsp.readFile(target)
  await editWorkingCopy('cancel-layer')
  const controller = new AbortController()
  const writeStaged = HenjiImagePackageCodec.prototype.writeStaged
  vi.spyOn(HenjiImagePackageCodec.prototype, 'writeStaged').mockImplementation(async function (this: HenjiImagePackageCodec, request, stagedPath) {
    const result = await writeStaged.call(this, request, stagedPath)
    controller.abort()
    return result
  })
  await expect(service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['cancel-layer'], signal: controller.signal }))
    .rejects.toMatchObject({ name: 'AbortError' })
  expect(await fsp.readFile(target)).toEqual(original)
  expect((await documents.load('cancel-layer')).revision).toBe(1)
})

describe('画布内嵌图片文档的包', () => {
  it('写回：写进容器 .henji/canvas-layers/，工作副本没变时不重写，改了再写', async () => {
    await workingCopy('layer-a')
    const first = await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })
    const target = path.join(root, '作品', '.henji', 'canvas-layers', 'layer-a.henjilayer')
    expect(first).toEqual({ packages: { 'layer-a': target }, written: 1, released: 0 })
    expect(fs.existsSync(target)).toBe(true)

    const again = await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })
    expect(again.written).toBe(0)

    await editWorkingCopy('layer-a')
    expect((await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })).written).toBe(1)
    expect((await service.links.read('layer-a'))).toMatchObject({ ownerCanvasId: 'canvas-1', packagePath: target, committedWorkingRevision: 1 })
  })

  it('移进项目：包随画布复制过去、内容版本对得上时只更新记录，不重写', async () => {
    await workingCopy('layer-a')
    const { packages } = await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })
    const project: DocumentContainerRef = { kind: 'project', projectId: 'p1' }
    const moved = path.join(root, '项目', 'p1', '.henji', 'canvas-layers', 'layer-a.henjilayer')
    await fsp.mkdir(path.dirname(moved), { recursive: true })
    await fsp.copyFile(packages['layer-a'], moved)
    const before = (await fsp.stat(moved)).mtimeMs

    const result = await service.commit({ canvasId: 'canvas-1', container: project, documentIds: ['layer-a'] })
    expect(result).toEqual({ packages: { 'layer-a': moved }, written: 0, released: 0 })
    expect((await fsp.stat(moved)).mtimeMs).toBe(before)
    expect((await service.prepare({ canvasId: 'canvas-1', layers: [{ documentId: 'layer-a', packagePath: moved }] })).rewrites).toEqual({})
  })

  it('副本画布（创建副本、拷贝项目文件夹）：按包分出新文档，两边互不影响；重复准备得到同一份', async () => {
    await workingCopy('layer-a')
    const { packages } = await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })
    await editWorkingCopy('layer-a') // 原画布在包写出后又改了：副本按包（副本那一刻的样子）分出

    const prepared = await service.prepare({ canvasId: 'canvas-copy', layers: [{ documentId: 'layer-a', packagePath: packages['layer-a'] }] })
    const forkedId = forkedCanvasLayerDocumentId('canvas-copy', 'layer-a')
    expect(prepared).toEqual({ rewrites: { 'layer-a': forkedId }, missing: [] })
    const forked = await documents.load(forkedId)
    expect(forked.revision).toBe(0)
    expect((forked.document as ImageEditDocumentV3).id).toBe(forkedId)
    expect((await documents.load('layer-a')).revision).toBe(1)
    expect((await service.links.read(forkedId))?.ownerCanvasId).toBe('canvas-copy')

    const again = await service.prepare({ canvasId: 'canvas-copy', layers: [{ documentId: 'layer-a', packagePath: packages['layer-a'] }] })
    expect(again.rewrites).toEqual({ 'layer-a': forkedId })
    // 原画布照常使用自己的工作副本
    expect((await service.prepare({ canvasId: 'canvas-1', layers: [{ documentId: 'layer-a', packagePath: packages['layer-a'] }] })).rewrites).toEqual({})
  })

  it('副本画布找不到包时按工作副本分出', async () => {
    await workingCopy('layer-a')
    await service.prepare({ canvasId: 'canvas-1', layers: [{ documentId: 'layer-a' }] })
    const prepared = await service.prepare({ canvasId: 'canvas-copy', layers: [{ documentId: 'layer-a' }] })
    const forkedId = forkedCanvasLayerDocumentId('canvas-copy', 'layer-a')
    expect(prepared.rewrites).toEqual({ 'layer-a': forkedId })
    expect((await documents.load(forkedId)).documentId).toBe(forkedId)
  })

  it('换机器（没有工作副本）：按包解出同一个文档 ID；包也没有时报告缺失', async () => {
    await workingCopy('layer-a')
    await editWorkingCopy('layer-a')
    const { packages } = await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })
    await freshMachine()

    const prepared = await service.prepare({
      canvasId: 'canvas-1',
      layers: [{ documentId: 'layer-a', packagePath: packages['layer-a'] }, { documentId: 'layer-gone' }],
    })
    expect(prepared).toEqual({ rewrites: {}, missing: ['layer-gone'] })
    const restored = await documents.load('layer-a')
    expect(restored.revision).toBe(1)
    expect((restored.document as ImageEditDocumentV3).layers).toHaveLength(2)
    // 解出后再写回：内容没变，不重写
    expect((await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })).written).toBe(0)
  })

  it('包比工作副本新（别处改过）且本机没有未写出的修改：打开时按包更新工作副本', async () => {
    await workingCopy('layer-a')
    const { packages } = await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })
    const committed = await fsp.readFile(packages['layer-a'])
    // 在“另一台机器”上改了两次并写回，包同步回来
    await editWorkingCopy('layer-a')
    await editWorkingCopy('layer-a')
    await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })
    const newer = await fsp.readFile(packages['layer-a'])
    await documents.deleteIfRevision('layer-a', 2)
    await freshMachine()
    await fsp.writeFile(packages['layer-a'], committed)
    await service.prepare({ canvasId: 'canvas-1', layers: [{ documentId: 'layer-a', packagePath: packages['layer-a'] }] })
    expect((await documents.load('layer-a')).revision).toBe(0)
    await fsp.writeFile(packages['layer-a'], newer)

    await service.prepare({ canvasId: 'canvas-1', layers: [{ documentId: 'layer-a', packagePath: packages['layer-a'] }] })
    expect((await documents.load('layer-a')).revision).toBe(2)
  })

  it('删掉节点后写回：属于这份画布、撤销记录也不再提到、别的画布也没提到的文档连同包与工作副本清理', async () => {
    await workingCopy('layer-a')
    await workingCopy('layer-b')
    await workingCopy('layer-c')
    const { packages } = await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a', 'layer-b', 'layer-c'], retainedDocumentIds: ['layer-a', 'layer-b', 'layer-c'] })
    // 别的画布的文档不归这份画布管
    await workingCopy('layer-other')
    await service.commit({ canvasId: 'canvas-2', container: user, documentIds: ['layer-other'], retainedDocumentIds: ['layer-other'] })

    // 删了 b、c：b 还在撤销记录里，c 谁都不提
    const result = await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'], retainedDocumentIds: ['layer-a', 'layer-b'] })
    expect(result.released).toBe(1)
    expect(fs.existsSync(packages['layer-c'])).toBe(false)
    await expect(documents.load('layer-c')).rejects.toThrow()
    expect(await service.links.read('layer-c')).toBeNull()
    expect(fs.existsSync(packages['layer-b'])).toBe(true)
    expect((await documents.load('layer-b')).documentId).toBe('layer-b')
    expect((await documents.load('layer-other')).documentId).toBe('layer-other')

    // 撤销记录也清空（例如重新打开）、节点全删：最后的也清理
    expect((await service.commit({ canvasId: 'canvas-1', container: user, documentIds: [], retainedDocumentIds: [] })).released).toBe(2)
    expect(fs.existsSync(packages['layer-a'])).toBe(false)
    expect(fs.existsSync(packages['layer-b'])).toBe(false)
    expect((await documents.load('layer-other')).documentId).toBe('layer-other')
  })

  it('别的画布（如尚未打开的副本）还提到的保留；读不了别的画布时整次不清理；没带在用清单时不清理', async () => {
    await workingCopy('layer-a')
    const { packages } = await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })
    expect((await service.commit({ canvasId: 'canvas-1', container: user, documentIds: [] })).released).toBe(0)

    otherCanvasRefs = null
    expect((await service.commit({ canvasId: 'canvas-1', container: user, documentIds: [], retainedDocumentIds: [] })).released).toBe(0)
    otherCanvasRefs = new Set(['layer-a'])
    expect((await service.commit({ canvasId: 'canvas-1', container: user, documentIds: [], retainedDocumentIds: [] })).released).toBe(0)
    expect(fs.existsSync(packages['layer-a'])).toBe(true)
    expect((await documents.load('layer-a')).documentId).toBe('layer-a')

    // 同一批候选刚因别的画布在用而保留：短时间内的写回不再重复读全部画布
    otherCanvasRefs = new Set()
    expect((await service.commit({ canvasId: 'canvas-1', container: user, documentIds: [], retainedDocumentIds: [] })).released).toBe(0)
    expect(fs.existsSync(packages['layer-a'])).toBe(true)

    // 过一阵再核对：副本那边已分出自己的文档、不再提到原文档，原画布这次清理
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1000)
    expect((await service.commit({ canvasId: 'canvas-1', container: user, documentIds: [], retainedDocumentIds: [] })).released).toBe(1)
    expect(fs.existsSync(packages['layer-a'])).toBe(false)
  })

  it('工作副本在清理前又被改过（版本变了）：留着不删', async () => {
    await workingCopy('layer-a')
    await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })
    const deleteIfRevision = documents.deleteIfRevision.bind(documents)
    documents.deleteIfRevision = async (id, revision) => { await editWorkingCopy('layer-a'); return deleteIfRevision(id, revision) }
    expect((await service.commit({ canvasId: 'canvas-1', container: user, documentIds: [], retainedDocumentIds: [] })).released).toBe(0)
    expect((await documents.load('layer-a')).revision).toBe(1)
    expect((await service.links.read('layer-a'))?.ownerCanvasId).toBe('canvas-1')
  })

  it('记录归属索引：重启后（新服务实例）按目录重建，仍能找到这份画布的文档', async () => {
    await workingCopy('layer-a')
    const { packages } = await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })
    service = createService()
    expect((await service.commit({ canvasId: 'canvas-1', container: user, documentIds: [], retainedDocumentIds: [] })).released).toBe(1)
    expect(fs.existsSync(packages['layer-a'])).toBe(false)
  })
})
