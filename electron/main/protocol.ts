import { app, protocol } from 'electron'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Readable } from 'node:stream'
import { CONTENT_ADDRESSED_FOLDER_NAMES } from './services/appPaths'
import {
  IMAGE_EDITOR_V3_MEDIA_HOST,
  resolveImageEditorV3ResourceMediaUrl,
} from './services/image-editor-v3/resource-media-url'
import { normalizeMediaImportPath } from '../../src/core/media/localMediaImportSafety'
import { AUTHOR_LIBRARY_HOST } from '../../src/core/videoEdit/codeMaterial/authorLibraries'

const MEDIA_SCHEME = 'henji-media'
const MEDIA_HOST = 'local'

interface ByteRange {
  start: number
  end: number
}

interface MediaRequestTarget {
  targetPath: string
  mediaType?: string
  immutable?: boolean
  /** 渲染 Worker 跨协议加载模块与 fetch 资源（wasm、json）都需要放行。 */
  crossOrigin?: boolean
}

class MediaProtocolError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'MediaProtocolError'
    this.status = status
  }
}

export function inferMimeFromPath(targetPath: string): string {
  const lower = targetPath.toLowerCase()
  if (lower.endsWith('.mjs') || lower.endsWith('.js')) return 'text/javascript'
  if (lower.endsWith('.wasm')) return 'application/wasm'
  if (lower.endsWith('.json')) return 'application/json'
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.gif')) return 'image/gif'
  if (lower.endsWith('.bmp')) return 'image/bmp'
  if (lower.endsWith('.svg')) return 'image/svg+xml'
  if (lower.endsWith('.avif')) return 'image/avif'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mov')) return 'video/quicktime'
  if (lower.endsWith('.avi')) return 'video/x-msvideo'
  if (lower.endsWith('.mkv')) return 'video/x-matroska'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.flac')) return 'audio/flac'
  if (lower.endsWith('.ogg')) return 'audio/ogg'
  if (lower.endsWith('.m4a')) return 'audio/mp4'
  if (lower.endsWith('.aac')) return 'audio/aac'
  if (lower.endsWith('.opus')) return 'audio/opus'
  if (lower.endsWith('.pcm')) return 'audio/pcm'
  if (lower.endsWith('.glb')) return 'model/gltf-binary'
  if (lower.endsWith('.gltf')) return 'model/gltf+json'
  return 'application/octet-stream'
}

function assertValidMediaPath(targetPath: string): void {
  if (!targetPath.trim()) {
    throw new MediaProtocolError(400, 'Media path cannot be empty')
  }
  if (targetPath.includes('\0')) {
    throw new MediaProtocolError(400, 'Media path contains invalid null byte')
  }
  try { normalizeMediaImportPath(targetPath, process.platform === 'win32') }
  catch (error) { throw new MediaProtocolError(400, error instanceof Error ? error.message : 'Invalid media path') }
}

function resolveMediaRequestTarget(url: string): MediaRequestTarget {
  const parsed = new URL(url)
  if (parsed.protocol !== `${MEDIA_SCHEME}:`) {
    throw new MediaProtocolError(400, 'Unsupported media URL')
  }

  if (parsed.hostname === IMAGE_EDITOR_V3_MEDIA_HOST) {
    try {
      const resolved = resolveImageEditorV3ResourceMediaUrl(parsed)
      return { ...resolved, immutable: true }
    } catch (error) {
      throw new MediaProtocolError(
        400,
        error instanceof Error ? error.message : 'Invalid image editor media URL',
      )
    }
  }

  if (parsed.hostname !== MEDIA_HOST) throw new MediaProtocolError(400, 'Unsupported media URL')

  const encodedPath = parsed.pathname.startsWith('/') ? parsed.pathname.slice(1) : parsed.pathname
  return { targetPath: decodeURIComponent(encodedPath) }
}

function authorLibraryRoot(): string {
  return path.join(app.isPackaged ? process.resourcesPath : app.getAppPath(), 'resources', 'author-libs')
}

/**
 * author-lib 命名空间定位随包资源，路径段保持相对定位语义；目录链接照常跟随。
 * 文件按版本目录常驻、内容不变，可长期缓存。
 */
async function resolveAuthorLibraryTarget(parsed: URL): Promise<MediaRequestTarget> {
  if (parsed.username || parsed.password || parsed.port || parsed.search) {
    throw new MediaProtocolError(400, 'Unsupported author library URL')
  }
  let segments: string[]
  try {
    segments = parsed.pathname.split('/').slice(1).map((segment) => decodeURIComponent(segment))
  } catch {
    throw new MediaProtocolError(400, 'Invalid author library path')
  }
  if (!segments.length || segments.some((segment) => !segment || segment === '.' || segment === '..' || /[\\/:\0]/.test(segment))) {
    throw new MediaProtocolError(400, 'Invalid author library path')
  }
  let rootPath: string
  let targetPath: string
  try {
    rootPath = await fsp.realpath(authorLibraryRoot())
    targetPath = await fsp.realpath(path.join(rootPath, ...segments))
  } catch {
    throw new MediaProtocolError(404, 'Not found')
  }
    return { targetPath, immutable: true, crossOrigin: true }
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

/**
 * 生成结果/上传素材/缩略图目录下的文件名是内容哈希派生的，同路径不会被替换成不同内容，
 * 可以放心长期缓存；其他来源（用户原文件）路径可能被外部编辑，保持不缓存。
 */
function isContentAddressedPath(targetPath: string): boolean {
  const segments = targetPath.split(/[\\/]/)
  return segments.some((segment) => CONTENT_ADDRESSED_FOLDER_NAMES.has(segment))
}

function createHeaders(
  targetPath: string,
  size: number,
  range: ByteRange | null,
  mediaType?: string,
  immutable = false,
  crossOrigin = false,
): Headers {
  const headers = new Headers()
  headers.set('Accept-Ranges', 'bytes')
  headers.set('Content-Type', mediaType ?? inferMimeFromPath(targetPath))
  headers.set('X-Content-Type-Options', 'nosniff')
  // 作者模块由本地文件提供，渲染 Worker 可跨协议原生加载循环 ESM 图。
  if (crossOrigin || inferMimeFromPath(targetPath) === 'text/javascript') headers.set('Access-Control-Allow-Origin', '*')
  headers.set(
    'Cache-Control',
    immutable || isContentAddressedPath(targetPath)
      ? 'public, max-age=31536000, immutable'
      : 'no-store'
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
  // 作者库的失败响应也要放行跨源，否则 Worker 只看到 CORS 拒绝，看不到 404/403 的真实原因。
  let crossOrigin = false
  const failure = (body: string, status: number): Response => new Response(body, { status, headers: crossOrigin ? { 'Access-Control-Allow-Origin': '*' } : {} })
  try {
    const parsed = new URL(request.url)
    let target: MediaRequestTarget
    if (parsed.protocol === `${MEDIA_SCHEME}:` && parsed.hostname === AUTHOR_LIBRARY_HOST) {
      crossOrigin = true
      if (request.method !== 'GET' && request.method !== 'HEAD') return failure('Method not allowed', 405)
      target = await resolveAuthorLibraryTarget(parsed)
    } else {
      target = resolveMediaRequestTarget(request.url)
      assertValidMediaPath(target.targetPath)
    }
    const { targetPath } = target

    const stat = await fsp.stat(targetPath)
    if (!stat.isFile()) {
      return failure('Not found', 404)
    }

    const range = parseRangeHeader(request.headers.get('range'), stat.size)
    const headers = createHeaders(targetPath, stat.size, range, target.mediaType, target.immutable, target.crossOrigin)
    const status = range ? 206 : 200

    if (request.method === 'HEAD') {
      return new Response(null, { status, headers })
    }

    return new Response(streamFile(targetPath, range), { status, headers })
  } catch (error) {
    if (error instanceof MediaProtocolError) {
      return failure(error.message, error.status)
    }
    return failure('Not found', 404)
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
        // 内置作者库与作者模块是常驻 JS，V8 代码缓存省掉重复编译。
        codeCache: true,
      },
    },
  ])
}

export function registerMediaProtocolHandler(): void {
  protocol.handle(MEDIA_SCHEME, handleMediaRequest)
}
