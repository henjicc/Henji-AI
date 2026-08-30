import type { FileHandle } from 'node:fs/promises'
import { open } from 'node:fs/promises'

import type { SourceImageMetadata } from './contracts'
import { throwIfImageSourceAborted } from './abortable-singleflight'

type CicpMetadata = NonNullable<SourceImageMetadata['cicp']>

interface IsoBox {
  type: string
  start: number
  payloadStart: number
  end: number
}

interface PropertyAssociations {
  itemId: number
  propertyIndices: number[]
}

const MAX_BOX_COUNT = 4_096
const MAX_PROPERTY_COUNT = 4_096
const MAX_ITEM_COUNT = 4_096
const MAX_ASSOCIATION_COUNT = 16_384
const MAX_FTYP_BYTES = 4 * 1_024
const MAX_IPMA_BYTES = 1024 * 1024
const MAX_BYTES_READ = 2 * 1024 * 1024
const MAX_SAFE_FILE_SIZE = BigInt(Number.MAX_SAFE_INTEGER)
const HEIF_BRANDS = new Set([
  'avif', 'avis',
  'heic', 'heix', 'hevc', 'hevx',
  'heim', 'heis', 'hevm', 'hevs',
  'mif1', 'msf1',
])

class InvalidIsoBmffError extends Error {}

function invalid(message: string): never {
  throw new InvalidIsoBmffError(message)
}

function isSupportedFormat(format: string | undefined): boolean {
  if (!format) return false
  return format.toLowerCase() === 'heif'
    || format.toLowerCase() === 'heic'
    || format.toLowerCase() === 'avif'
}

class BoundedIsoReader {
  private boxCount = 0
  private bytesRead = 0

  constructor(
    private readonly handle: FileHandle,
    readonly fileSize: number,
    private readonly signal?: AbortSignal,
  ) {}

  async read(offset: number, length: number): Promise<Buffer> {
    throwIfImageSourceAborted(this.signal)
    if (
      !Number.isSafeInteger(offset)
      || !Number.isSafeInteger(length)
      || offset < 0
      || length < 0
      || offset > this.fileSize - length
      || this.bytesRead > MAX_BYTES_READ - length
    ) {
      invalid('ISOBMFF read exceeds a bounded range')
    }
    this.bytesRead += length
    const buffer = Buffer.allocUnsafe(length)
    let filled = 0
    while (filled < length) {
      throwIfImageSourceAborted(this.signal)
      const result = await this.handle.read(buffer, filled, length - filled, offset + filled)
      if (result.bytesRead === 0) invalid('ISOBMFF file was truncated while reading')
      filled += result.bytesRead
    }
    return buffer
  }

  async readBox(offset: number, parentEnd: number): Promise<IsoBox> {
    throwIfImageSourceAborted(this.signal)
    this.boxCount += 1
    if (this.boxCount > MAX_BOX_COUNT) invalid('ISOBMFF box count exceeds the safety limit')
    if (offset < 0 || parentEnd > this.fileSize || offset > parentEnd - 8) {
      invalid('ISOBMFF box header is truncated')
    }

    const header = await this.read(offset, 8)
    const declaredSize = header.readUInt32BE(0)
    const type = header.toString('latin1', 4, 8)
    let headerSize = 8
    let boxSize: number

    if (declaredSize === 1) {
      if (offset > parentEnd - 16) invalid('ISOBMFF largesize header is truncated')
      const largeSize = (await this.read(offset + 8, 8)).readBigUInt64BE(0)
      if (largeSize > MAX_SAFE_FILE_SIZE) invalid('ISOBMFF largesize exceeds safe integer bounds')
      boxSize = Number(largeSize)
      headerSize += 8
    } else if (declaredSize === 0) {
      boxSize = parentEnd - offset
    } else {
      boxSize = declaredSize
    }

    if (type === 'uuid') headerSize += 16
    if (boxSize < headerSize || boxSize > parentEnd - offset) {
      invalid('ISOBMFF box exceeds its parent bounds')
    }

    return {
      type,
      start: offset,
      payloadStart: offset + headerSize,
      end: offset + boxSize,
    }
  }

  async children(start: number, end: number): Promise<IsoBox[]> {
    if (start < 0 || end < start || end > this.fileSize) invalid('Invalid ISOBMFF child range')
    const boxes: IsoBox[] = []
    let offset = start
    while (offset < end) {
      const box = await this.readBox(offset, end)
      boxes.push(box)
      offset = box.end
    }
    if (offset !== end) invalid('ISOBMFF child boxes do not fill their parent')
    return boxes
  }
}

function fullBoxHeader(payload: Buffer): { version: number; flags: number } {
  if (payload.byteLength < 4) invalid('ISOBMFF FullBox header is truncated')
  return {
    version: payload[0],
    flags: payload.readUIntBE(1, 3),
  }
}

async function hasHeifBrand(reader: BoundedIsoReader, box: IsoBox): Promise<boolean> {
  const length = box.end - box.payloadStart
  if (length < 8 || length > MAX_FTYP_BYTES || (length - 8) % 4 !== 0) {
    invalid('Invalid HEIF ftyp payload')
  }
  const payload = await reader.read(box.payloadStart, length)
  for (let offset = 0; offset < payload.byteLength; offset += 4) {
    if (offset === 4) continue
    if (HEIF_BRANDS.has(payload.toString('latin1', offset, offset + 4))) return true
  }
  return false
}

async function readPrimaryItemId(reader: BoundedIsoReader, box: IsoBox): Promise<number> {
  const length = box.end - box.payloadStart
  if (length !== 6 && length !== 8) invalid('Invalid pitm payload size')
  const payload = await reader.read(box.payloadStart, length)
  const { version, flags } = fullBoxHeader(payload)
  if (flags !== 0 || (version !== 0 && version !== 1)) invalid('Unsupported pitm version or flags')
  if ((version === 0 && length !== 6) || (version === 1 && length !== 8)) {
    invalid('pitm item ID width does not match its version')
  }
  const itemId = version === 0 ? payload.readUInt16BE(4) : payload.readUInt32BE(4)
  if (itemId === 0) invalid('Primary item ID cannot be zero')
  return itemId
}

async function readNclxProperty(
  reader: BoundedIsoReader,
  box: IsoBox,
): Promise<CicpMetadata | null> {
  const length = box.end - box.payloadStart
  if (length < 4) invalid('colr property is truncated')
  const type = (await reader.read(box.payloadStart, 4)).toString('latin1')
  if (type !== 'nclx') return null
  if (length < 11) invalid('nclx property is truncated')
  const payload = await reader.read(box.payloadStart + 4, 7)
  return {
    colorPrimaries: payload.readUInt16BE(0),
    transferCharacteristics: payload.readUInt16BE(2),
    matrixCoefficients: payload.readUInt16BE(4),
    fullRange: (payload[6] & 0x80) !== 0,
  }
}

async function readProperties(
  reader: BoundedIsoReader,
  ipco: IsoBox,
): Promise<{ propertyCount: number; nclx: Map<number, CicpMetadata> }> {
  const properties = await reader.children(ipco.payloadStart, ipco.end)
  if (properties.length > MAX_PROPERTY_COUNT) invalid('HEIF property count exceeds the safety limit')
  const nclx = new Map<number, CicpMetadata>()
  for (let index = 0; index < properties.length; index += 1) {
    const property = properties[index]
    if (property.type !== 'colr') continue
    const metadata = await readNclxProperty(reader, property)
    if (metadata) nclx.set(index + 1, metadata)
  }
  return { propertyCount: properties.length, nclx }
}

async function readAssociations(
  reader: BoundedIsoReader,
  box: IsoBox,
): Promise<PropertyAssociations[]> {
  const length = box.end - box.payloadStart
  if (length < 8 || length > MAX_IPMA_BYTES) invalid('Invalid ipma payload size')
  const payload = await reader.read(box.payloadStart, length)
  const { version, flags } = fullBoxHeader(payload)
  if ((version !== 0 && version !== 1) || (flags & ~1) !== 0) {
    invalid('Unsupported ipma version or flags')
  }
  const entryCount = payload.readUInt32BE(4)
  if (entryCount > MAX_ITEM_COUNT) invalid('HEIF item count exceeds the safety limit')
  const associations: PropertyAssociations[] = []
  let totalAssociations = 0
  let offset = 8
  for (let entry = 0; entry < entryCount; entry += 1) {
    const itemIdBytes = version === 0 ? 2 : 4
    if (offset > payload.byteLength - itemIdBytes - 1) invalid('ipma item entry is truncated')
    const itemId = version === 0 ? payload.readUInt16BE(offset) : payload.readUInt32BE(offset)
    offset += itemIdBytes
    const associationCount = payload[offset]
    offset += 1
    totalAssociations += associationCount
    if (totalAssociations > MAX_ASSOCIATION_COUNT) {
      invalid('HEIF association count exceeds the safety limit')
    }
    const propertyIndices: number[] = []
    for (let association = 0; association < associationCount; association += 1) {
      if ((flags & 1) !== 0) {
        if (offset > payload.byteLength - 2) invalid('Wide ipma association is truncated')
        propertyIndices.push(payload.readUInt16BE(offset) & 0x7fff)
        offset += 2
      } else {
        if (offset >= payload.byteLength) invalid('ipma association is truncated')
        propertyIndices.push(payload[offset] & 0x7f)
        offset += 1
      }
    }
    associations.push({ itemId, propertyIndices })
  }
  if (offset !== payload.byteLength) invalid('ipma contains trailing bytes')
  return associations
}

function resolvePrimaryNclx(
  primaryItemId: number,
  propertyCount: number,
  nclxProperties: ReadonlyMap<number, CicpMetadata>,
  associations: readonly PropertyAssociations[],
): CicpMetadata | null {
  const seenItems = new Set<number>()
  let primaryIndices: number[] | null = null
  for (const association of associations) {
    if (association.itemId === 0 || seenItems.has(association.itemId)) {
      invalid('ipma contains an invalid or duplicate item entry')
    }
    seenItems.add(association.itemId)
    const seenProperties = new Set<number>()
    for (const propertyIndex of association.propertyIndices) {
      if (propertyIndex === 0) continue
      if (propertyIndex > propertyCount || seenProperties.has(propertyIndex)) {
        invalid('ipma references an invalid or duplicate property')
      }
      seenProperties.add(propertyIndex)
    }
    if (association.itemId === primaryItemId) primaryIndices = association.propertyIndices
  }
  if (!primaryIndices) return null
  const candidates = primaryIndices
    .filter((index) => index !== 0)
    .map((index) => nclxProperties.get(index))
    .filter((value): value is CicpMetadata => value !== undefined)
  if (candidates.length === 0) return null
  if (candidates.length !== 1) invalid('Primary item has ambiguous nclx properties')
  return candidates[0]
}

async function parseMeta(reader: BoundedIsoReader, meta: IsoBox): Promise<CicpMetadata | null> {
  if (meta.end - meta.payloadStart < 4) invalid('meta FullBox is truncated')
  const header = await reader.read(meta.payloadStart, 4)
  const { version, flags } = fullBoxHeader(header)
  if (version !== 0 || flags !== 0) invalid('Unsupported meta version or flags')
  const children = await reader.children(meta.payloadStart + 4, meta.end)
  const pitmBoxes = children.filter((box) => box.type === 'pitm')
  const iprpBoxes = children.filter((box) => box.type === 'iprp')
  if (pitmBoxes.length !== 1 || iprpBoxes.length !== 1) return null

  const primaryItemId = await readPrimaryItemId(reader, pitmBoxes[0])
  const iprpChildren = await reader.children(iprpBoxes[0].payloadStart, iprpBoxes[0].end)
  const ipcoBoxes = iprpChildren.filter((box) => box.type === 'ipco')
  const ipmaBoxes = iprpChildren.filter((box) => box.type === 'ipma')
  if (ipcoBoxes.length !== 1 || ipmaBoxes.length === 0) return null

  const properties = await readProperties(reader, ipcoBoxes[0])
  const associations: PropertyAssociations[] = []
  let totalPropertyAssociations = 0
  for (const ipma of ipmaBoxes) {
    const current = await readAssociations(reader, ipma)
    if (associations.length > MAX_ITEM_COUNT - current.length) {
      invalid('HEIF item count exceeds the safety limit')
    }
    for (const association of current) {
      totalPropertyAssociations += association.propertyIndices.length
      if (totalPropertyAssociations > MAX_ASSOCIATION_COUNT) {
        invalid('HEIF association count exceeds the safety limit')
      }
    }
    associations.push(...current)
  }
  return resolvePrimaryNclx(
    primaryItemId,
    properties.propertyCount,
    properties.nclx,
    associations,
  )
}

async function parseFile(
  handle: FileHandle,
  fileSize: number,
  signal?: AbortSignal,
): Promise<CicpMetadata | null> {
  const reader = new BoundedIsoReader(handle, fileSize, signal)
  const topLevel = await reader.children(0, fileSize)
  const ftypBoxes = topLevel.filter((box) => box.type === 'ftyp')
  const metaBoxes = topLevel.filter((box) => box.type === 'meta')
  if (ftypBoxes.length !== 1 || metaBoxes.length !== 1) return null
  if (!await hasHeifBrand(reader, ftypBoxes[0])) return null
  return parseMeta(reader, metaBoxes[0])
}

export async function readAssociatedNclxCicp(
  filePath: string,
  format: string | undefined,
  signal?: AbortSignal,
): Promise<SourceImageMetadata['cicp']> {
  throwIfImageSourceAborted(signal)
  if (!isSupportedFormat(format)) return null
  let handle: FileHandle | undefined
  try {
    handle = await open(filePath, 'r')
    const stats = await handle.stat({ bigint: true })
    if (stats.size < 8n || stats.size > MAX_SAFE_FILE_SIZE) return null
    return await parseFile(handle, Number(stats.size), signal)
  } catch (error) {
    if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) throw error
    return null
  } finally {
    await handle?.close().catch(() => undefined)
  }
}
