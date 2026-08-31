import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readAssociatedNclxCicp } from './isobmff-cicp'
import { writeAssociatedNclxCicpAtomically } from './isobmff-cicp-writer'

interface Extent {
  length: number
  offset: number
}

interface IlocItem {
  constructionMethod?: number
  extents: Extent[]
  itemId: number
}

const PQ = {
  colorPrimaries: 9,
  transferCharacteristics: 16,
  matrixCoefficients: 9,
  fullRange: false,
} as const

const HLG = {
  colorPrimaries: 9,
  transferCharacteristics: 18,
  matrixCoefficients: 9,
  fullRange: false,
} as const

let tempDir = ''
let fixtureIndex = 0

function box(type: string, payload: Buffer): Buffer {
  const result = Buffer.alloc(8 + payload.byteLength)
  result.writeUInt32BE(result.byteLength, 0)
  result.write(type, 4, 'latin1')
  payload.copy(result, 8)
  return result
}

function fullBox(version: number, flags: number, payload: Buffer): Buffer {
  const result = Buffer.alloc(4 + payload.byteLength)
  result[0] = version
  result.writeUIntBE(flags, 1, 3)
  payload.copy(result, 4)
  return result
}

function ftyp(): Buffer {
  return box('ftyp', Buffer.from('avif\0\0\0\0mif1avif', 'latin1'))
}

function pitm(itemId = 1): Buffer {
  const id = Buffer.alloc(2)
  id.writeUInt16BE(itemId)
  return box('pitm', fullBox(0, 0, id))
}

function ipma(entries: Array<{ itemId: number; properties: number[] }>): Buffer {
  const chunks: Buffer[] = []
  for (const entry of entries) {
    const chunk = Buffer.alloc(3 + entry.properties.length)
    chunk.writeUInt16BE(entry.itemId, 0)
    chunk[2] = entry.properties.length
    entry.properties.forEach((property, index) => { chunk[3 + index] = 0x80 | property })
    chunks.push(chunk)
  }
  const count = Buffer.alloc(4)
  count.writeUInt32BE(entries.length)
  return box('ipma', fullBox(0, 0, Buffer.concat([count, ...chunks])))
}

function iprpWithProperties(
  properties: Buffer[],
  entries: Array<{ itemId: number; properties: number[] }>,
): Buffer {
  const ipco = box('ipco', Buffer.concat(properties))
  return box('iprp', Buffer.concat([ipco, ipma(entries)]))
}

function iprp(entries: Array<{ itemId: number; properties: number[] }>): Buffer {
  return iprpWithProperties([box('ispe', fullBox(0, 0, Buffer.alloc(8)))], entries)
}

function nclx(cicp: typeof PQ | typeof HLG): Buffer {
  const payload = Buffer.alloc(11)
  payload.write('nclx', 0, 'latin1')
  payload.writeUInt16BE(cicp.colorPrimaries, 4)
  payload.writeUInt16BE(cicp.transferCharacteristics, 6)
  payload.writeUInt16BE(cicp.matrixCoefficients, 8)
  payload[10] = cicp.fullRange ? 0x80 : 0
  return box('colr', payload)
}

function iloc(items: IlocItem[], options: { offsetSize?: 1 | 4; version?: 0 | 1 } = {}): Buffer {
  const version = options.version ?? (items.some((item) => item.constructionMethod) ? 1 : 0)
  const offsetSize = options.offsetSize ?? 4
  const chunks: Buffer[] = []
  const sizes = Buffer.alloc(2)
  sizes.writeUInt16BE((offsetSize << 12) | (4 << 8), 0)
  const count = Buffer.alloc(2)
  count.writeUInt16BE(items.length)
  for (const item of items) {
    const header = Buffer.alloc(version === 0 ? 6 : 8)
    header.writeUInt16BE(item.itemId, 0)
    let cursor = 2
    if (version > 0) {
      header.writeUInt16BE(item.constructionMethod ?? 0, cursor)
      cursor += 2
    }
    header.writeUInt16BE(0, cursor)
    cursor += 2
    header.writeUInt16BE(item.extents.length, cursor)
    const extents = Buffer.alloc(item.extents.length * (offsetSize + 4))
    item.extents.forEach((extent, index) => {
      const offset = index * (offsetSize + 4)
      if (offsetSize === 1) extents[offset] = extent.offset
      else extents.writeUInt32BE(extent.offset, offset)
      extents.writeUInt32BE(extent.length, offset + offsetSize)
    })
    chunks.push(header, extents)
  }
  return box('iloc', fullBox(version, 0, Buffer.concat([sizes, count, ...chunks])))
}

function meta(items: IlocItem[]): Buffer {
  return box('meta', fullBox(0, 0, Buffer.concat([
    pitm(),
    iloc(items),
    iprp(items.map((item) => ({ itemId: item.itemId, properties: [1] }))),
  ])))
}

function externalItemAvif(
  makeMeta: (payloadStart: number) => Buffer,
  payload = Buffer.from('primary-alpha'),
): Buffer {
  const placeholder = makeMeta(0)
  const payloadStart = ftyp().byteLength + placeholder.byteLength + 8
  const actual = makeMeta(payloadStart)
  if (actual.byteLength !== placeholder.byteLength) throw new Error('Fixture meta size is unstable')
  return Buffer.concat([ftyp(), actual, box('mdat', payload)])
}

function syntheticAvif(payload = Buffer.from('primary-alpha')): Buffer {
  const placeholderItems: IlocItem[] = [
    { itemId: 1, extents: [{ offset: 0, length: 4 }, { offset: 0, length: 4 }] },
    { itemId: 2, extents: [{ offset: 0, length: 5 }] },
  ]
  const placeholderMeta = meta(placeholderItems)
  const payloadStart = ftyp().byteLength + placeholderMeta.byteLength + 8
  const actualMeta = meta([
    {
      itemId: 1,
      extents: [
        { offset: payloadStart, length: 4 },
        { offset: payloadStart + 4, length: 4 },
      ],
    },
    { itemId: 2, extents: [{ offset: payloadStart + 8, length: 5 }] },
  ])
  return Buffer.concat([ftyp(), actualMeta, box('mdat', payload)])
}

function mdatPayloads(bytes: Buffer): Buffer[] {
  const payloads: Buffer[] = []
  let offset = 0
  while (offset < bytes.byteLength) {
    const declaredSize = bytes.readUInt32BE(offset)
    const type = bytes.toString('latin1', offset + 4, offset + 8)
    const headerSize = declaredSize === 1 ? 16 : 8
    const size = declaredSize === 0
      ? bytes.byteLength - offset
      : declaredSize === 1
        ? Number(bytes.readBigUInt64BE(offset + 8))
        : declaredSize
    if (type === 'mdat') payloads.push(bytes.subarray(offset + headerSize, offset + size))
    offset += size
  }
  return payloads
}

function boxPayload(bytes: Buffer, type: string): Buffer {
  const typeOffset = bytes.indexOf(Buffer.from(type, 'latin1'))
  if (typeOffset < 4) throw new Error(`Missing ${type} fixture box`)
  const start = typeOffset - 4
  const declaredSize = bytes.readUInt32BE(start)
  const headerSize = declaredSize === 1 ? 16 : 8
  const size = declaredSize === 1 ? Number(bytes.readBigUInt64BE(start + 8)) : declaredSize
  return bytes.subarray(start + headerSize, start + size)
}

function ipmaAssociations(bytes: Buffer): Map<number, number[]> {
  const payload = boxPayload(bytes, 'ipma')
  const version = payload[0]
  const wide = (payload.readUIntBE(1, 3) & 1) !== 0
  const count = payload.readUInt32BE(4)
  const result = new Map<number, number[]>()
  let offset = 8
  for (let entry = 0; entry < count; entry += 1) {
    const itemId = version === 0 ? payload.readUInt16BE(offset) : payload.readUInt32BE(offset)
    offset += version === 0 ? 2 : 4
    const associationCount = payload[offset++]
    const indices: number[] = []
    for (let index = 0; index < associationCount; index += 1) {
      const raw = wide ? payload.readUInt16BE(offset) : payload[offset]
      offset += wide ? 2 : 1
      indices.push(raw & (wide ? 0x7fff : 0x7f))
    }
    result.set(itemId, indices)
  }
  return result
}

async function fixture(bytes: Buffer, extension = 'avif'): Promise<string> {
  const filePath = path.join(tempDir, `fixture-${fixtureIndex += 1}.${extension}`)
  await fsp.writeFile(filePath, bytes)
  return filePath
}

async function actualSharpAvif(bitdepth: 10 | 12): Promise<string> {
  const filePath = path.join(tempDir, `sharp-${bitdepth}.avif`)
  await sharp({
    create: {
      width: 8,
      height: 6,
      channels: 4,
      background: { r: 180, g: 80, b: 20, alpha: 0.45 },
    },
  })
    .toColourspace('rgb16')
    .avif({ bitdepth, chromaSubsampling: '4:4:4', quality: 70, effort: 0 })
    .toFile(filePath)
  return filePath
}

beforeEach(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-cicp-writer-'))
  fixtureIndex = 0
})

afterEach(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true })
})

describe('writeAssociatedNclxCicpAtomically', () => {
  it.each([
    { bitdepth: 10 as const, cicp: PQ },
    { bitdepth: 12 as const, cicp: HLG },
  ])('为 Sharp 0.35 的 $bitdepth-bit alpha AVIF 写入并验证 CICP', async ({ bitdepth, cicp }) => {
    const filePath = await actualSharpAvif(bitdepth)
    const before = await sharp(filePath).metadata()
    const beforeAlpha = await sharp(filePath).extractChannel(3).raw().toBuffer()
    const beforeMdats = mdatPayloads(await fsp.readFile(filePath))
    expect(before.bitsPerSample).toBe(bitdepth)
    expect(before.hasAlpha).toBe(true)

    await writeAssociatedNclxCicpAtomically(filePath, cicp)

    await expect(readAssociatedNclxCicp(filePath, 'avif')).resolves.toEqual(cicp)
    const after = await sharp(filePath).metadata()
    expect(after.bitsPerSample).toBe(bitdepth)
    expect(after.hasAlpha).toBe(true)
    expect(after.width).toBe(before.width)
    expect(after.height).toBe(before.height)
    await expect(sharp(filePath).extractChannel(3).raw().toBuffer()).resolves.toEqual(beforeAlpha)
    expect(mdatPayloads(await fsp.readFile(filePath))).toEqual(beforeMdats)
  })

  it('替换已关联 nclx 时不增长文件，并支持 PQ 到 HLG', async () => {
    const filePath = await actualSharpAvif(10)
    await writeAssociatedNclxCicpAtomically(filePath, PQ)
    const firstSize = (await fsp.stat(filePath)).size

    await writeAssociatedNclxCicpAtomically(filePath, HLG)

    expect((await fsp.stat(filePath)).size).toBe(firstSize)
    await expect(readAssociatedNclxCicp(filePath, 'avif')).resolves.toEqual(HLG)
  })

  it('修正多 item、多 extent 的绝对 iloc 偏移并保留 mdat 内容', async () => {
    const payload = Buffer.from('primary-alpha')
    const filePath = await fixture(syntheticAvif(payload))

    await writeAssociatedNclxCicpAtomically(filePath, PQ)

    await expect(readAssociatedNclxCicp(filePath, 'avif')).resolves.toEqual(PQ)
    const bytes = await fsp.readFile(filePath)
    expect(bytes.subarray(bytes.byteLength - payload.byteLength)).toEqual(payload)
  })

  it('共享 nclx 时为 primary item 分离属性，不篡改 alpha item 的关联', async () => {
    const bytes = externalItemAvif((payloadStart) => {
      const items: IlocItem[] = [
        { itemId: 1, extents: [{ offset: payloadStart, length: 4 }] },
        { itemId: 2, extents: [{ offset: payloadStart + 4, length: 4 }] },
      ]
      return box('meta', fullBox(0, 0, Buffer.concat([
        pitm(),
        iloc(items),
        iprpWithProperties(
          [box('ispe', fullBox(0, 0, Buffer.alloc(8))), nclx(PQ)],
          [
            { itemId: 1, properties: [1, 2] },
            { itemId: 2, properties: [1, 2] },
          ],
        ),
      ])))
    }, Buffer.from('mainalph'))
    const filePath = await fixture(bytes)

    await writeAssociatedNclxCicpAtomically(filePath, HLG)

    const rewritten = await fsp.readFile(filePath)
    await expect(readAssociatedNclxCicp(filePath, 'avif')).resolves.toEqual(HLG)
    expect(ipmaAssociations(rewritten).get(1)).toEqual([1, 3])
    expect(ipmaAssociations(rewritten).get(2)).toEqual([1, 2])
    expect(rewritten.toString('latin1').match(/nclx/g)).toHaveLength(2)
  })

  it('新增第 128 个属性时把 ipma 从 7 位索引升级为 15 位索引', async () => {
    const properties = Array.from({ length: 127 }, () => box('free', Buffer.alloc(0)))
    const bytes = externalItemAvif((payloadStart) => {
      const items = [{ itemId: 1, extents: [{ offset: payloadStart, length: 4 }] }]
      return box('meta', fullBox(0, 0, Buffer.concat([
        pitm(),
        iloc(items),
        iprpWithProperties(properties, [{ itemId: 1, properties: [1] }]),
      ])))
    }, Buffer.from('main'))
    const filePath = await fixture(bytes)

    await writeAssociatedNclxCicpAtomically(filePath, PQ)

    const rewritten = await fsp.readFile(filePath)
    await expect(readAssociatedNclxCicp(filePath, 'avif')).resolves.toEqual(PQ)
    expect(boxPayload(rewritten, 'ipma').readUIntBE(1, 3)).toBe(1)
    expect(ipmaAssociations(rewritten).get(1)).toEqual([1, 128])
  })

  it('meta 增长时保持 construction_method=1 的 idat 相对 extent 不变', async () => {
    const idatPayload = Buffer.from('idat-primary')
    const item: IlocItem = {
      itemId: 1,
      constructionMethod: 1,
      extents: [{ offset: 0, length: idatPayload.byteLength }],
    }
    const bytes = Buffer.concat([
      ftyp(),
      box('meta', fullBox(0, 0, Buffer.concat([
        pitm(),
        iloc([item], { version: 1 }),
        iprp([{ itemId: 1, properties: [1] }]),
        box('idat', idatPayload),
      ]))),
      box('mdat', Buffer.from('unused')),
    ])
    const filePath = await fixture(bytes)

    await writeAssociatedNclxCicpAtomically(filePath, HLG)

    const rewritten = await fsp.readFile(filePath)
    await expect(readAssociatedNclxCicp(filePath, 'avif')).resolves.toEqual(HLG)
    expect(boxPayload(rewritten, 'idat')).toEqual(idatPayload)
  })

  it('非法 extent 和未知顶层布局都 fail-closed，且不改变 staged 文件', async () => {
    const valid = syntheticAvif()
    const invalidExtent = Buffer.from(valid)
    const ilocOffset = invalidExtent.indexOf(Buffer.from('iloc')) - 4
    const firstExtentOffset = ilocOffset + 8 + 4 + 2 + 2 + 2 + 2 + 2
    invalidExtent.writeUInt32BE(1, firstExtentOffset)
    const cases = [invalidExtent, Buffer.concat([valid, box('moov', Buffer.alloc(0))])]

    for (const bytes of cases) {
      const filePath = await fixture(bytes)
      const before = await fsp.readFile(filePath)
      await expect(writeAssociatedNclxCicpAtomically(filePath, PQ)).rejects.toThrow(/Unsupported HEIF layout/)
      await expect(fsp.readFile(filePath)).resolves.toEqual(before)
    }
  })

  it('拒绝 iloc 位宽溢出和未知 construction_method', async () => {
    const payload = Buffer.from([1])
    const propertyBox = iprp([{ itemId: 1, properties: [1] }])
    const makeMeta = (offset: number, constructionMethod = 0, offsetSize: 1 | 4 = 1) => box(
      'meta',
      fullBox(0, 0, Buffer.concat([
        pitm(),
        iloc([{ itemId: 1, constructionMethod, extents: [{ offset, length: 1 }] }], {
          offsetSize,
          version: constructionMethod === 0 ? 0 : 1,
        }),
        propertyBox,
      ])),
    )
    const initialMeta = makeMeta(0)
    const paddingSize = 250 - ftyp().byteLength - initialMeta.byteLength - 8
    expect(paddingSize).toBeGreaterThanOrEqual(8)
    const padding = box('free', Buffer.alloc(paddingSize - 8))
    const oldPayloadOffset = ftyp().byteLength + initialMeta.byteLength + padding.byteLength + 8
    const overflowBytes = Buffer.concat([ftyp(), makeMeta(oldPayloadOffset), padding, box('mdat', payload)])
    const methodBytes = Buffer.concat([
      ftyp(),
      makeMeta(ftyp().byteLength + makeMeta(0, 2, 4).byteLength + 8, 2, 4),
      box('mdat', payload),
    ])

    for (const bytes of [overflowBytes, methodBytes]) {
      const filePath = await fixture(bytes)
      const before = await fsp.readFile(filePath)
      await expect(writeAssociatedNclxCicpAtomically(filePath, PQ)).rejects.toThrow(/Unsupported HEIF layout/)
      await expect(fsp.readFile(filePath)).resolves.toEqual(before)
    }
  })

  it('预取消不会创建或替换任何文件', async () => {
    const filePath = await fixture(syntheticAvif())
    const before = await fsp.readFile(filePath)
    const controller = new AbortController()
    controller.abort()

    await expect(writeAssociatedNclxCicpAtomically(filePath, PQ, controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
    await expect(fsp.readFile(filePath)).resolves.toEqual(before)
    expect((await fsp.readdir(tempDir)).filter((name) => name.includes('.cicp.tmp'))).toEqual([])
  })
})
