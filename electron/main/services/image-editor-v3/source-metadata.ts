import type { SourceImageMetadata } from './contracts'
import { throwIfImageSourceAborted } from './abortable-singleflight'

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

export async function readNclxCicp(
  _filePath: string,
  _format: string | undefined,
  signal?: AbortSignal,
): Promise<SourceImageMetadata['cicp']> {
  throwIfImageSourceAborted(signal)
  /*
   * Fail closed until CICP is obtained from a parser that validates the HEIF/AVIF
   * item-property graph. Searching arbitrary file bytes for a `colr/nclx` pattern
   * lets unrelated or trailing payload bytes turn an SDR source into a false HDR
   * document. High-bit-depth AVIF still remains 16-bit SDR and is never quantized.
   */
  return null
}
