import sharp from 'sharp'
import type { StoryboardImageMetadataDto } from './types'

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const METADATA_KEY = 'StoryboardCopilotMetadata'

export async function encodePngWithStoryboardMetadata(
  input: Buffer,
  metadata: StoryboardImageMetadataDto
): Promise<Buffer> {
  const png = await sharp(input).png().toBuffer()
  const chunk = createItxtChunk(METADATA_KEY, JSON.stringify(normalizeMetadata(metadata)))
  return insertChunkAfterIhdr(png, chunk)
}

export function readStoryboardMetadataFromPng(bytes: Buffer): StoryboardImageMetadataDto | null {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null
  let offset = 8
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    const dataStart = offset + 8
    const dataEnd = dataStart + length
    if (dataEnd + 4 > bytes.length) break

    if (type === 'iTXt' || type === 'tEXt') {
      const parsed = parseTextChunk(type, bytes.subarray(dataStart, dataEnd))
      if (parsed?.keyword === METADATA_KEY) {
        return normalizeMetadata(JSON.parse(parsed.text) as Partial<StoryboardImageMetadataDto>)
      }
    }
    offset = dataEnd + 4
  }
  return null
}

function normalizeMetadata(metadata: Partial<StoryboardImageMetadataDto>): StoryboardImageMetadataDto {
  return {
    gridRows: Math.max(1, Math.floor(Number(metadata.gridRows) || 1)),
    gridCols: Math.max(1, Math.floor(Number(metadata.gridCols) || 1)),
    frameNotes: Array.isArray(metadata.frameNotes)
      ? metadata.frameNotes.map((note) => String(note))
      : [],
  }
}

function parseTextChunk(type: string, data: Buffer): { keyword: string; text: string } | null {
  const firstNull = data.indexOf(0)
  if (firstNull < 0) return null
  const keyword = data.subarray(0, firstNull).toString('latin1')
  if (type === 'tEXt') {
    return { keyword, text: data.subarray(firstNull + 1).toString('latin1') }
  }

  const compressionFlagIndex = firstNull + 1
  const languageStart = compressionFlagIndex + 2
  const languageEnd = data.indexOf(0, languageStart)
  if (languageEnd < 0) return null
  const translatedEnd = data.indexOf(0, languageEnd + 1)
  if (translatedEnd < 0) return null
  return {
    keyword,
    text: data.subarray(translatedEnd + 1).toString('utf8'),
  }
}

function createItxtChunk(keyword: string, text: string): Buffer {
  const keywordBytes = Buffer.from(keyword, 'latin1')
  const textBytes = Buffer.from(text, 'utf8')
  const data = Buffer.concat([
    keywordBytes,
    Buffer.from([0, 0, 0, 0, 0]),
    textBytes,
  ])
  return createChunk('iTXt', data)
}

function createChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0)
  return Buffer.concat([length, typeBytes, data, crc])
}

function insertChunkAfterIhdr(png: Buffer, chunk: Buffer): Buffer {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Invalid PNG buffer')
  }
  const ihdrLength = png.readUInt32BE(8)
  const ihdrEnd = 8 + 4 + 4 + ihdrLength + 4
  return Buffer.concat([png.subarray(0, ihdrEnd), chunk, png.subarray(ihdrEnd)])
}

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
