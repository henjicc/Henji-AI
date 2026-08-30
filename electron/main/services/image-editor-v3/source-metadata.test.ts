import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { readNclxCicp } from './source-metadata'

type BoxSizeMode = 'normal' | 'large' | 'to-end'

interface IpmaEntry {
  itemId: number
  propertyIndices: number[]
}

let tempDir = ''
let fixtureIndex = 0

function box(type: string, payload: Buffer, mode: BoxSizeMode = 'normal'): Buffer {
  const headerSize = mode === 'large' ? 16 : 8
  const result = Buffer.alloc(headerSize + payload.byteLength)
  result.writeUInt32BE(mode === 'large' ? 1 : mode === 'to-end' ? 0 : result.byteLength, 0)
  result.write(type, 4, 'latin1')
  if (mode === 'large') result.writeBigUInt64BE(BigInt(result.byteLength), 8)
  payload.copy(result, headerSize)
  return result
}

function fullBox(version: number, flags: number, payload: Buffer): Buffer {
  const result = Buffer.alloc(4 + payload.byteLength)
  result[0] = version
  result.writeUIntBE(flags, 1, 3)
  payload.copy(result, 4)
  return result
}

function ftyp(major = 'avif', compatible = ['mif1', 'avif']): Buffer {
  const payload = Buffer.alloc(8 + compatible.length * 4)
  payload.write(major, 0, 'latin1')
  for (let index = 0; index < compatible.length; index += 1) {
    payload.write(compatible[index], 8 + index * 4, 'latin1')
  }
  return box('ftyp', payload)
}

function pitm(itemId: number, version: 0 | 1 = 0): Buffer {
  const payload = Buffer.alloc(version === 0 ? 2 : 4)
  if (version === 0) payload.writeUInt16BE(itemId)
  else payload.writeUInt32BE(itemId)
  return box('pitm', fullBox(version, 0, payload))
}

function ipma(entries: IpmaEntry[], version: 0 | 1 = 0, wide = false): Buffer {
  const records: Buffer[] = []
  for (const entry of entries) {
    const id = Buffer.alloc(version === 0 ? 2 : 4)
    if (version === 0) id.writeUInt16BE(entry.itemId)
    else id.writeUInt32BE(entry.itemId)
    const count = Buffer.from([entry.propertyIndices.length])
    const properties = Buffer.alloc(entry.propertyIndices.length * (wide ? 2 : 1))
    entry.propertyIndices.forEach((propertyIndex, index) => {
      if (wide) properties.writeUInt16BE(0x8000 | propertyIndex, index * 2)
      else properties[index] = 0x80 | propertyIndex
    })
    records.push(id, count, properties)
  }
  const entryCount = Buffer.alloc(4)
  entryCount.writeUInt32BE(entries.length)
  return box('ipma', fullBox(version, wide ? 1 : 0, Buffer.concat([entryCount, ...records])))
}

function nclx(
  colorPrimaries: number,
  transferCharacteristics: number,
  matrixCoefficients: number,
  fullRange: boolean,
  mode: BoxSizeMode = 'normal',
): Buffer {
  const payload = Buffer.alloc(11)
  payload.write('nclx', 0, 'latin1')
  payload.writeUInt16BE(colorPrimaries, 4)
  payload.writeUInt16BE(transferCharacteristics, 6)
  payload.writeUInt16BE(matrixCoefficients, 8)
  payload[10] = fullRange ? 0x80 : 0
  return box('colr', payload, mode)
}

function icc(): Buffer {
  return box('colr', Buffer.concat([Buffer.from('prof'), Buffer.from([1, 2, 3, 4])]))
}

function heif(options: {
  primaryItemId?: number
  pitmVersion?: 0 | 1
  ipmaVersion?: 0 | 1
  wideAssociations?: boolean
  properties?: Buffer[]
  associations?: IpmaEntry[]
  metaMode?: BoxSizeMode
  brand?: string
  compatibleBrands?: string[]
} = {}): Buffer {
  const primaryItemId = options.primaryItemId ?? 1
  const properties = options.properties ?? [nclx(9, 16, 9, true)]
  const associations = options.associations ?? [{ itemId: primaryItemId, propertyIndices: [1] }]
  const ipco = box('ipco', Buffer.concat(properties))
  const iprp = box('iprp', Buffer.concat([
    ipco,
    ipma(associations, options.ipmaVersion, options.wideAssociations),
  ]))
  const meta = box('meta', fullBox(0, 0, Buffer.concat([
    pitm(primaryItemId, options.pitmVersion),
    iprp,
  ])), options.metaMode)
  return Buffer.concat([ftyp(options.brand, options.compatibleBrands), meta])
}

async function writeFixture(bytes: Buffer): Promise<string> {
  const filePath = path.join(tempDir, `fixture-${fixtureIndex += 1}.avif`)
  await fsp.writeFile(filePath, bytes)
  return filePath
}

beforeEach(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'henji-cicp-'))
  fixtureIndex = 0
})

afterEach(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true })
})

describe('readNclxCicp', () => {
  it('只读取经 primary item 关联的 nclx 属性', async () => {
    const filePath = await writeFixture(heif({
      properties: [icc(), nclx(9, 16, 9, true)],
      associations: [{ itemId: 1, propertyIndices: [1, 2] }],
    }))

    await expect(readNclxCicp(filePath, 'heif')).resolves.toEqual({
      colorPrimaries: 9,
      transferCharacteristics: 16,
      matrixCoefficients: 9,
      fullRange: true,
    })
  })

  it('支持 pitm/ipma v1、15 位属性索引和 largesize meta', async () => {
    const properties = Array.from({ length: 129 }, () => box('free', Buffer.alloc(0)))
    properties.push(nclx(12, 18, 10, false))
    const filePath = await writeFixture(heif({
      primaryItemId: 70_000,
      pitmVersion: 1,
      ipmaVersion: 1,
      wideAssociations: true,
      properties,
      associations: [{ itemId: 70_000, propertyIndices: [130] }],
      metaMode: 'large',
    }))

    await expect(readNclxCicp(filePath, 'avif')).resolves.toEqual({
      colorPrimaries: 12,
      transferCharacteristics: 18,
      matrixCoefficients: 10,
      fullRange: false,
    })
  })

  it('支持 size=0 属性到父级末尾，但不会越过 ipco 读取兄弟 box', async () => {
    const filePath = await writeFixture(heif({
      properties: [nclx(9, 18, 9, true, 'to-end')],
    }))

    await expect(readNclxCicp(filePath, 'heif')).resolves.toMatchObject({
      transferCharacteristics: 18,
    })
  })

  it.each([
    {
      label: '未关联属性',
      bytes: () => heif({ associations: [{ itemId: 1, propertyIndices: [0] }] }),
    },
    {
      label: '非主图属性',
      bytes: () => heif({ associations: [{ itemId: 2, propertyIndices: [1] }] }),
    },
    {
      label: '仅 ICC 属性',
      bytes: () => heif({ properties: [icc()] }),
    },
    {
      label: '未知品牌',
      bytes: () => heif({ brand: 'mp42', compatibleBrands: ['isom'] }),
    },
  ])('$label 不会产生 CICP', async ({ bytes }) => {
    const filePath = await writeFixture(bytes())
    await expect(readNclxCicp(filePath, 'heif')).resolves.toBeNull()
  })

  it('不会把 meta 外部或文件尾部的 colr/nclx 当作主图属性', async () => {
    const filePath = await writeFixture(Buffer.concat([
      ftyp(),
      box('free', Buffer.from('decoy')),
      nclx(9, 16, 9, true),
    ]))

    await expect(readNclxCicp(filePath, 'heif')).resolves.toBeNull()
  })

  it.each([
    {
      label: '越界属性索引',
      bytes: () => heif({ associations: [{ itemId: 1, propertyIndices: [2] }] }),
    },
    {
      label: '重复属性索引',
      bytes: () => heif({ associations: [{ itemId: 1, propertyIndices: [1, 1] }] }),
    },
    {
      label: '多个 nclx 属性',
      bytes: () => heif({
        properties: [nclx(9, 16, 9, true), nclx(1, 13, 1, false)],
        associations: [{ itemId: 1, propertyIndices: [1, 2] }],
      }),
    },
    {
      label: '截断 box',
      bytes: () => heif().subarray(0, heif().byteLength - 1),
    },
  ])('损坏或歧义的 $label 会 fail-closed', async ({ bytes }) => {
    const filePath = await writeFixture(bytes())
    await expect(readNclxCicp(filePath, 'heif')).resolves.toBeNull()
  })

  it('拒绝超出安全整数的 largesize 和 box 数量炸弹', async () => {
    const huge = Buffer.alloc(16)
    huge.writeUInt32BE(1, 0)
    huge.write('meta', 4, 'latin1')
    huge.writeBigUInt64BE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 8)
    const hugePath = await writeFixture(Buffer.concat([ftyp(), huge]))
    await expect(readNclxCicp(hugePath, 'heif')).resolves.toBeNull()

    const boxes = Array.from({ length: 4_097 }, () => box('free', Buffer.alloc(0)))
    const bombPath = await writeFixture(Buffer.concat(boxes))
    await expect(readNclxCicp(bombPath, 'heif')).resolves.toBeNull()
  })

  it('非 HEIF 格式不解析，取消保持 AbortError', async () => {
    const filePath = await writeFixture(heif())
    await expect(readNclxCicp(filePath, 'png')).resolves.toBeNull()
    const controller = new AbortController()
    controller.abort()
    await expect(readNclxCicp(filePath, 'heif', controller.signal))
      .rejects.toMatchObject({ name: 'AbortError' })
  })
})
