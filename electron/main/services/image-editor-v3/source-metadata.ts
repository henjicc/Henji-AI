import fs from 'node:fs'

import type { SourceImageMetadata } from './contracts'
import { throwIfImageSourceAborted } from './abortable-singleflight'

const MAX_CICP_SCAN_BYTES = 8 * 1024 * 1024
const CICP_SCAN_CHUNK_BYTES = 256 * 1024
const NCLX_BOX_BYTES = 19
const COLR_BOX_TYPE = Buffer.from('colr', 'ascii')

export function sourceBitsPerSample(metadata: { bitsPerSample?: number; depth?: string }): number {
  if (
    Number.isSafeInteger(metadata.bitsPerSample)
    && (metadata.bitsPerSample ?? 0) > 0
  ) {
    return metadata.bitsPerSample as number
  }
  if (metadata.depth === 'ushort' || metadata.depth === 'short') return 16
  if (metadata.depth === 'float') return 32
  if (metadata.depth === 'double') return 64
  return 8
}

export function sourceStorageBitDepth(metadata: Pick<SourceImageMetadata, 'bitsPerSample' | 'depth'>): 8 | 16 | 32 {
  if (metadata.depth === 'float' || metadata.depth === 'double') return 32
  if (metadata.bitsPerSample > 16) return 32
  if (metadata.bitsPerSample > 8) return 16
  return 8
}

export function cloneSourceMetadata(metadata: SourceImageMetadata): SourceImageMetadata {
  return {
    ...metadata,
    cicp: metadata.cicp ? { ...metadata.cicp } : null,
  }
}

function parseNclxCicp(prefix: Buffer): SourceImageMetadata['cicp'] {
  let cursor = 4
  while (cursor + NCLX_BOX_BYTES - 4 <= prefix.byteLength) {
    const typeOffset = prefix.indexOf(COLR_BOX_TYPE, cursor)
    if (typeOffset < 0) return null
    const boxOffset = typeOffset - 4
    const boxEnd = boxOffset + NCLX_BOX_BYTES
    if (
      prefix.readUInt32BE(boxOffset) === NCLX_BOX_BYTES
      && boxEnd <= prefix.byteLength
      && prefix.toString('ascii', typeOffset + 4, typeOffset + 8) === 'nclx'
      && (prefix[typeOffset + 14] & 0x7f) === 0
    ) {
      return {
        colorPrimaries: prefix.readUInt16BE(typeOffset + 8),
        transferCharacteristics: prefix.readUInt16BE(typeOffset + 10),
        matrixCoefficients: prefix.readUInt16BE(typeOffset + 12),
        fullRange: (prefix[typeOffset + 14] & 0x80) !== 0,
      }
    }
    cursor = typeOffset + COLR_BOX_TYPE.byteLength
  }
  return null
}

export async function readNclxCicp(
  filePath: string,
  format: string | undefined,
  signal?: AbortSignal,
): Promise<SourceImageMetadata['cicp']> {
  if (format !== 'heif' && format !== 'avif') return null
  throwIfImageSourceAborted(signal)
  const handle = await fs.promises.open(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
  try {
    const stats = await handle.stat()
    if (!stats.isFile()) throw new Error('Image source is not a regular file')
    const scanBytes = Math.min(stats.size, MAX_CICP_SCAN_BYTES)
    if (scanBytes < NCLX_BOX_BYTES) return null
    const buffer = Buffer.allocUnsafe(Math.min(scanBytes, CICP_SCAN_CHUNK_BYTES) + NCLX_BOX_BYTES - 1)
    let fileOffset = 0
    let carryBytes = 0
    while (fileOffset < scanBytes) {
      throwIfImageSourceAborted(signal)
      const readLength = Math.min(CICP_SCAN_CHUNK_BYTES, scanBytes - fileOffset)
      const { bytesRead } = await handle.read(buffer, carryBytes, readLength, fileOffset)
      if (bytesRead <= 0) break
      throwIfImageSourceAborted(signal)
      fileOffset += bytesRead
      const availableBytes = carryBytes + bytesRead
      const parsed = parseNclxCicp(buffer.subarray(0, availableBytes))
      if (parsed) return parsed
      carryBytes = Math.min(NCLX_BOX_BYTES - 1, availableBytes)
      buffer.copy(buffer, 0, availableBytes - carryBytes, availableBytes)
    }
    throwIfImageSourceAborted(signal)
    return null
  } finally {
    await handle.close().catch(() => undefined)
  }
}
