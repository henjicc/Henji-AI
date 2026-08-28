import { loadSharp } from './sharp-loader'
import { normalizeExtension } from './path-utils'

export const GPANO_NAMESPACE = 'http://ns.google.com/photos/1.0/panorama/'

const JPEG_XMP_HEADER = Buffer.from('http://ns.adobe.com/xap/1.0/\0', 'ascii')
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_XMP_KEYWORD = 'XML:com.adobe.xmp'

export type PanoramaMetadataFormat = 'png' | 'jpeg' | 'webp'
export type PanoramaMetadataStatus = 'valid' | 'absent' | 'invalid' | 'unsupported'

export interface PanoramaImageMetadataDto {
  projectionType: 'equirectangular'
  usePanoramaViewer: true
  fullPanoWidthPixels: number
  fullPanoHeightPixels: number
  croppedAreaImageWidthPixels: number
  croppedAreaImageHeightPixels: number
  croppedAreaLeftPixels: number
  croppedAreaTopPixels: number
}

export interface PanoramaMetadataReadResultDto {
  format: PanoramaMetadataFormat | 'unsupported'
  status: PanoramaMetadataStatus
  metadata: PanoramaImageMetadataDto | null
  reason?: string
}

export interface PanoramaMetadataEmbedResultDto {
  bytes: Buffer
  format: PanoramaMetadataFormat
  metadata: PanoramaImageMetadataDto
}

/**
 * 构造完整 360°×180° Photo Sphere 的最小 GPano 契约。
 * 完整全景没有裁剪，裁剪尺寸等于完整尺寸，偏移恒为零。
 */
export function createFullPanoramaMetadata(
  width: number,
  height: number,
): PanoramaImageMetadataDto {
  const safeWidth = readPositiveInteger(width, 'width')
  const safeHeight = readPositiveInteger(height, 'height')
  if (safeWidth !== safeHeight * 2) {
    throw new Error(`Panorama image must use an exact 2:1 ratio, received ${safeWidth}×${safeHeight}`)
  }
  return {
    projectionType: 'equirectangular',
    usePanoramaViewer: true,
    fullPanoWidthPixels: safeWidth,
    fullPanoHeightPixels: safeHeight,
    croppedAreaImageWidthPixels: safeWidth,
    croppedAreaImageHeightPixels: safeHeight,
    croppedAreaLeftPixels: 0,
    croppedAreaTopPixels: 0,
  }
}

export function buildPanoramaXmp(metadata: PanoramaImageMetadataDto): string {
  validatePanoramaMetadata(metadata)
  return [
    '<?xpacket begin="\ufeff" id="W5M0MpCehiHzreSzNTczkc9d"?>',
    '<x:xmpmeta xmlns:x="adobe:ns:meta/">',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">',
    `<rdf:Description rdf:about="" xmlns:GPano="${GPANO_NAMESPACE}">`,
    '<GPano:UsePanoramaViewer>True</GPano:UsePanoramaViewer>',
    '<GPano:ProjectionType>equirectangular</GPano:ProjectionType>',
    `<GPano:FullPanoWidthPixels>${metadata.fullPanoWidthPixels}</GPano:FullPanoWidthPixels>`,
    `<GPano:FullPanoHeightPixels>${metadata.fullPanoHeightPixels}</GPano:FullPanoHeightPixels>`,
    `<GPano:CroppedAreaImageWidthPixels>${metadata.croppedAreaImageWidthPixels}</GPano:CroppedAreaImageWidthPixels>`,
    `<GPano:CroppedAreaImageHeightPixels>${metadata.croppedAreaImageHeightPixels}</GPano:CroppedAreaImageHeightPixels>`,
    `<GPano:CroppedAreaLeftPixels>${metadata.croppedAreaLeftPixels}</GPano:CroppedAreaLeftPixels>`,
    `<GPano:CroppedAreaTopPixels>${metadata.croppedAreaTopPixels}</GPano:CroppedAreaTopPixels>`,
    '</rdf:Description>',
    '</rdf:RDF>',
    '</x:xmpmeta>',
    '<?xpacket end="w"?>',
  ].join('')
}

/**
 * 直接写容器元数据，不重新编码像素。支持 PNG iTXt、JPEG APP1 和 WebP XMP chunk。
 */
export async function embedPanoramaMetadataInImage(
  bytes: Buffer,
  extension: string,
): Promise<PanoramaMetadataEmbedResultDto> {
  const sharp = await loadSharp()
  const imageMetadata = await sharp(bytes).metadata()
  const format = resolveSupportedFormat(imageMetadata.format ?? extension)
  if (!format) {
    throw new Error(`Panorama XMP export does not support image format: ${normalizeExtension(extension)}`)
  }
  const metadata = createFullPanoramaMetadata(imageMetadata.width ?? 0, imageMetadata.height ?? 0)
  const xmp = buildPanoramaXmp(metadata)
  const output = format === 'png'
    ? replacePngXmp(bytes, xmp)
    : format === 'jpeg'
      ? replaceJpegXmp(bytes, xmp)
      : replaceWebpXmp(bytes, xmp, metadata.fullPanoWidthPixels, metadata.fullPanoHeightPixels)
  return { bytes: output, format, metadata }
}

export async function readPanoramaMetadataFromImage(
  bytes: Buffer,
  extension: string,
): Promise<PanoramaMetadataReadResultDto> {
  const sharp = await loadSharp()
  const imageMetadata = await sharp(bytes).metadata()
  const format = resolveSupportedFormat(imageMetadata.format ?? extension)
  if (!format) {
    return { format: 'unsupported', status: 'unsupported', metadata: null }
  }
  const xmp = extractContainerXmp(bytes, format) ?? imageMetadata.xmpAsString
  if (!xmp || (!xmp.includes(GPANO_NAMESPACE) && !xmp.includes('GPano:'))) {
    return { format, status: 'absent', metadata: null }
  }
  try {
    const metadata = parsePanoramaXmp(xmp)
    validatePanoramaMetadata(metadata)
    return { format, status: 'valid', metadata }
  } catch (error) {
    return {
      format,
      status: 'invalid',
      metadata: null,
      reason: error instanceof Error ? error.message : String(error),
    }
  }
}

export function parsePanoramaXmp(xmp: string): PanoramaImageMetadataDto {
  const projectionType = readXmpString(xmp, 'ProjectionType')
  if (projectionType !== 'equirectangular') {
    throw new Error('GPano ProjectionType must be equirectangular')
  }
  if (readXmpString(xmp, 'UsePanoramaViewer').toLowerCase() !== 'true') {
    throw new Error('GPano UsePanoramaViewer must be True')
  }
  return {
    projectionType,
    usePanoramaViewer: true,
    fullPanoWidthPixels: readXmpInteger(xmp, 'FullPanoWidthPixels'),
    fullPanoHeightPixels: readXmpInteger(xmp, 'FullPanoHeightPixels'),
    croppedAreaImageWidthPixels: readXmpInteger(xmp, 'CroppedAreaImageWidthPixels'),
    croppedAreaImageHeightPixels: readXmpInteger(xmp, 'CroppedAreaImageHeightPixels'),
    croppedAreaLeftPixels: readXmpInteger(xmp, 'CroppedAreaLeftPixels', true),
    croppedAreaTopPixels: readXmpInteger(xmp, 'CroppedAreaTopPixels', true),
  }
}

function validatePanoramaMetadata(metadata: PanoramaImageMetadataDto): void {
  const fullWidth = readPositiveInteger(metadata.fullPanoWidthPixels, 'FullPanoWidthPixels')
  const fullHeight = readPositiveInteger(metadata.fullPanoHeightPixels, 'FullPanoHeightPixels')
  const cropWidth = readPositiveInteger(metadata.croppedAreaImageWidthPixels, 'CroppedAreaImageWidthPixels')
  const cropHeight = readPositiveInteger(metadata.croppedAreaImageHeightPixels, 'CroppedAreaImageHeightPixels')
  const left = readNonNegativeInteger(metadata.croppedAreaLeftPixels, 'CroppedAreaLeftPixels')
  const top = readNonNegativeInteger(metadata.croppedAreaTopPixels, 'CroppedAreaTopPixels')
  if (cropWidth + left > fullWidth || cropHeight + top > fullHeight) {
    throw new Error('GPano cropped area exceeds the full panorama bounds')
  }
}

function readXmpString(xmp: string, field: string): string {
  const element = new RegExp(`<GPano:${field}\\s*>([^<]+)</GPano:${field}>`, 'i').exec(xmp)?.[1]
  const attribute = new RegExp(`GPano:${field}\\s*=\\s*["']([^"']+)["']`, 'i').exec(xmp)?.[1]
  const value = (element ?? attribute ?? '').trim()
  if (!value) throw new Error(`GPano ${field} is missing`)
  return value
}

function readXmpInteger(xmp: string, field: string, allowZero = false): number {
  const value = Number(readXmpString(xmp, field))
  return allowZero ? readNonNegativeInteger(value, field) : readPositiveInteger(value, field)
}

function readPositiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`)
  return value
}

function readNonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`)
  return value
}

function resolveSupportedFormat(value: string): PanoramaMetadataFormat | null {
  const format = normalizeExtension(value)
  if (format === 'png' || format === 'webp') return format
  if (format === 'jpg' || format === 'jpeg') return 'jpeg'
  return null
}

function extractContainerXmp(bytes: Buffer, format: PanoramaMetadataFormat): string | null {
  if (format === 'png') return extractPngXmp(bytes)
  if (format === 'jpeg') return extractJpegXmp(bytes)
  return extractWebpXmp(bytes)
}

function extractJpegXmp(bytes: Buffer): string | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) return null
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xda || marker === 0xd9) return null
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue
    if (offset + 2 > bytes.length) return null
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) return null
    const payloadStart = offset + 2
    if (marker === 0xe1 && bytes.subarray(payloadStart, payloadStart + JPEG_XMP_HEADER.length).equals(JPEG_XMP_HEADER)) {
      return bytes.subarray(payloadStart + JPEG_XMP_HEADER.length, offset + length).toString('utf8')
    }
    offset += length
  }
  return null
}

function extractPngXmp(bytes: Buffer): string | null {
  if (bytes.length < 8 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) return null
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === 'iTXt') {
      const keywordEnd = data.indexOf(0)
      const keyword = keywordEnd >= 0 ? data.subarray(0, keywordEnd).toString('utf8') : ''
      if (keyword === PNG_XMP_KEYWORD && keywordEnd + 5 <= data.length && data[keywordEnd + 1] === 0) {
        let cursor = keywordEnd + 3
        const languageEnd = data.indexOf(0, cursor)
        if (languageEnd < 0) return null
        cursor = languageEnd + 1
        const translatedEnd = data.indexOf(0, cursor)
        if (translatedEnd < 0) return null
        return data.subarray(translatedEnd + 1).toString('utf8')
      }
    }
    offset = end
  }
  return null
}

function extractWebpXmp(bytes: Buffer): string | null {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
    return null
  }
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4)
    const length = bytes.readUInt32LE(offset + 4)
    const end = offset + 8 + length + (length % 2)
    if (end > bytes.length) return null
    if (type === 'XMP ') return bytes.subarray(offset + 8, offset + 8 + length).toString('utf8')
    offset = end
  }
  return null
}

function replaceJpegXmp(bytes: Buffer, xmp: string): Buffer {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('Invalid JPEG container')
  }
  const xmpPayload = Buffer.concat([JPEG_XMP_HEADER, Buffer.from(xmp, 'utf8')])
  if (xmpPayload.length + 2 > 0xffff) throw new Error('Panorama XMP exceeds the JPEG APP1 limit')
  const segment = Buffer.allocUnsafe(xmpPayload.length + 4)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment.writeUInt16BE(xmpPayload.length + 2, 2)
  xmpPayload.copy(segment, 4)

  const kept: Buffer[] = []
  let offset = 2
  while (offset < bytes.length) {
    const markerStart = offset
    if (bytes[offset] !== 0xff) throw new Error('Invalid JPEG marker sequence')
    while (bytes[offset] === 0xff) offset += 1
    const marker = bytes[offset]
    offset += 1
    if (marker === 0xda || marker === 0xd9) {
      return Buffer.concat([bytes.subarray(0, 2), ...kept, segment, bytes.subarray(markerStart)])
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      kept.push(bytes.subarray(markerStart, offset))
      continue
    }
    if (offset + 2 > bytes.length) throw new Error('Invalid JPEG segment length')
    const length = bytes.readUInt16BE(offset)
    if (length < 2 || offset + length > bytes.length) throw new Error('Invalid JPEG segment bounds')
    const end = offset + length
    const payloadStart = offset + 2
    const isStandardXmp = marker === 0xe1
      && bytes.subarray(payloadStart, payloadStart + JPEG_XMP_HEADER.length).equals(JPEG_XMP_HEADER)
    if (!isStandardXmp) kept.push(bytes.subarray(markerStart, end))
    offset = end
  }
  throw new Error('JPEG scan data marker is missing')
}

function replacePngXmp(bytes: Buffer, xmp: string): Buffer {
  if (bytes.length < PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG container')
  }
  const chunks: Buffer[] = [PNG_SIGNATURE]
  let offset = 8
  let inserted = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) throw new Error('Invalid PNG chunk bounds')
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    const isXmp = type === 'iTXt' && data.subarray(0, PNG_XMP_KEYWORD.length).toString('utf8') === PNG_XMP_KEYWORD
    if (type === 'IEND' && !inserted) {
      chunks.push(createPngXmpChunk(xmp))
      inserted = true
    }
    if (!isXmp) chunks.push(bytes.subarray(offset, end))
    offset = end
    if (type === 'IEND') break
  }
  if (!inserted) throw new Error('PNG IEND chunk is missing')
  return Buffer.concat(chunks)
}

function createPngXmpChunk(xmp: string): Buffer {
  const type = Buffer.from('iTXt', 'ascii')
  const data = Buffer.concat([
    Buffer.from(PNG_XMP_KEYWORD, 'utf8'),
    Buffer.from([0, 0, 0, 0, 0]),
    Buffer.from(xmp, 'utf8'),
  ])
  const chunk = Buffer.allocUnsafe(data.length + 12)
  chunk.writeUInt32BE(data.length, 0)
  type.copy(chunk, 4)
  data.copy(chunk, 8)
  chunk.writeUInt32BE(crc32(Buffer.concat([type, data])), 8 + data.length)
  return chunk
}

function replaceWebpXmp(bytes: Buffer, xmp: string, width: number, height: number): Buffer {
  if (bytes.length < 12 || bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WEBP') {
    throw new Error('Invalid WebP container')
  }
  const chunks: Array<{ type: string; bytes: Buffer }> = []
  let offset = 12
  while (offset + 8 <= bytes.length) {
    const type = bytes.toString('ascii', offset, offset + 4)
    const length = bytes.readUInt32LE(offset + 4)
    const end = offset + 8 + length + (length % 2)
    if (end > bytes.length) throw new Error('Invalid WebP chunk bounds')
    if (type !== 'XMP ') chunks.push({ type, bytes: bytes.subarray(offset, end) })
    offset = end
  }
  const featureFlags = (chunks.some((chunk) => chunk.type === 'ICCP') ? 0x20 : 0)
    | (chunks.some((chunk) => chunk.type === 'ALPH') ? 0x10 : 0)
    | (chunks.some((chunk) => chunk.type === 'EXIF') ? 0x08 : 0)
    | 0x04
    | (chunks.some((chunk) => chunk.type === 'ANIM') ? 0x02 : 0)
  const existingVp8x = chunks.find((chunk) => chunk.type === 'VP8X')
  if (existingVp8x) {
    const patched = Buffer.from(existingVp8x.bytes)
    if (patched.length < 18) throw new Error('Invalid WebP VP8X chunk')
    patched[8] |= 0x04
    existingVp8x.bytes = patched
  } else {
    chunks.unshift({ type: 'VP8X', bytes: createWebpVp8xChunk(featureFlags, width, height) })
  }
  chunks.push({ type: 'XMP ', bytes: createWebpChunk('XMP ', Buffer.from(xmp, 'utf8')) })
  const body = Buffer.concat(chunks.map((chunk) => chunk.bytes))
  const output = Buffer.allocUnsafe(12 + body.length)
  output.write('RIFF', 0, 'ascii')
  output.writeUInt32LE(output.length - 8, 4)
  output.write('WEBP', 8, 'ascii')
  body.copy(output, 12)
  return output
}

function createWebpVp8xChunk(flags: number, width: number, height: number): Buffer {
  const data = Buffer.alloc(10)
  data[0] = flags
  writeUInt24LE(data, width - 1, 4)
  writeUInt24LE(data, height - 1, 7)
  return createWebpChunk('VP8X', data)
}

function createWebpChunk(type: string, data: Buffer): Buffer {
  const chunk = Buffer.alloc(8 + data.length + (data.length % 2))
  chunk.write(type, 0, 'ascii')
  chunk.writeUInt32LE(data.length, 4)
  data.copy(chunk, 8)
  return chunk
}

function writeUInt24LE(buffer: Buffer, value: number, offset: number): void {
  buffer[offset] = value & 0xff
  buffer[offset + 1] = (value >>> 8) & 0xff
  buffer[offset + 2] = (value >>> 16) & 0xff
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
