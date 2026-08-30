import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inflateSync } from 'node:zlib'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadSharp } from '../../image/sharp-loader'
import type { ResourceId, TileOutputDescription } from '../contracts'
import { BigTiffTileOutputSink } from './bigtiff-output-sink'
import { planBigTiff } from './bigtiff-layout'
import { IncrementalBigTiffWriter } from './bigtiff-writer'
import { ImageExportCapabilityError } from './capabilities'

interface ParsedTag {
  type: number
  count: number
  data: Buffer
}

function typeSize(type: number): number {
  if (type === 3) return 2
  if (type === 4) return 4
  if (type === 16) return 8
  return 1
}

function parseTags(file: Buffer): Map<number, ParsedTag> {
  const ifdOffset = Number(file.readBigUInt64LE(8))
  const count = Number(file.readBigUInt64LE(ifdOffset))
  const tags = new Map<number, ParsedTag>()
  for (let index = 0; index < count; index += 1) {
    const entryOffset = ifdOffset + 8 + index * 20
    const tag = file.readUInt16LE(entryOffset)
    const type = file.readUInt16LE(entryOffset + 2)
    const valueCount = Number(file.readBigUInt64LE(entryOffset + 4))
    const byteLength = valueCount * typeSize(type)
    const dataOffset = byteLength <= 8
      ? entryOffset + 12
      : Number(file.readBigUInt64LE(entryOffset + 12))
    tags.set(tag, { type, count: valueCount, data: file.subarray(dataOffset, dataOffset + byteLength) })
  }
  return tags
}

function uint64Values(tag: ParsedTag): number[] {
  return Array.from(
    { length: tag.count },
    (_, index) => Number(tag.data.readBigUInt64LE(index * 8)),
  )
}

function createIccProfile(): Buffer {
  const profile = Buffer.alloc(128)
  profile.writeUInt32BE(profile.byteLength, 0)
  profile.write('RGB ', 16, 'ascii')
  profile.write('acsp', 36, 'ascii')
  return profile
}

const baseDescription: TileOutputDescription = {
  width: 2,
  height: 1,
  channels: 4,
  bitDepth: 16,
  sampleFormat: 'uint',
  colorSpace: 'srgb',
  transferFunction: 'srgb',
  alphaMode: 'straight',
  documentId: 'document-v3',
  revision: 7,
  sourceFingerprint: 'sha256:source',
}

let rootDir = ''

beforeEach(async () => {
  rootDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-v3-bigtiff-'))
})

afterEach(async () => {
  await fsp.rm(rootDir, { recursive: true, force: true })
})

describe('BigTiffTileOutputSink', () => {
  it('写入规范 BigTIFF 头、颜色描述、alpha 与 ICC 标签', async () => {
    const targetPath = path.join(rootDir, 'metadata.tif')
    const profile = createIccProfile()
    const profileId = `sha256:${'a'.repeat(64)}` as ResourceId
    const sink = new BigTiffTileOutputSink(targetPath, {
      tileSize: 16,
      inputByteOrder: 'little-endian',
      resolveIccProfile: async () => profile,
    })
    await sink.begin({ ...baseDescription, iccProfileResourceId: profileId })
    await sink.writeTile({
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      rowStride: 16,
      pixels: new Uint8Array(16),
    })
    await sink.complete()

    const file = await fsp.readFile(targetPath)
    expect(file.toString('ascii', 0, 2)).toBe('II')
    expect(file.readUInt16LE(2)).toBe(43)
    expect(file.readUInt16LE(4)).toBe(8)
    expect(file.readUInt16LE(6)).toBe(0)
    const tags = parseTags(file)
    expect(tags.get(258)?.data).toEqual(Buffer.from([16, 0, 16, 0, 16, 0, 16, 0]))
    expect(tags.get(338)?.data.readUInt16LE()).toBe(2)
    expect(tags.get(339)?.data).toEqual(Buffer.from([1, 0, 1, 0, 1, 0, 1, 0]))
    expect(tags.get(34675)?.data).toEqual(profile)
    expect(tags.get(270)?.data.toString('utf8')).toContain('"sourceFingerprint":"sha256:source"')
  })

  it.each([
    {
      name: '16-bit uint',
      description: baseDescription,
      pixels: Buffer.from([0x34, 0x12, 0xff, 0xab, 0x00, 0x80, 0x01, 0x00, 0xfe, 0xca, 0x11, 0x11, 0x22, 0x22, 0xff, 0xff]),
    },
    {
      name: '32-bit float',
      description: {
        ...baseDescription,
        bitDepth: 32 as const,
        sampleFormat: 'float' as const,
        transferFunction: 'linear' as const,
      },
      pixels: (() => {
        const values = new Float32Array([0.125, -2.5, 4.75, 1, Number.NaN, 0.5, 1000, 0])
        return Buffer.from(values.buffer)
      })(),
    },
  ])('不量化 $name 瓦片字节', async ({ description, pixels }) => {
    const targetPath = path.join(rootDir, `${description.bitDepth}.tif`)
    const sink = new BigTiffTileOutputSink(targetPath, {
      tileSize: 16,
      inputByteOrder: 'little-endian',
    })
    await sink.begin(description)
    await sink.writeTile({
      x: 0,
      y: 0,
      width: 2,
      height: 1,
      rowStride: pixels.byteLength,
      pixels,
    })
    await sink.complete()

    const file = await fsp.readFile(targetPath)
    const tags = parseTags(file)
    const offset = uint64Values(tags.get(324)!)[0]
    const byteCount = uint64Values(tags.get(325)!)[0]
    const physicalTile = inflateSync(file.subarray(offset, offset + byteCount))
    expect(physicalTile.subarray(0, pixels.byteLength)).toEqual(pixels)
    expect(physicalTile.subarray(pixels.byteLength).every((value) => value === 0)).toBe(true)
    const sharp = await loadSharp()
    const metadata = await sharp(targetPath).metadata()
    expect(metadata.depth).toBe(description.bitDepth === 16 ? 'ushort' : 'float')
  })

  it('拒绝缺块并在取消后回滚全部临时结果', async () => {
    const targetPath = path.join(rootDir, 'incomplete.tif')
    await fsp.writeFile(targetPath, 'old')
    const sink = new BigTiffTileOutputSink(targetPath, {
      tileSize: 16,
      inputByteOrder: 'little-endian',
    })
    await sink.begin({ ...baseDescription, width: 32, height: 16, bitDepth: 8 })
    await sink.writeTile({
      x: 0, y: 0, width: 16, height: 16, rowStride: 64, pixels: new Uint8Array(1024),
    })
    await expect(sink.complete()).rejects.toThrow('incomplete')
    await sink.cancel()
    expect(await fsp.readFile(targetPath, 'utf8')).toBe('old')
    expect(await fsp.readdir(rootDir)).toEqual(['incomplete.tif'])
  })

  it('发布前通过 revision/source fingerprint 快照校验', async () => {
    const targetPath = path.join(rootDir, 'stale.tif')
    const snapshots: TileOutputDescription[] = []
    const sink = new BigTiffTileOutputSink(targetPath, {
      tileSize: 16,
      inputByteOrder: 'little-endian',
      validateSnapshot: (description) => {
        snapshots.push(description)
        return false
      },
    })
    await sink.begin({ ...baseDescription, bitDepth: 8 })
    await sink.writeTile({
      x: 0, y: 0, width: 2, height: 1, rowStride: 8, pixels: new Uint8Array(8),
    })
    await expect(sink.complete()).rejects.toThrow('no longer current')
    expect(snapshots).toMatchObject([{ revision: 7, sourceFingerprint: 'sha256:source' }])
    await expect(fsp.access(targetPath)).rejects.toThrow()
  })

  it('BigTIFF 也不会把 PQ/CICP 冒充成已保留的 HDR 元数据', async () => {
    const targetPath = path.join(rootDir, 'unsupported-hdr.tif')
    const sink = new BigTiffTileOutputSink(targetPath, {
      tileSize: 16,
      inputByteOrder: 'little-endian',
    })
    let failure: unknown
    try {
      await sink.begin({
        ...baseDescription,
        bitDepth: 16,
        colorSpace: 'rec2020',
        transferFunction: 'pq',
        cicp: {
          colorPrimaries: 9,
          transferCharacteristics: 16,
          matrixCoefficients: 9,
          fullRange: false,
        },
      })
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(ImageExportCapabilityError)
    expect(failure).toMatchObject({ code: 'HDR_METADATA_UNSUPPORTED', format: 'bigtiff' })
    expect(await fsp.readdir(rootDir)).toEqual([])
  })

  it('200MP 规划只保留单瓦片工作集，不产生全帧表面', () => {
    const plan = planBigTiff({ width: 20_000, height: 10_000, channels: 4, bitDepth: 32 })
    expect(plan).toMatchObject({ columns: 40, rows: 20, tileCount: 800 })
    expect(plan.maxUncompressedTileBytes).toBe(4 * 1024 * 1024)
    expect(plan.maxWorkingSetBytes).toBeLessThan(9 * 1024 * 1024)
    expect(plan.metadataUpperBoundBytes).toBeLessThan(64 * 1024)
    expect(Object.keys(plan)).not.toContain('fullFrameBytes')
  })

  it('底层增量写入器同时支持无 alpha 的 RGB BigTIFF', async () => {
    const targetPath = path.join(rootDir, 'rgb.tif')
    const writer = new IncrementalBigTiffWriter(targetPath, { tileSize: 16 })
    await writer.begin({
      width: 1,
      height: 1,
      channels: 3,
      bitDepth: 8,
      sampleFormat: 'uint',
      byteOrder: 'little-endian',
      colorSpace: 'srgb',
      transferFunction: 'srgb',
      documentId: 'rgb-document',
      revision: 0,
    })
    await writer.writeTile({
      x: 0, y: 0, width: 1, height: 1, rowStride: 3, pixels: Uint8Array.from([1, 2, 3]),
    })
    await writer.complete()

    const tags = parseTags(await fsp.readFile(targetPath))
    expect(tags.get(277)?.data.readUInt16LE()).toBe(3)
    expect(tags.has(338)).toBe(false)
    const sharp = await loadSharp()
    expect(await sharp(targetPath).metadata()).toMatchObject({ channels: 3, depth: 'uchar' })
  })

  it('增量写入器在单瓦片压缩期间取消，不提交该瓦片目录项', async () => {
    const targetPath = path.join(rootDir, 'writer-cancel.tif')
    const writer = new IncrementalBigTiffWriter(targetPath, { tileSize: 16 })
    await writer.begin({
      width: 16,
      height: 16,
      channels: 4,
      bitDepth: 32,
      sampleFormat: 'float',
      byteOrder: 'little-endian',
      colorSpace: 'srgb',
      transferFunction: 'linear',
      alphaMode: 'straight',
      documentId: 'cancel-document',
      revision: 0,
    })
    const writing = writer.writeTile({
      x: 0,
      y: 0,
      width: 16,
      height: 16,
      rowStride: 256,
      pixels: new Uint8Array(4096),
    })
    const cancelling = writer.cancel()
    await expect(writing).rejects.toMatchObject({ name: 'AbortError' })
    await cancelling

    const tags = parseTags(await fsp.readFile(targetPath))
    expect(uint64Values(tags.get(324)!)).toEqual([0])
    expect(uint64Values(tags.get(325)!)).toEqual([0])
    await expect(writer.complete()).rejects.toThrow('cancelled')
  })
})
