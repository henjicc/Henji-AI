import { lookup } from 'node:dns/promises'
import fsp from 'node:fs/promises'
import { BlockList, isIP } from 'node:net'
import path from 'node:path'

import { createMainLogger } from '../../logging'
import type { SourceProvider } from '../contracts'
import type { ContentAddressedResourceStore, PutResourceResult } from '../resource-store'
import type {
  ImageEditorV3SourceIngestLimits,
  ImageEditorV3SourceIngestResult,
  ImageEditorV3SourceLocator,
} from './contracts'
import {
  fetchPinnedHttpSource,
  type PinnedHttpFetchContext,
} from './pinned-http-fetch'
import {
  createRemoteDeadlineSignal,
  raceWithSourceIngestSignal,
  streamRemoteResponseChunks,
  throwIfSourceIngestAborted,
} from './remote-timeouts'
import { assertImageEditorV3ReleaseSource } from './release-source-capabilities'

const logger = createMainLogger('main.image_editor_v3.source_ingest')
const MAX_SOURCE_URL_CHARACTERS = 8_192
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308])
const IMAGE_MEDIA_TYPE_PATTERN = /^image\/[a-z0-9][a-z0-9.+-]{0,63}$/
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
const RELEASE_IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export const IMAGE_EDITOR_V3_SOURCE_INGEST_LIMITS: ImageEditorV3SourceIngestLimits = {
  localMaxBytes: 8 * 1024 * 1024 * 1024,
  remoteMaxBytes: 2 * 1024 * 1024 * 1024,
  dataUrlMaxBytes: 32 * 1024 * 1024,
  maxRedirects: 5,
  remoteConnectTimeoutMs: 10_000,
  remoteResponseHeadersTimeoutMs: 20_000,
  remoteBodyIdleTimeoutMs: 30_000,
  remoteTotalTimeoutMs: 30 * 60_000,
}

export const IMAGE_EDITOR_V3_MAX_DATA_URL_CHARACTERS = (
  Math.ceil(IMAGE_EDITOR_V3_SOURCE_INGEST_LIMITS.dataUrlMaxBytes / 3) * 4 + 128
)

type FetchSource = (
  input: string,
  init: RequestInit,
  context: PinnedHttpFetchContext,
) => Promise<Response>
type ResolveHostname = (hostname: string) => Promise<readonly string[]>

const BLOCKED_REMOTE_ADDRESSES = new BlockList()

for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  BLOCKED_REMOTE_ADDRESSES.addSubnet(network, prefix, 'ipv4')
}

for (const [network, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:2::', 48],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_REMOTE_ADDRESSES.addSubnet(network, prefix, 'ipv6')
}

export interface ImageEditorV3SourceIngestorOptions {
  fetchSource?: FetchSource
  limits?: Partial<ImageEditorV3SourceIngestLimits>
  resolveHostname?: ResolveHostname
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${field} must be a positive safe integer`)
  return value
}

function nonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${field} must be a non-negative safe integer`)
  return value
}

function normalizeLimits(overrides: Partial<ImageEditorV3SourceIngestLimits> = {}): ImageEditorV3SourceIngestLimits {
  return {
    localMaxBytes: positiveSafeInteger(
      overrides.localMaxBytes ?? IMAGE_EDITOR_V3_SOURCE_INGEST_LIMITS.localMaxBytes,
      'localMaxBytes',
    ),
    remoteMaxBytes: positiveSafeInteger(
      overrides.remoteMaxBytes ?? IMAGE_EDITOR_V3_SOURCE_INGEST_LIMITS.remoteMaxBytes,
      'remoteMaxBytes',
    ),
    dataUrlMaxBytes: positiveSafeInteger(
      overrides.dataUrlMaxBytes ?? IMAGE_EDITOR_V3_SOURCE_INGEST_LIMITS.dataUrlMaxBytes,
      'dataUrlMaxBytes',
    ),
    maxRedirects: nonNegativeSafeInteger(
      overrides.maxRedirects ?? IMAGE_EDITOR_V3_SOURCE_INGEST_LIMITS.maxRedirects,
      'maxRedirects',
    ),
    remoteConnectTimeoutMs: positiveSafeInteger(
      overrides.remoteConnectTimeoutMs ?? IMAGE_EDITOR_V3_SOURCE_INGEST_LIMITS.remoteConnectTimeoutMs,
      'remoteConnectTimeoutMs',
    ),
    remoteResponseHeadersTimeoutMs: positiveSafeInteger(
      overrides.remoteResponseHeadersTimeoutMs
        ?? IMAGE_EDITOR_V3_SOURCE_INGEST_LIMITS.remoteResponseHeadersTimeoutMs,
      'remoteResponseHeadersTimeoutMs',
    ),
    remoteBodyIdleTimeoutMs: positiveSafeInteger(
      overrides.remoteBodyIdleTimeoutMs ?? IMAGE_EDITOR_V3_SOURCE_INGEST_LIMITS.remoteBodyIdleTimeoutMs,
      'remoteBodyIdleTimeoutMs',
    ),
    remoteTotalTimeoutMs: positiveSafeInteger(
      overrides.remoteTotalTimeoutMs ?? IMAGE_EDITOR_V3_SOURCE_INGEST_LIMITS.remoteTotalTimeoutMs,
      'remoteTotalTimeoutMs',
    ),
  }
}

function normalizedHostname(url: URL): string {
  return url.hostname.startsWith('[') && url.hostname.endsWith(']')
    ? url.hostname.slice(1, -1)
    : url.hostname
}

function assertPublicRemoteAddress(address: string): void {
  const family = isIP(address)
  if (family === 0) throw new Error('Remote image hostname resolved to an invalid IP address')
  if (BLOCKED_REMOTE_ADDRESSES.check(address, family === 4 ? 'ipv4' : 'ipv6')) {
    throw new Error('Remote image URL resolves to a private, local, or reserved address')
  }
}

async function defaultResolveHostname(hostname: string): Promise<readonly string[]> {
  const literalFamily = isIP(hostname)
  if (literalFamily !== 0) return [hostname]
  const resolved = await lookup(hostname, { all: true, verbatim: true })
  return resolved.map((entry) => entry.address)
}

function mediaTypeFromPathname(pathname: string): string | undefined {
  switch (path.extname(pathname).toLowerCase()) {
    case '.png': return 'image/png'
    case '.jpg':
    case '.jpeg': return 'image/jpeg'
    case '.webp': return 'image/webp'
    default: return undefined
  }
}

function normalizeImageMediaType(raw: string | null, fallback?: string): string | undefined {
  const normalized = raw?.split(';', 1)[0]?.trim().toLowerCase()
  if (!normalized || normalized === 'application/octet-stream') return fallback
  if (!IMAGE_MEDIA_TYPE_PATTERN.test(normalized) || normalized === 'image/svg+xml') {
    throw new Error(`Remote source is not a supported raster image: ${normalized}`)
  }
  if (!RELEASE_IMAGE_MEDIA_TYPES.has(normalized)) {
    throw new Error(`当前新版编辑器仅支持 JPEG、PNG 和 WebP：${normalized}`)
  }
  return normalized
}

function parseHttpUrl(raw: string, base?: URL): URL {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_SOURCE_URL_CHARACTERS) {
    throw new Error('Invalid image source URL length')
  }
  let parsed: URL
  try {
    parsed = base ? new URL(raw, base) : new URL(raw)
  } catch {
    throw new Error('Invalid image source URL')
  }
  if ((parsed.protocol !== 'http:' && parsed.protocol !== 'https:') || parsed.username || parsed.password) {
    throw new Error('Image source URL must use HTTP(S) without embedded credentials')
  }
  return parsed
}

function readContentLength(response: Response, maxBytes: number): void {
  const raw = response.headers.get('content-length')
  if (raw === null) return
  if (!/^\d+$/.test(raw)) throw new Error('Remote image has an invalid Content-Length')
  const length = Number(raw)
  if (!Number.isSafeInteger(length)) throw new Error('Remote image Content-Length is not safely representable')
  if (length > maxBytes) throw new Error(`Remote image exceeds maximum byte length of ${maxBytes}`)
}

async function cancelResponseBody(response: Response, signal?: AbortSignal): Promise<void> {
  const cancellation = response.body?.cancel()
  if (!cancellation) return
  await raceWithSourceIngestSignal(cancellation.catch(() => undefined), signal)
}

function parseDataUrl(raw: string, maxBytes: number): { bytes: Buffer; mediaType: string } {
  if (!raw.startsWith('data:')) throw new Error('Invalid image data URL')
  const separator = raw.indexOf(',')
  if (separator < 0) throw new Error('Invalid image data URL')
  const header = raw.slice(5, separator)
  const payload = raw.slice(separator + 1)
  const match = /^([^;,]+);base64$/i.exec(header)
  if (
    !match
    || !IMAGE_MEDIA_TYPE_PATTERN.test(match[1].toLowerCase())
    || !RELEASE_IMAGE_MEDIA_TYPES.has(match[1].toLowerCase())
  ) {
    throw new Error('Image data URL must contain a supported raster MIME type and canonical base64')
  }
  if (!payload || payload.length > Math.ceil(maxBytes / 3) * 4 + 4 || !BASE64_PATTERN.test(payload)) {
    throw new Error('Image data URL contains invalid or oversized base64')
  }
  const padding = payload.endsWith('==') ? 2 : payload.endsWith('=') ? 1 : 0
  const decodedLength = (payload.length / 4) * 3 - padding
  if (!Number.isSafeInteger(decodedLength) || decodedLength > maxBytes) {
    throw new Error(`Image data URL exceeds maximum byte length of ${maxBytes}`)
  }
  const bytes = Buffer.from(payload, 'base64')
  if (bytes.byteLength !== decodedLength) throw new Error('Image data URL base64 is not canonical')
  return { bytes, mediaType: match[1].toLowerCase() }
}

export class ImageEditorV3SourceIngestor {
  private readonly fetchSource: FetchSource
  private readonly limits: ImageEditorV3SourceIngestLimits
  private readonly resolveHostname: ResolveHostname

  constructor(
    private readonly resources: ContentAddressedResourceStore,
    private readonly sources: SourceProvider,
    options: ImageEditorV3SourceIngestorOptions = {},
  ) {
    this.fetchSource = options.fetchSource ?? fetchPinnedHttpSource
    this.limits = normalizeLimits(options.limits)
    this.resolveHostname = options.resolveHostname ?? defaultResolveHostname
  }

  async ingest(locator: ImageEditorV3SourceLocator, signal?: AbortSignal): Promise<ImageEditorV3SourceIngestResult> {
    throwIfSourceIngestAborted(signal)
    const remoteDeadline = locator.kind === 'http-url'
      ? createRemoteDeadlineSignal(signal, this.limits.remoteTotalTimeoutMs)
      : undefined
    const operationSignal = remoteDeadline?.signal ?? signal
    logger.info('图片编辑 V3 图片源导入开始', {
      event: 'image_editor_v3.source_ingest.start',
      context: { kind: locator.kind },
    })
    try {
      const stored = locator.kind === 'local-path'
        ? await this.ingestLocal(locator.filePath, operationSignal)
        : locator.kind === 'http-url'
          ? await this.ingestRemote(locator.url, operationSignal)
          : await this.ingestDataUrl(locator.dataUrl, operationSignal)
      const lease = await this.resources.acquireLease([stored.id])
      const metadata = await (async () => {
        try {
          return await raceWithSourceIngestSignal(
            this.sources.readMetadata(stored.id, operationSignal),
            operationSignal,
          )
        } finally {
          await lease.release()
        }
      })()
      assertImageEditorV3ReleaseSource(metadata)
      logger.info('图片编辑 V3 图片源导入完成', {
        event: 'image_editor_v3.source_ingest.completed',
        context: {
          kind: locator.kind,
          resourceId: stored.id,
          byteLength: stored.byteLength,
          width: metadata.width,
          height: metadata.height,
        },
      })
      return { resource: stored, metadata }
    } catch (error) {
      const cancelled = error instanceof Error && error.name === 'AbortError'
      const log = cancelled ? logger.info.bind(logger) : logger.error.bind(logger)
      log(cancelled ? '图片编辑 V3 图片源导入已取消' : '图片编辑 V3 图片源导入失败', {
        event: 'image_editor_v3.source_ingest.failed',
        ...(cancelled ? {} : { error }),
        context: { kind: locator.kind },
      })
      throw error
    } finally {
      remoteDeadline?.dispose()
    }
  }

  private async ingestLocal(filePath: string, signal?: AbortSignal): Promise<PutResourceResult> {
    if (!path.isAbsolute(filePath) || filePath.includes('\0')) throw new Error('Local image path must be absolute')
    const resolved = await fsp.realpath(filePath)
    const stats = await fsp.stat(resolved)
    if (!stats.isFile()) throw new Error('Local image source is not a regular file')
    if (stats.size > this.limits.localMaxBytes) {
      throw new Error(`Local image exceeds maximum byte length of ${this.limits.localMaxBytes}`)
    }
    throwIfSourceIngestAborted(signal)
    return this.resources.putFile(resolved, {
      mediaType: mediaTypeFromPathname(resolved),
      maxBytes: this.limits.localMaxBytes,
      signal,
    })
  }

  private async ingestRemote(rawUrl: string, signal?: AbortSignal): Promise<PutResourceResult> {
    let current = parseHttpUrl(rawUrl)
    for (let redirects = 0; redirects <= this.limits.maxRedirects; redirects += 1) {
      throwIfSourceIngestAborted(signal)
      const hostname = normalizedHostname(current)
      if (hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost')) {
        throw new Error('Remote image URL resolves to a private, local, or reserved address')
      }
      const addresses = await raceWithSourceIngestSignal(this.resolveHostname(hostname), signal)
      throwIfSourceIngestAborted(signal)
      if (addresses.length === 0) throw new Error('Remote image hostname did not resolve to an address')
      for (const address of addresses) assertPublicRemoteAddress(address)
      const responseOperation = this.fetchSource(current.href, {
        method: 'GET',
        redirect: 'manual',
        signal,
        headers: { Accept: 'image/webp,image/png,image/jpeg' },
      }, {
        resolvedAddresses: addresses,
        connectTimeoutMs: this.limits.remoteConnectTimeoutMs,
        responseHeadersTimeoutMs: this.limits.remoteResponseHeadersTimeoutMs,
      })
      void responseOperation.then((lateResponse) => {
        if (signal?.aborted) void lateResponse.body?.cancel().catch(() => undefined)
      }, () => undefined)
      const response = await raceWithSourceIngestSignal(responseOperation, signal)
      if (REDIRECT_STATUS.has(response.status)) {
        await cancelResponseBody(response, signal)
        if (redirects === this.limits.maxRedirects) throw new Error('Remote image exceeded redirect limit')
        const location = response.headers.get('location')
        if (!location) throw new Error('Remote image redirect is missing Location')
        current = parseHttpUrl(location, current)
        continue
      }
      if (!response.ok) {
        await cancelResponseBody(response, signal)
        throw new Error(`Remote image request failed with status ${response.status}`)
      }
      let mediaType: string | undefined
      try {
        readContentLength(response, this.limits.remoteMaxBytes)
        mediaType = normalizeImageMediaType(
          response.headers.get('content-type'),
          mediaTypeFromPathname(current.pathname),
        )
      } catch (error) {
        await cancelResponseBody(response, signal)
        throw error
      }
      return this.resources.putReadable(
        streamRemoteResponseChunks(
          response,
          this.limits.remoteMaxBytes,
          this.limits.remoteBodyIdleTimeoutMs,
          signal,
        ),
        { mediaType, maxBytes: this.limits.remoteMaxBytes, signal },
      )
    }
    throw new Error('Remote image exceeded redirect limit')
  }

  private async ingestDataUrl(dataUrl: string, signal?: AbortSignal): Promise<PutResourceResult> {
    if (dataUrl.length > Math.ceil(this.limits.dataUrlMaxBytes / 3) * 4 + 128) {
      throw new Error('Image data URL exceeds encoded length limit')
    }
    const decoded = parseDataUrl(dataUrl, this.limits.dataUrlMaxBytes)
    throwIfSourceIngestAborted(signal)
    return this.resources.putBuffer(decoded.bytes, {
      mediaType: decoded.mediaType,
      maxBytes: this.limits.dataUrlMaxBytes,
      signal,
    })
  }
}
