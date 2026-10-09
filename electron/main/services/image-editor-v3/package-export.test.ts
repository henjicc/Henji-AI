import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3 } from '../../../../src/core/imageEdit/v3/documentFactory'
import { ImageEditDocumentRepository } from './document-repository'
import { ContentAddressedResourceStore } from './resource-store'
import { HenjiImagePackageCodec } from './package-codec'

let root: string
let resources: ContentAddressedResourceStore
let packages: HenjiImagePackageCodec

beforeEach(async () => {
  root = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-package-save-'))
  resources = new ContentAddressedResourceStore(path.join(root, 'resources'))
  packages = new HenjiImagePackageCodec(resources)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await fsp.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
})

async function sample() {
  const a = await resources.putBuffer(Buffer.alloc(128 * 1024, 42))
  const b = await resources.putBuffer(Buffer.alloc(128 * 1024, 77))
  const repository = new ImageEditDocumentRepository(path.join(root, 'documents'))
  const document = createImageEditDocumentV3({ documentId: 'save', width: 512, height: 512, sourceResourceId: a.id })
  return repository.create({ documentId: document.id, document, resourceRefs: [a.id, b.id] })
}

it('streams one unique resource at a time and reopens unchanged pixel bytes', async () => {
  const document = await sample()
  const open = resources.openVerifiedReadStream.bind(resources)
  let active = 0
  let peak = 0
  vi.spyOn(resources, 'openVerifiedReadStream').mockImplementation((id) => {
    const stream = open(id)
    peak = Math.max(peak, ++active)
    stream.once('end', () => { active -= 1 })
    return stream
  })
  const onProgress = vi.fn()
  const targetPath = path.join(root, 'saved.henjiimg')
  await packages.export({ targetPath, document, resources: document.resourceRefs.map((resourceId) => ({ resourceId })), onProgress })
  expect(peak).toBe(1)
  expect(onProgress.mock.calls).toEqual([[1, 2], [2, 2]])
  const reopened = await packages.import(targetPath)
  expect(reopened.manifest.resources).toHaveLength(2)
  for (const id of document.resourceRefs) expect(await resources.readVerifiedBuffer(id, 256 * 1024)).toHaveLength(128 * 1024)
})

it('cancel after the last resource preserves the original file and removes staging', async () => {
  const document = await sample()
  const targetPath = path.join(root, 'saved.henjiimg')
  await fsp.writeFile(targetPath, 'original')
  const controller = new AbortController()
  await expect(packages.export({ targetPath, document, signal: controller.signal,
    onProgress: (completed, total) => { if (completed === total) controller.abort() },
  })).rejects.toMatchObject({ name: 'AbortError' })
  expect(await fsp.readFile(targetPath, 'utf8')).toBe('original')
  expect((await fsp.readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
})

it('corrupt resource rejects promptly and cannot publish a partial package', async () => {
  const document = await sample()
  await fsp.writeFile(resources.getFilesystemPath(document.resourceRefs[0]), Buffer.alloc(128 * 1024, 1))
  const targetPath = path.join(root, 'saved.henjiimg')
  await fsp.writeFile(targetPath, 'original')
  await expect(packages.export({ targetPath, document })).rejects.toThrow('Corrupt resource')
  expect(await fsp.readFile(targetPath, 'utf8')).toBe('original')
  expect((await fsp.readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
})

it('cancel during streaming closes the resource file handle and preserves the original', async () => {
  const document = await sample()
  const targetPath = path.join(root, 'saved.henjiimg')
  await fsp.writeFile(targetPath, 'original')
  const controller = new AbortController()
  const open = resources.openReadStream.bind(resources)
  let closed = Promise.resolve()
  vi.spyOn(resources, 'openReadStream').mockImplementation((id) => {
    const source = open(id)
    closed = new Promise<void>((resolve) => { source.once('close', resolve) })
    source.once('data', () => { controller.abort() })
    return source
  })
  await expect(packages.export({ targetPath, document, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  await closed
  expect(await fsp.readFile(targetPath, 'utf8')).toBe('original')
})

it('concurrent exports to the same path publish in request order', async () => {
  const document = await sample()
  const targetPath = path.join(root, 'saved.henjiimg')
  const order: string[] = []
  await Promise.all([
    packages.export({ targetPath, document, onProgress: () => { order.push('first') } }),
    packages.export({ targetPath, document: { ...document, previewRef: document.resourceRefs[1] }, onProgress: () => { order.push('second') } }),
  ])
  expect(order).toEqual(['first', 'first', 'second', 'second'])
  expect((await packages.import(targetPath)).manifest.document.previewRef).toBe(document.resourceRefs[1])
})
