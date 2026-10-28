import path from 'node:path'

import type { LocalMediaKind } from '../../../../src/core/media/localMediaImportContracts'

export interface DetectedMediaFormat {
  kind: LocalMediaKind
  mimeType: string
  extension: string
  durationProbe?: 'optional'
}

export const EXTENSION_FORMATS: Readonly<Record<string, DetectedMediaFormat>> = {
  '.png': { kind: 'image', mimeType: 'image/png', extension: 'png' },
  '.jpg': { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg' },
  '.jpeg': { kind: 'image', mimeType: 'image/jpeg', extension: 'jpg' },
  '.gif': { kind: 'image', mimeType: 'image/gif', extension: 'gif' },
  '.webp': { kind: 'image', mimeType: 'image/webp', extension: 'webp' },
  '.bmp': { kind: 'image', mimeType: 'image/bmp', extension: 'bmp' },
  '.avif': { kind: 'image', mimeType: 'image/avif', extension: 'avif' },
  '.svg': { kind: 'image', mimeType: 'image/svg+xml', extension: 'svg' },
  '.mp4': { kind: 'video', mimeType: 'video/mp4', extension: 'mp4' },
  '.m4v': { kind: 'video', mimeType: 'video/mp4', extension: 'm4v' },
  '.mov': { kind: 'video', mimeType: 'video/quicktime', extension: 'mov' },
  '.webm': { kind: 'video', mimeType: 'video/webm', extension: 'webm' },
  '.avi': { kind: 'video', mimeType: 'video/x-msvideo', extension: 'avi' },
  '.mkv': { kind: 'video', mimeType: 'video/x-matroska', extension: 'mkv' },
  // Professional and broadcast containers; decoding is decided by the consumer's own probe.
  '.mxf': { kind: 'video', mimeType: 'application/mxf', extension: 'mxf' },
  '.mpg': { kind: 'video', mimeType: 'video/mpeg', extension: 'mpg' },
  '.mpeg': { kind: 'video', mimeType: 'video/mpeg', extension: 'mpeg' },
  '.m2ts': { kind: 'video', mimeType: 'video/mp2t', extension: 'm2ts' },
  '.mts': { kind: 'video', mimeType: 'video/mp2t', extension: 'mts' },
  '.mp3': { kind: 'audio', mimeType: 'audio/mpeg', extension: 'mp3' },
  '.wav': { kind: 'audio', mimeType: 'audio/wav', extension: 'wav' },
  '.flac': { kind: 'audio', mimeType: 'audio/flac', extension: 'flac' },
  '.ogg': { kind: 'audio', mimeType: 'audio/ogg', extension: 'ogg' },
  '.m4a': { kind: 'audio', mimeType: 'audio/mp4', extension: 'm4a' },
  '.aac': { kind: 'audio', mimeType: 'audio/aac', extension: 'aac' },
  '.opus': { kind: 'audio', mimeType: 'audio/opus', extension: 'opus' },
  '.pcm': { kind: 'audio', mimeType: 'audio/pcm', extension: 'pcm', durationProbe: 'optional' },
}

/** 助手导入由实际解析器补齐专业格式，不改变界面和字节导入的格式表。 */
export const IMPORT_EXTENSION_FORMATS: Readonly<Record<string, DetectedMediaFormat>> = {
  ...EXTENSION_FORMATS,
  '.wmv': { kind: 'video', mimeType: 'video/x-ms-wmv', extension: 'wmv' },
  '.flv': { kind: 'video', mimeType: 'video/x-flv', extension: 'flv' },
  '.3gp': { kind: 'video', mimeType: 'video/3gpp', extension: '3gp' },
  '.ts': { kind: 'video', mimeType: 'video/mp2t', extension: 'ts' },
  '.aiff': { kind: 'audio', mimeType: 'audio/aiff', extension: 'aiff' },
  '.aif': { kind: 'audio', mimeType: 'audio/aiff', extension: 'aif' },
  '.wma': { kind: 'audio', mimeType: 'audio/x-ms-wma', extension: 'wma' },
  '.tif': { kind: 'image', mimeType: 'image/tiff', extension: 'tif' },
  '.tiff': { kind: 'image', mimeType: 'image/tiff', extension: 'tiff' },
  '.heic': { kind: 'image', mimeType: 'image/heic', extension: 'heic' },
  '.heif': { kind: 'image', mimeType: 'image/heif', extension: 'heif' },
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return Buffer.from(bytes.subarray(offset, offset + length)).toString('ascii')
}

export function detectBySignature(bytes: Uint8Array, extensionHint: string, includeImportFormats = false): DetectedMediaFormat | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return EXTENSION_FORMATS['.png']
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return EXTENSION_FORMATS['.jpg']
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return EXTENSION_FORMATS['.gif']
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return EXTENSION_FORMATS['.webp']
  if (ascii(bytes, 0, 2) === 'BM') return EXTENSION_FORMATS['.bmp']
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4).toLowerCase()
    if (brand === 'avif' || brand === 'avis') return EXTENSION_FORMATS['.avif']
    if (includeImportFormats && ['heic', 'heix', 'hevc', 'hevx', 'mif1', 'msf1'].includes(brand)) return IMPORT_EXTENSION_FORMATS[extensionHint === '.heic' ? '.heic' : '.heif']
    if (extensionHint === '.m4a' || brand.startsWith('m4a')) return EXTENSION_FORMATS['.m4a']
    if (extensionHint === '.mov' || brand === 'qt  ') return EXTENSION_FORMATS['.mov']
    return EXTENSION_FORMATS['.mp4']
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return extensionHint === '.mkv' ? EXTENSION_FORMATS['.mkv'] : EXTENSION_FORMATS['.webm']
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'AVI ') return EXTENSION_FORMATS['.avi']
  // MXF header partition pack: SMPTE universal label prefix.
  if (startsWith(bytes, [0x06, 0x0e, 0x2b, 0x34])) return EXTENSION_FORMATS['.mxf']
  // MPEG program stream pack header, or an MPEG-1/2 video sequence header.
  if (startsWith(bytes, [0x00, 0x00, 0x01, 0xba]) || startsWith(bytes, [0x00, 0x00, 0x01, 0xb3])) {
    return extensionHint === '.mpeg' ? EXTENSION_FORMATS['.mpeg'] : EXTENSION_FORMATS['.mpg']
  }
  // MPEG transport stream: sync byte per 188-byte packet, or after the 4-byte timestamp of 192-byte BDAV packets.
  if ((extensionHint === '.m2ts' || extensionHint === '.mts') && (bytes[0] === 0x47 || bytes[4] === 0x47)) return EXTENSION_FORMATS[extensionHint]
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return EXTENSION_FORMATS['.wav']
  if (ascii(bytes, 0, 4) === 'fLaC') return EXTENSION_FORMATS['.flac']
  if (ascii(bytes, 0, 4) === 'OggS') return extensionHint === '.opus' ? EXTENSION_FORMATS['.opus'] : EXTENSION_FORMATS['.ogg']
  if (bytes[0] === 0xff && (bytes[1] === 0xf1 || bytes[1] === 0xf9)) return EXTENSION_FORMATS['.aac']
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return EXTENSION_FORMATS['.mp3']
  if (extensionHint === '.svg' && Buffer.from(bytes).toString('utf8').toLowerCase().includes('<svg')) return EXTENSION_FORMATS['.svg']
  if (extensionHint === '.pcm' && bytes.byteLength > 0) return EXTENSION_FORMATS['.pcm']
  return null
}

export function detectMediaFormat(bytes: Uint8Array, fileName: string, options: { allowRawPcm?: boolean } = {}): DetectedMediaFormat {
  const extensionHint = path.extname(fileName).toLowerCase()
  const detected = detectBySignature(bytes, extensionHint)
  const expected = EXTENSION_FORMATS[extensionHint]
  if (!detected || !expected || detected.kind !== expected.kind || (detected.extension === 'pcm' && options.allowRawPcm === false)) {
    throw new Error('Unsupported or disguised media file')
  }
  return detected
}
