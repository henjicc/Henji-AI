import { app, protocol } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'

const MEDIA_SCHEME = 'henji-media'
const MEDIA_HOST = 'local'
const APP_IDENTIFIER = 'com.henji.ai'
const allowedMediaRoots = new Set<string>()

interface ByteRange {
  start: number
  end: number
}

class MediaProtocolError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'MediaProtocolError'
    this.status = status
  }
}

function getBaseLocalDataDir(): string {
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, APP_IDENTIFIER)
  }

  return path.join(app.getPath('appData'), APP_IDENTIFIER)
}

function inferMimeFromPath(targetPath: string): string {
  const lower = targetPath.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.avi')) return 'video/x-msvideo'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.flac')) return 'audio/flac'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  if (lower.endsWith('.pcm')) return 'audio/pcm'
  return 'application/octet-stream'
}

function assertValidMediaPath(targetPath: string): void {
  if (!targetPath.trim()) {
    throw new MediaProtocolError(400, 'Media path cannot be empty')
  }
  if (targetPath.includes('\0')) {
    throw new MediaProtocolError(400, 'Media path contains invalid null byte')
  }
  if (!path.isAbsolute(targetPath)) {
    throw new MediaProtocolError(400, 'Media path must be absolute')
  }
}

function isInsideRoot(targetPath: string, rootPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function getAllowedMediaRoots(): string[] {
  return [
    getBaseLocalDataDir(),
    app.getPath('downloads'),
    app.getPath('temp') || os.tmpdir(),
    ...allowedMediaRoots,
  ]
}

/**
 * 不抛错的布尔版本，供渲染层在选用"直接复用原文件路径"这类快路径之前
 * 先确认 henji-media:// 协议真的能读到这个路径——否则会出现"路径有效但协议
 * 403 拒绝"的静默失败（典型表现：<video src> 既不显示缩略图也放不了）。
 */
export function isPathWithinAllowedMediaRoots(targetPath: string): boolean {
  try {
    assertValidMediaPath(targetPath)
  } catch {
    return false
  }
  return getAllowedMediaRoots().some((rootPath) => isInsideRoot(targetPath, rootPath))
}

function assertAllowedMediaPath(targetPath: string): void {
  assertValidMediaPath(targetPath)

  if (!getAllowedMediaRoots().some((rootPath) => isInsideRoot(targetPath, rootPath))) {
    throw new MediaProtocolError(403, 'Media path is outside allowed roots')
  }
}

export function allowMediaRoot(rootPath: string): void {
  assertValidMediaPath(rootPath)
  allowedMediaRoots.add(path.resolve(rootPath))
}

function decodeMediaPath(url: string): string {
  const parsed = new URL(url)
  if (parsed.protocol !== `${MEDIA_SCHEME}:` || parsed.hostname !== MEDIA_HOST) {
    throw new MediaProtocolError(400, 'Unsupported media URL')
  }

  const encodedPath = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname
  return decodeURIComponent(encodedPath)
}

function parseRangeHeader(rangeHeader: string | null, size: number): ByteRange | null {
  if (!rangeHeader) return null

  const match = /^bytes=(\d*)-(\d*)$/.exec(rangeHeader.trim())
  if (!match) {
    throw new MediaProtocolError(416, 'Invalid Range header')
  }

  const [, startValue, endValue] = match
  if (!startValue && !endValue) {
    throw new MediaProtocolError(416, 'Invalid Range header')
  }

  if (!startValue) {
    const suffixLength = Number(endValue)
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new MediaProtocolError(416, 'Invalid suffix Range header')
    }
    return {
      start: Math.max(size - suffixLength, 0),
      end: size - 1,
    }
  }

  const start = Number(startValue)
  const end = endValue ? Number(endValue) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) {
    throw new MediaProtocolError(416, 'Unsatisfiable Range header')
  }

  return {
    start,
    end: Math.min(end, size - 1),
  }
}

function streamFile(targetPath: string, range: ByteRange | null): ReadableStream<Uint8Array> {
  const stream = range
    ? fs.createReadStream(targetPath, { start: range.start, end: range.end })
    : fs.createReadStream(targetPath)

  return Readable.toWeb(stream) as ReadableStream<Uint8Array>
}

const CONTENT_ADDRESSED_DIR_NAMES = new Set(['Media', 'Thumbnails', 'Uploads'])

/**
 * Media/Thumbnails/Uploads 下的文件名是内容哈希派生的，同路径不会被替换成不同内容，
 * 可以放心长期缓存；其他来源（如用户自定义授权目录）路径可能被外部编辑，保持不缓存。
 */
function isContentAddressedPath(targetPath: string): boolean {
  const segments = targetPath.split(/[\\/]/)
  return segments.some((segment) => CONTENT_ADDRESSED_DIR_NAMES.has(segment))
}

function createHeaders(targetPath: string, size: number, range: ByteRange | null): Headers {
  const headers = new Headers()
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Content-Type', inferMimeFromPath(targetPath))
  headers.set(
    'Cache-Control',
    isContentAddressedPath(targetPath) ? 'public, max-age=31536000, immutable' : 'no-store'
  )

  if (range) {
    headers.set('Content-Length', String(range.end - range.start + 1))
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${size}`)
  } else {
    headers.set('Content-Length', String(size))
  }

  return headers
}

async function handleMediaRequest(request: Request): Promise<Response> {
  try {
    const targetPath = decodeMediaPath(request.url)
    assertAllowedMediaPath(targetPath)

    const stat = await fsp.stat(targetPath)
    if (!stat.isFile()) {
      return new Response('Not found', { status: 404 })
    }

    const range = parseRangeHeader(request.headers.get('range'), stat.size)
    const headers = createHeaders(targetPath, stat.size, range)
    const status = range ? 206 : 200

    if (request.method === 'HEAD') {
      return new Response(null, { status, headers })
    }

    return new Response(streamFile(targetPath, range), { status, headers })
  } catch (error) {
    if (error instanceof MediaProtocolError) {
      return new Response(error.message, { status: error.status })
    }
    return new Response('Not found', { status: 404 })
  }
}

export function registerMediaProtocolScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: MEDIA_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        stream: true,
        supportFetchAPI: true,
        corsEnabled: true,
      },
    },
  ])
}

export function registerMediaProtocolHandler(): void {
  protocol.handle(MEDIA_SCHEME, handleMediaRequest)
}
