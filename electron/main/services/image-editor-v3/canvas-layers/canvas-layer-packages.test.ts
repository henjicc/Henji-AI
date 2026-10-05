import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

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
  })
}

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-canvas-layers-'))
  programDir = path.join(root, '程序目录', 'ImageEditorV3')
  resources = new ContentAddressedResourceStore(path.join(programDir, 'resources'))
  documents = new ImageEditDocumentRepository(path.join(programDir, 'documents'))
  service = createService()
})

afterEach(async () => {
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

describe('画布内嵌图片文档的包', () => {
  it('写回：写进容器 .henji/canvas-layers/，工作副本没变时不重写，改了再写', async () => {
    await workingCopy('layer-a')
    const first = await service.commit({ canvasId: 'canvas-1', container: user, documentIds: ['layer-a'] })
    const target = path.join(root, '作品', '.henji', 'canvas-layers', 'layer-a.henjilayer')
    expect(first).toEqual({ packages: { 'layer-a': target }, written: 1 })
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
    expect(result).toEqual({ packages: { 'layer-a': moved }, written: 0 })
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
})
