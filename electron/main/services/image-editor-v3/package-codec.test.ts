import { ZipArchive } from 'archiver'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  IMAGE_EDIT_DOCUMENT_FORMAT,
  IMAGE_EDIT_DOCUMENT_VERSION,
  type ImageEditDocumentEnvelope,
  type ResourceId,
} from './contracts'
import { HenjiImagePackageCodec } from './package-codec'
import { importHenjiImagePackage } from './package-import'
import {
  HENJI_IMAGE_PACKAGE_FORMAT,
  HENJI_IMAGE_PACKAGE_VERSION,
  type HenjiImagePackageManifest,
} from './package-types'
import { ContentAddressedResourceStore } from './resource-store'

let rootDir = ''

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-image-v3-package-'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

function documentEnvelope(resourceId: ResourceId): ImageEditDocumentEnvelope {
  return {
    format: IMAGE_EDIT_DOCUMENT_FORMAT,
    formatVersion: IMAGE_EDIT_DOCUMENT_VERSION,
    documentId: 'package-document',
    revision: 7,
    createdAt: '2026-08-31T00:00:00.000Z',
    updatedAt: '2026-08-31T00:01:00.000Z',
    document: { layers: [{ type: 'raster', resourceId }] },
    resourceRefs: [resourceId],
    previewRef: resourceId,
  }
}

async function writeArchive(
  targetPath: string,
  files: { name: string; bytes: Uint8Array }[],
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(targetPath)
    const archive = new ZipArchive({ zlib: { level: 9 } })
    output.once('close', resolve)
    output.once('error', reject)
    archive.once('error', reject)
    archive.pipe(output)
    for (const file of files) archive.append(Buffer.from(file.bytes), { name: file.name })
    void archive.finalize().catch(reject)
  })
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function crc32(buffer: Buffer): number {
  let crc = 0xFFFFFFFF
  for (const byte of buffer) crc = (CRC_TABLE[(crc ^ byte) & 0xFF] ?? 0) ^ (crc >>> 8)
  return (crc ^ 0xFFFFFFFF) >>> 0
}

async function writeRawArchive(
  targetPath: string,
  files: { name: string; bytes: Uint8Array }[],
): Promise<void> {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const file of files) {
    const name = Buffer.from(file.name)
    const bytes = Buffer.from(file.bytes)
    const checksum = crc32(bytes)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034B50, 0)
    local.writeUInt16LE(10, 4)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(bytes.byteLength, 18)
    local.writeUInt32LE(bytes.byteLength, 22)
    local.writeUInt16LE(name.byteLength, 26)
    locals.push(local, name, bytes)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014B50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(10, 6)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(bytes.byteLength, 20)
    central.writeUInt32LE(bytes.byteLength, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.byteLength + name.byteLength + bytes.byteLength
  }
  const directory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(directory.byteLength, 12)
  end.writeUInt32LE(offset, 16)
  await fsp.writeFile(targetPath, Buffer.concat([...locals, directory, end]))
}

function corruptManifest(resourceId: ResourceId, byteLength: number): HenjiImagePackageManifest {
  const hash = resourceId.slice('sha256:'.length)
  return {
    packageFormat: HENJI_IMAGE_PACKAGE_FORMAT,
    packageVersion: HENJI_IMAGE_PACKAGE_VERSION,
    createdAt: '2026-08-31T00:00:00.000Z',
    document: documentEnvelope(resourceId),
    resources: [{
      resourceId,
      sha256: hash,
      byteLength,
      path: `resources/${hash}`,
    }],
  }
}

describe('.henjiimg package codec', () => {
  it('自包含往返文档、资源、缩略图和外链重连提示', async () => {
    const sourceStore = new ContentAddressedResourceStore(path.join(rootDir, 'source-store'))
    const source = await sourceStore.putBuffer(Buffer.from('authoritative pixels'), { mediaType: 'image/tiff' })
    const targetPath = path.join(rootDir, 'editable.henjiimg')
    const exporter = new HenjiImagePackageCodec(sourceStore)
    const exported = await exporter.export({
      targetPath,
      document: documentEnvelope(source.id),
      resources: [{ resourceId: source.id, mediaType: 'image/tiff' }],
      thumbnail: { bytes: Buffer.from('thumbnail'), extension: 'webp', mediaType: 'image/webp' },
      externalSources: [{
        sha256: crypto.createHash('sha256').update('external').digest('hex'),
        pathHint: '/Volumes/Photos/original.tif',
        relinkHint: 'original.tif',
      }],
    })
    expect(exported.resources).toHaveLength(1)

    const targetStore = new ContentAddressedResourceStore(path.join(rootDir, 'target-store'))
    const imported = await new HenjiImagePackageCodec(targetStore).import(targetPath)
    expect(imported.manifest.document).toEqual(documentEnvelope(source.id))
    expect(imported.manifest.externalSources?.[0]?.relinkHint).toBe('original.tif')
    expect(imported.thumbnail?.toString()).toBe('thumbnail')
    expect(await fsp.readFile(targetStore.getFilesystemPath(source.id), 'utf8'))
      .toBe('authoritative pixels')
  })

  it('高级外链包不嵌入原图，但保留内容指纹和重连信息', async () => {
    const sourceStore = new ContentAddressedResourceStore(path.join(rootDir, 'external-source-store'))
    const source = await sourceStore.putBuffer(Buffer.from('linked original'), { mediaType: 'image/tiff' })
    const envelope = { ...documentEnvelope(source.id), previewRef: undefined }
    const targetPath = path.join(rootDir, 'linked.henjiimg')
    const hash = source.id.slice('sha256:'.length)

    const exported = await new HenjiImagePackageCodec(sourceStore).export({
      targetPath,
      document: envelope,
      resources: [{ resourceId: source.id, mediaType: 'image/tiff' }],
      externalSources: [{ sha256: hash, byteLength: source.byteLength, relinkHint: 'original.tif' }],
    })
    expect(exported.resources).toEqual([])
    expect(exported.externalSources).toEqual([{
      sha256: hash,
      byteLength: source.byteLength,
      relinkHint: 'original.tif',
    }])

    const targetStore = new ContentAddressedResourceStore(path.join(rootDir, 'external-target-store'))
    const imported = await new HenjiImagePackageCodec(targetStore).import(targetPath)
    expect(imported.resources).toEqual([])
    expect(imported.manifest.document.resourceRefs).toEqual([source.id])
    expect(await targetStore.has(source.id)).toBe(false)
  })

  it('拒绝 zip-slip 且不会向包外落盘', async () => {
    const packagePath = path.join(rootDir, 'zip-slip.henjiimg')
    await writeRawArchive(packagePath, [{ name: '../escaped.txt', bytes: Buffer.from('owned') }])
    const store = new ContentAddressedResourceStore(path.join(rootDir, 'store'))

    await expect(importHenjiImagePackage({ sourcePath: packagePath, resourceStore: store }))
      .rejects.toThrow()
    await expect(fsp.access(path.join(rootDir, 'escaped.txt'))).rejects.toThrow()
  })

  it('拒绝压缩炸弹比例与资源哈希损坏', async () => {
    const store = new ContentAddressedResourceStore(path.join(rootDir, 'store'))
    const bombPath = path.join(rootDir, 'bomb.henjiimg')
    await writeArchive(bombPath, [
      { name: 'manifest.json', bytes: Buffer.from('{}') },
      { name: `resources/${'a'.repeat(64)}`, bytes: Buffer.alloc(128 * 1024, 65) },
    ])
    await expect(importHenjiImagePackage({
      sourcePath: bombPath,
      resourceStore: store,
      limits: { maxCompressionRatio: 2 },
    })).rejects.toThrow('compression ratio')

    const good = Buffer.from('good')
    const bad = Buffer.from('evil')
    const hash = crypto.createHash('sha256').update(good).digest('hex')
    const resourceId = `sha256:${hash}` as ResourceId
    const corruptPath = path.join(rootDir, 'corrupt.henjiimg')
    const manifest = corruptManifest(resourceId, bad.byteLength)
    await writeArchive(corruptPath, [
      { name: 'manifest.json', bytes: Buffer.from(JSON.stringify(manifest)) },
      { name: `resources/${hash}`, bytes: bad },
    ])
    await expect(importHenjiImagePackage({ sourcePath: corruptPath, resourceStore: store }))
      .rejects.toThrow('hash or size mismatch')
    expect(await store.has(resourceId)).toBe(false)
  })

  it('取消导出时清理临时包并保留原目标', async () => {
    const store = new ContentAddressedResourceStore(path.join(rootDir, 'store'))
    const source = await store.putBuffer(Buffer.from('pixels'))
    const targetPath = path.join(rootDir, 'cancelled.henjiimg')
    await fsp.writeFile(targetPath, 'old package')
    const controller = new AbortController()
    controller.abort()

    await expect(new HenjiImagePackageCodec(store).export({
      targetPath,
      document: documentEnvelope(source.id),
      signal: controller.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(await fsp.readFile(targetPath, 'utf8')).toBe('old package')
    const files = await fsp.readdir(rootDir)
    expect(files.filter((name) => name.includes('cancelled.henjiimg') && name.endsWith('.tmp'))).toEqual([])
  })
})
