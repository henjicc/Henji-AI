import type { MediaBinary, MediaReader } from '../runtime'
import { AiRuntimeError } from '../runtime/AiRuntimeError'

export interface CapabilityBytesSource {
  kind: 'bytes'
  bytes: Uint8Array
  mediaType: string
  filename?: string
}

export interface CapabilityMediaReference {
  kind: 'media-ref'
  ref: string
  /** 可用于提前校验；最终以宿主 MediaReader 返回值为准。 */
  mediaType?: string
}

/** 可移植媒体输入：调用方显式给字节，或让宿主解析自己的资源引用。 */
export type CapabilityMediaSource = CapabilityBytesSource | CapabilityMediaReference

export async function readCapabilityMediaSource(
  source: CapabilityMediaSource,
  reader: MediaReader
): Promise<MediaBinary> {
  if (source.kind === 'bytes') {
    return {
      bytes: source.bytes,
      mimeType: source.mediaType,
      filename: source.filename?.trim() || 'input',
    }
  }
  const media = await reader.read(source.ref)
  if (source.mediaType && media.mimeType !== source.mediaType) {
    throw new AiRuntimeError(
      'capability_media_type_mismatch',
      `Host media type ${media.mimeType} does not match expected ${source.mediaType}`
    )
  }
  return media
}
