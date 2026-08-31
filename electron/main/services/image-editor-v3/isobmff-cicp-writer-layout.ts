import type { SourceImageMetadata } from './contracts'

type CicpMetadata = NonNullable<SourceImageMetadata['cicp']>

export interface FileBoxRange {
  type: string
  start: number
  payloadStart: number
  end: number
}

interface BufferBox extends FileBoxRange {
  headerSize: number
  sizeMode: 'u32' | 'u64' | 'to-end'
}

interface Association {
  essential: boolean
  index: number
}

interface AssociationEntry {
  itemId: number
  associations: Association[]
}

const MAX_BOX_COUNT = 4_096
const MAX_ITEM_COUNT = 4_096
const MAX_ASSOCIATION_COUNT = 16_384
const MAX_PROPERTY_COUNT = 4_096
const MAX_U32 = 0xffff_ffff

function invalid(message: string): never {
  throw new Error(`Unsupported HEIF layout: ${message}`)
}

function safeAdd(left: number, right: number, message: string): number {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) invalid(message)
  const result = left + right
  if (!Number.isSafeInteger(result)) invalid(message)
  return result
}

function parseBoxes(buffer: Buffer, start: number, end: number): BufferBox[] {
  if (start < 0 || end < start || end > buffer.byteLength) invalid('invalid child range')
  const boxes: BufferBox[] = []
  let offset = start
  while (offset < end) {
    if (boxes.length >= MAX_BOX_COUNT || offset > end - 8) invalid('box count or header limit exceeded')
    const declaredSize = buffer.readUInt32BE(offset)
    const type = buffer.toString('latin1', offset + 4, offset + 8)
    let headerSize = 8
    let sizeMode: BufferBox['sizeMode'] = 'u32'
    let size: number
    if (declaredSize === 1) {
      if (offset > end - 16) invalid('truncated largesize header')
      const largeSize = buffer.readBigUInt64BE(offset + 8)
      if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) invalid('largesize exceeds safe integer range')
      size = Number(largeSize)
      headerSize = 16
      sizeMode = 'u64'
    } else if (declaredSize === 0) {
      size = end - offset
      sizeMode = 'to-end'
    } else {
      size = declaredSize
    }
    if (type === 'uuid') headerSize += 16
    if (size < headerSize || size > end - offset) invalid('box exceeds parent bounds')
    boxes.push({ type, start: offset, payloadStart: offset + headerSize, end: offset + size, headerSize, sizeMode })
    offset += size
  }
  if (offset !== end) invalid('child boxes do not fill parent')
  return boxes
}

function only(boxes: readonly BufferBox[], type: string): BufferBox {
  const matches = boxes.filter((box) => box.type === type)
  if (matches.length !== 1) invalid(`expected exactly one ${type} box`)
  return matches[0]
}

function payloadOf(buffer: Buffer, box: BufferBox): Buffer {
  return buffer.subarray(box.payloadStart, box.end)
}

function rebuildBox(box: BufferBox, payload: Buffer): Buffer {
  const useLarge = box.sizeMode === 'u64'
  const headerSize = useLarge ? 16 : 8
  const size = safeAdd(headerSize, payload.byteLength, `${box.type} size overflow`)
  if (!useLarge && size > MAX_U32) invalid(`${box.type} exceeds its 32-bit size field`)
  const result = Buffer.allocUnsafe(size)
  result.writeUInt32BE(useLarge ? 1 : size, 0)
  result.write(box.type, 4, 'latin1')
  if (useLarge) result.writeBigUInt64BE(BigInt(size), 8)
  payload.copy(result, headerSize)
  return result
}

function replaceChildren(
  source: Buffer,
  parent: BufferBox,
  replacements: ReadonlyMap<number, Buffer>,
  prefixBytes = 0,
): Buffer {
  const childStart = parent.payloadStart + prefixBytes
  const children = parseBoxes(source, childStart, parent.end)
  const chunks = [source.subarray(parent.payloadStart, childStart)]
  for (const child of children) chunks.push(replacements.get(child.start) ?? source.subarray(child.start, child.end))
  return rebuildBox(parent, Buffer.concat(chunks))
}

function primaryItemId(buffer: Buffer, pitm: BufferBox): number {
  const payload = payloadOf(buffer, pitm)
  if (payload.byteLength !== 6 && payload.byteLength !== 8) invalid('invalid pitm size')
  const version = payload[0]
  if (payload.readUIntBE(1, 3) !== 0 || (version !== 0 && version !== 1)) invalid('unsupported pitm')
  const itemId = version === 0 ? payload.readUInt16BE(4) : payload.readUInt32BE(4)
  if (itemId === 0 || payload.byteLength !== (version === 0 ? 6 : 8)) invalid('invalid primary item ID')
  return itemId
}

function isNclx(buffer: Buffer, property: BufferBox): boolean {
  if (property.type !== 'colr') return false
  const payload = payloadOf(buffer, property)
  if (payload.byteLength < 4 || payload.toString('latin1', 0, 4) !== 'nclx') return false
  if (payload.byteLength !== 11) invalid('non-canonical nclx property')
  return true
}

function makeNclx(cicp: CicpMetadata): Buffer {
  const result = Buffer.alloc(19)
  result.writeUInt32BE(result.byteLength, 0)
  result.write('colr', 4, 'latin1')
  result.write('nclx', 8, 'latin1')
  result.writeUInt16BE(cicp.colorPrimaries, 12)
  result.writeUInt16BE(cicp.transferCharacteristics, 14)
  result.writeUInt16BE(cicp.matrixCoefficients, 16)
  result[18] = cicp.fullRange ? 0x80 : 0
  return result
}

function parseIpma(buffer: Buffer, box: BufferBox, propertyCount: number): {
  entries: AssociationEntry[]
  version: number
} {
  const payload = payloadOf(buffer, box)
  if (payload.byteLength < 8) invalid('truncated ipma')
  const version = payload[0]
  const flags = payload.readUIntBE(1, 3)
  if ((version !== 0 && version !== 1) || (flags & ~1) !== 0) invalid('unsupported ipma version or flags')
  const wide = (flags & 1) !== 0
  const entryCount = payload.readUInt32BE(4)
  if (entryCount > MAX_ITEM_COUNT) invalid('ipma item limit exceeded')
  const entries: AssociationEntry[] = []
  const seenItems = new Set<number>()
  let totalAssociations = 0
  let offset = 8
  for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
    const idBytes = version === 0 ? 2 : 4
    if (offset > payload.byteLength - idBytes - 1) invalid('truncated ipma item')
    const itemId = version === 0 ? payload.readUInt16BE(offset) : payload.readUInt32BE(offset)
    offset += idBytes
    if (itemId === 0 || seenItems.has(itemId)) invalid('duplicate or zero ipma item')
    seenItems.add(itemId)
    const count = payload[offset++]
    totalAssociations += count
    if (totalAssociations > MAX_ASSOCIATION_COUNT) invalid('ipma association limit exceeded')
    const associations: Association[] = []
    const seenIndices = new Set<number>()
    for (let index = 0; index < count; index += 1) {
      if (offset > payload.byteLength - (wide ? 2 : 1)) invalid('truncated ipma association')
      const raw = wide ? payload.readUInt16BE(offset) : payload[offset]
      offset += wide ? 2 : 1
      const propertyIndex = raw & (wide ? 0x7fff : 0x7f)
      if (propertyIndex > propertyCount || (propertyIndex !== 0 && seenIndices.has(propertyIndex))) {
        invalid('invalid or duplicate property association')
      }
      if (propertyIndex !== 0) seenIndices.add(propertyIndex)
      associations.push({ essential: (raw & (wide ? 0x8000 : 0x80)) !== 0, index: propertyIndex })
    }
    entries.push({ itemId, associations })
  }
  if (offset !== payload.byteLength) invalid('ipma contains trailing bytes')
  return { entries, version }
}

function encodeIpma(box: BufferBox, version: number, entries: readonly AssociationEntry[]): Buffer {
  const wide = entries.some((entry) => entry.associations.some((association) => association.index > 0x7f))
  const chunks: Buffer[] = []
  const header = Buffer.alloc(8)
  header[0] = version
  header.writeUIntBE(wide ? 1 : 0, 1, 3)
  header.writeUInt32BE(entries.length, 4)
  chunks.push(header)
  for (const entry of entries) {
    if (entry.associations.length > 0xff) invalid('too many associations for one item')
    const idBytes = version === 0 ? 2 : 4
    const item = Buffer.alloc(idBytes + 1 + entry.associations.length * (wide ? 2 : 1))
    if (version === 0) item.writeUInt16BE(entry.itemId, 0)
    else item.writeUInt32BE(entry.itemId, 0)
    item[idBytes] = entry.associations.length
    let offset = idBytes + 1
    for (const association of entry.associations) {
      if (association.index > (wide ? 0x7fff : 0x7f)) invalid('property index exceeds ipma width')
      const raw = association.index | (association.essential ? (wide ? 0x8000 : 0x80) : 0)
      if (wide) item.writeUInt16BE(raw, offset)
      else item[offset] = raw
      offset += wide ? 2 : 1
    }
    chunks.push(item)
  }
  return rebuildBox(box, Buffer.concat(chunks))
}

function updateProperties(buffer: Buffer, iprp: BufferBox, primaryId: number, cicp: CicpMetadata): Buffer {
  const children = parseBoxes(buffer, iprp.payloadStart, iprp.end)
  if (children.some((box) => box.type !== 'ipco' && box.type !== 'ipma')) invalid('unknown iprp child')
  const ipco = only(children, 'ipco')
  const ipma = only(children, 'ipma')
  const properties = parseBoxes(buffer, ipco.payloadStart, ipco.end)
  if (properties.length > MAX_PROPERTY_COUNT) invalid('property limit exceeded')
  const parsedIpma = parseIpma(buffer, ipma, properties.length)
  const primaryEntries = parsedIpma.entries.filter((entry) => entry.itemId === primaryId)
  if (primaryEntries.length !== 1) invalid('primary item has no unique ipma entry')
  const primary = primaryEntries[0]
  const nclxIndices = primary.associations
    .filter((association) => association.index > 0 && isNclx(buffer, properties[association.index - 1]))
    .map((association) => association.index)
  if (nclxIndices.length > 1) invalid('primary item has ambiguous nclx associations')

  const propertyChunks = properties.map((property) => (
    property.sizeMode === 'to-end'
      ? rebuildBox(property, payloadOf(buffer, property))
      : buffer.subarray(property.start, property.end)
  ))
  const canonicalNclx = makeNclx(cicp)
  if (nclxIndices.length === 1) {
    const currentIndex = nclxIndices[0]
    const shared = parsedIpma.entries.some((entry) => (
      entry.itemId !== primaryId && entry.associations.some((association) => association.index === currentIndex)
    ))
    if (!shared) {
      propertyChunks[currentIndex - 1] = canonicalNclx
    } else {
      if (properties.length >= MAX_PROPERTY_COUNT) invalid('property limit exceeded')
      propertyChunks.push(canonicalNclx)
      const replacementIndex = propertyChunks.length
      for (const association of primary.associations) {
        if (association.index === currentIndex) association.index = replacementIndex
      }
    }
  } else {
    if (properties.length >= MAX_PROPERTY_COUNT || primary.associations.length >= 0xff) invalid('property limit exceeded')
    propertyChunks.push(canonicalNclx)
    primary.associations.push({ essential: true, index: propertyChunks.length })
  }
  const rebuiltIpco = rebuildBox(ipco, Buffer.concat(propertyChunks))
  const rebuiltIpma = encodeIpma(ipma, parsedIpma.version, parsedIpma.entries)
  return replaceChildren(buffer, iprp, new Map([
    [ipco.start, rebuiltIpco],
    [ipma.start, rebuiltIpma],
  ]))
}

function readUint(buffer: Buffer, offset: number, width: number): bigint {
  let value = 0n
  for (let index = 0; index < width; index += 1) value = (value << 8n) | BigInt(buffer[offset + index])
  return value
}

function writeUint(buffer: Buffer, offset: number, width: number, value: bigint): void {
  const limit = width === 0 ? 0n : (1n << BigInt(width * 8)) - 1n
  if (value < 0n || value > limit) invalid('adjusted iloc offset exceeds its field width')
  for (let index = width - 1; index >= 0; index -= 1) {
    buffer[offset + index] = Number(value & 0xffn)
    value >>= 8n
  }
}

function isInsideMdat(start: bigint, length: bigint, mdats: readonly FileBoxRange[]): boolean {
  if (length <= 0n) return false
  const end = start + length
  return mdats.some((mdat) => start >= BigInt(mdat.payloadStart) && end <= BigInt(mdat.end))
}

function patchIloc(
  source: Buffer,
  box: BufferBox,
  delta: number,
  metaStart: number,
  metaEnd: number,
  fileSize: number,
  mdats: readonly FileBoxRange[],
  idat: BufferBox | undefined,
): Buffer {
  const result = Buffer.from(source.subarray(box.start, box.end))
  const payloadOffset = box.headerSize
  if (result.byteLength < payloadOffset + 8) invalid('truncated iloc')
  const version = result[payloadOffset]
  if (version > 2 || result.readUIntBE(payloadOffset + 1, 3) !== 0) invalid('unsupported iloc version or flags')
  const sizes = result.readUInt16BE(payloadOffset + 4)
  const offsetSize = (sizes >>> 12) & 0xf
  const lengthSize = (sizes >>> 8) & 0xf
  const baseOffsetSize = (sizes >>> 4) & 0xf
  const indexSize = version === 0 ? 0 : sizes & 0xf
  if ([offsetSize, lengthSize, baseOffsetSize, indexSize].some((size) => size > 8)) invalid('iloc field width exceeds 64 bits')
  if (lengthSize === 0) invalid('zero-width iloc extent length is ambiguous')
  let cursor = payloadOffset + 6
  const countBytes = version < 2 ? 2 : 4
  if (cursor > result.byteLength - countBytes) invalid('truncated iloc item count')
  const itemCount = version < 2 ? result.readUInt16BE(cursor) : result.readUInt32BE(cursor)
  cursor += countBytes
  if (itemCount > MAX_ITEM_COUNT) invalid('iloc item limit exceeded')
  let totalExtents = 0
  for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
    const idBytes = version < 2 ? 2 : 4
    if (cursor > result.byteLength - idBytes - (version > 0 ? 2 : 0) - 2 - baseOffsetSize - 2) invalid('truncated iloc item')
    cursor += idBytes
    let constructionMethod = 0
    if (version > 0) {
      const method = result.readUInt16BE(cursor)
      if ((method & 0xfff0) !== 0) invalid('non-zero iloc construction reserved bits')
      constructionMethod = method & 0xf
      cursor += 2
    }
    const dataReferenceIndex = result.readUInt16BE(cursor)
    cursor += 2
    if (dataReferenceIndex !== 0 || constructionMethod > 1) invalid('external or unsupported iloc construction')
    const basePosition = cursor
    const baseOffset = readUint(result, cursor, baseOffsetSize)
    cursor += baseOffsetSize
    const extentCount = result.readUInt16BE(cursor)
    cursor += 2
    totalExtents += extentCount
    if (extentCount === 0 || totalExtents > MAX_ASSOCIATION_COUNT) invalid('invalid iloc extent count')
    const shifts: boolean[] = []
    const offsetFields: Array<{ position: number; value: bigint }> = []
    for (let extentIndex = 0; extentIndex < extentCount; extentIndex += 1) {
      const needed = indexSize + offsetSize + lengthSize
      if (cursor > result.byteLength - needed) invalid('truncated iloc extent')
      if (indexSize > 0 && readUint(result, cursor, indexSize) !== 0n) invalid('unsupported non-zero iloc extent index')
      cursor += indexSize
      const offsetPosition = cursor
      const extentOffset = readUint(result, cursor, offsetSize)
      cursor += offsetSize
      const extentLength = readUint(result, cursor, lengthSize)
      cursor += lengthSize
      const absolute = baseOffset + extentOffset
      if (absolute + extentLength > BigInt(fileSize)) invalid('iloc extent exceeds file bounds')
      if (constructionMethod === 0) {
        if (!isInsideMdat(absolute, extentLength, mdats)) invalid('iloc extent is not contained in mdat')
        if (absolute >= BigInt(metaStart) && absolute < BigInt(metaEnd)) invalid('absolute iloc extent points inside meta')
        const shouldShift = absolute >= BigInt(metaEnd)
        shifts.push(shouldShift)
        offsetFields.push({ position: offsetPosition, value: extentOffset })
      } else {
        if (!idat || absolute + extentLength > BigInt(idat.end - idat.payloadStart)) {
          invalid('iloc idat extent exceeds its payload')
        }
      }
    }
    if (constructionMethod === 0 && shifts.some(Boolean)) {
      if (!shifts.every(Boolean)) invalid('iloc item straddles the rewritten meta box')
      if (offsetSize > 0) {
        for (const field of offsetFields) writeUint(result, field.position, offsetSize, field.value + BigInt(delta))
      } else if (baseOffsetSize > 0) {
        writeUint(result, basePosition, baseOffsetSize, baseOffset + BigInt(delta))
      } else {
        invalid('iloc absolute offset cannot be adjusted')
      }
    }
  }
  if (cursor !== result.byteLength) invalid('iloc contains trailing bytes')
  return result
}

export function rewriteMetaWithAssociatedNclx(
  metaBytes: Buffer,
  metaRange: FileBoxRange,
  fileSize: number,
  mdats: readonly FileBoxRange[],
  cicp: CicpMetadata,
): Buffer {
  const roots = parseBoxes(metaBytes, 0, metaBytes.byteLength)
  const meta = only(roots, 'meta')
  if (meta.start !== 0 || meta.end !== metaBytes.byteLength || meta.payloadStart + 4 > meta.end) invalid('invalid meta box')
  if (metaBytes[meta.payloadStart] !== 0 || metaBytes.readUIntBE(meta.payloadStart + 1, 3) !== 0) invalid('unsupported meta FullBox')
  const children = parseBoxes(metaBytes, meta.payloadStart + 4, meta.end)
  const allowed = new Set(['hdlr', 'pitm', 'iloc', 'iinf', 'iprp', 'iref', 'idat', 'dinf', 'free', 'skip'])
  if (children.some((box) => !allowed.has(box.type))) invalid('unknown meta child')
  const pitm = only(children, 'pitm')
  const iloc = only(children, 'iloc')
  const iprp = only(children, 'iprp')
  const idatMatches = children.filter((box) => box.type === 'idat')
  if (idatMatches.length > 1) invalid('multiple idat boxes')
  const rebuiltIprp = updateProperties(metaBytes, iprp, primaryItemId(metaBytes, pitm), cicp)
  const firstPass = replaceChildren(metaBytes, meta, new Map([[iprp.start, rebuiltIprp]]), 4)
  const delta = firstPass.byteLength - metaBytes.byteLength
  const rebuiltIloc = patchIloc(
    metaBytes,
    iloc,
    delta,
    metaRange.start,
    metaRange.end,
    fileSize,
    mdats,
    idatMatches[0],
  )
  const result = replaceChildren(metaBytes, meta, new Map([
    [iprp.start, rebuiltIprp],
    [iloc.start, rebuiltIloc],
  ]), 4)
  if (result.byteLength - metaBytes.byteLength !== delta) invalid('iloc rewrite changed meta size unexpectedly')
  return result
}
