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

export interface CapabilityRemoteUrlSource {
  kind: 'remote-url'
  /** 供应商可直接读取的 HTTP(S) URL；具体协议是否接受由能力模块校验。 */
  url: string
  mediaType?: string
  filename?: string
}

/** 可移植媒体输入：显式字节、宿主资源引用，或供应商可直接读取的远端 URL。 */
export type CapabilityMediaSource =
  | CapabilityBytesSource
  | CapabilityMediaReference
  | CapabilityRemoteUrlSource

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
  if (source.kind === 'remote-url') {
    throw new AiRuntimeError(
      'capability_remote_media_requires_provider',
      'Remote media URL must be handled by the selected capability provider'
    )
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
