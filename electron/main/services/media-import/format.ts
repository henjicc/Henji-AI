import path from 'node:path'

import type { LocalMediaKind } from '../../../../src/core/media/localMediaImportContracts'

export interface DetectedMediaFormat {
  kind: LocalMediaKind
  mimeType: string
  extension: string
}

const EXTENSION_FORMATS: Record<string, DetectedMediaFormat> = {
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
  '.mp3': { kind: 'audio', mimeType: 'audio/mpeg', extension: 'mp3' },
  '.wav': { kind: 'audio', mimeType: 'audio/wav', extension: 'wav' },
  '.flac': { kind: 'audio', mimeType: 'audio/flac', extension: 'flac' },
  '.ogg': { kind: 'audio', mimeType: 'audio/ogg', extension: 'ogg' },
  '.m4a': { kind: 'audio', mimeType: 'audio/mp4', extension: 'm4a' },
  '.aac': { kind: 'audio', mimeType: 'audio/aac', extension: 'aac' },
  '.opus': { kind: 'audio', mimeType: 'audio/opus', extension: 'opus' },
  '.pcm': { kind: 'audio', mimeType: 'audio/pcm', extension: 'pcm' },
}

function startsWith(bytes: Uint8Array, signature: number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value)
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  return Buffer.from(bytes.subarray(offset, offset + length)).toString('ascii')
}

function detectBySignature(bytes: Uint8Array, extensionHint: string): DetectedMediaFormat | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return EXTENSION_FORMATS['.png']
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return EXTENSION_FORMATS['.jpg']
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return EXTENSION_FORMATS['.gif']
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return EXTENSION_FORMATS['.webp']
  if (ascii(bytes, 0, 2) === 'BM') return EXTENSION_FORMATS['.bmp']
  if (ascii(bytes, 4, 4) === 'ftyp') {
    const brand = ascii(bytes, 8, 4).toLowerCase()
    if (brand === 'avif' || brand === 'avis') return EXTENSION_FORMATS['.avif']
    if (extensionHint === '.m4a' || brand.startsWith('m4a')) return EXTENSION_FORMATS['.m4a']
    if (extensionHint === '.mov' || brand === 'qt  ') return EXTENSION_FORMATS['.mov']
    return EXTENSION_FORMATS['.mp4']
  }
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return extensionHint === '.mkv' ? EXTENSION_FORMATS['.mkv'] : EXTENSION_FORMATS['.webm']
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'AVI ') return EXTENSION_FORMATS['.avi']
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WAVE') return EXTENSION_FORMATS['.wav']
  if (ascii(bytes, 0, 4) === 'fLaC') return EXTENSION_FORMATS['.flac']
  if (ascii(bytes, 0, 4) === 'OggS') return extensionHint === '.opus' ? EXTENSION_FORMATS['.opus'] : EXTENSION_FORMATS['.ogg']
  if (bytes[0] === 0xff && (bytes[1] === 0xf1 || bytes[1] === 0xf9)) return EXTENSION_FORMATS['.aac']
  if (ascii(bytes, 0, 3) === 'ID3' || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return EXTENSION_FORMATS['.mp3']
  if (extensionHint === '.svg' && Buffer.from(bytes).toString('utf8').toLowerCase().includes('<svg')) return EXTENSION_FORMATS['.svg']
  if (extensionHint === '.pcm' && bytes.byteLength > 0) return EXTENSION_FORMATS['.pcm']
  return null
}

export function detectMediaFormat(bytes: Uint8Array, fileName: string): DetectedMediaFormat {
  const extensionHint = path.extname(fileName).toLowerCase()
  const detected = detectBySignature(bytes, extensionHint)
  const expected = EXTENSION_FORMATS[extensionHint]
  if (!detected || !expected || detected.kind !== expected.kind) {
    throw new Error('Unsupported or disguised media file')
  }
  return detected
}
