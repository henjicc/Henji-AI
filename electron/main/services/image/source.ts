import fs from 'node:fs/promises'
import path from 'node:path'
import { extensionFromMime, mimeFromExtension, normalizeExtension } from './path-utils'
import type { ImageBytes } from './types'

const FILE_URL_PREFIX = 'file://'
const HENJI_MEDIA_PREFIX = 'henji-media://local/'

export function decodeFileUrlPath(value: string): string {
  const raw = value.trim().replace(/^file:\/\//, '')
  const decoded = decodeURIComponent(raw)
  return process.platform === 'win32' && /^\/[A-Za-z]:/.test(decoded) ? decoded.slice(1) : decoded
}

export function decodeHenjiMediaPath(value: string): string {
  const encoded = value.trim().slice(HENJI_MEDIA_PREFIX.length)
  return decodeURIComponent(encoded)
}

export function normalizeLocalSource(source: string): string {
  const trimmed = source.trim()
  if (trimmed.startsWith(FILE_URL_PREFIX)) return decodeFileUrlPath(trimmed)
  if (trimmed.startsWith(HENJI_MEDIA_PREFIX)) return decodeHenjiMediaPath(trimmed)
  return trimmed
}

export function isLocalSource(source: string): boolean {
  const trimmed = source.trim()
  return trimmed.startsWith(FILE_URL_PREFIX) ||
    trimmed.startsWith(HENJI_MEDIA_PREFIX) ||
    /^(?:[A-Za-z]:[\\/]|\\\\|\/)/.test(trimmed)
}

export async function resolveSourceBytes(source: string): Promise<ImageBytes> {
  const trimmed = source.trim()
  if (!trimmed) throw new Error('Image source is empty')
  if (trimmed.startsWith('data:')) return parseDataUrl(trimmed)
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return await readRemote(trimmed)
  return await readLocal(normalizeLocalSource(trimmed))
}

function parseDataUrl(source: string): ImageBytes {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(source)
  if (!match) throw new Error('Only base64 data URL is supported')
  return {
    bytes: Buffer.from(match[2], 'base64'),
    extension: extensionFromMime(match[1]),
  }
}

async function readRemote(source: string): Promise<ImageBytes> {
  const response = await fetch(source)
  if (!response.ok) {
    throw new Error(`Remote image request failed with status ${response.status}`)
  }
  const bytes = Buffer.from(await response.arrayBuffer())
  const contentType = response.headers.get('content-type') ?? undefined
  const fallbackExt = path.extname(new URL(source).pathname).replace(/^\./, '')
  return {
    bytes,
    extension: contentType ? extensionFromMime(contentType) : normalizeExtension(fallbackExt),
  }
}

async function readLocal(localPath: string): Promise<ImageBytes> {
  const bytes = await fs.readFile(localPath)
  return {
    bytes,
    extension: normalizeExtension(path.extname(localPath)),
  }
}

export function toDataUrl(bytes: Buffer, extension: string): string {
  return `data:${mimeFromExtension(extension)};base64,${bytes.toString('base64')}`
}
