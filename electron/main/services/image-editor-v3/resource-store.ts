import crypto from 'node:crypto'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { Transform, type TransformCallback } from 'node:stream'

import { createMainLogger } from '../logging'
import type { ResourceDescriptor, ResourceId, ResourceLease } from './contracts'
import { KeyedSerialExecutor } from './serial-executor'

const SHA256_PATTERN = /^[a-f0-9]{64}$/
const STALE_STAGING_AGE_MS = 24 * 60 * 60 * 1_000
const logger = createMainLogger('main.image_editor_v3.resources')

export interface PutResourceOptions {
  expectedSha256?: string
  mediaType?: string
  /** 写入过程的硬上限；在每个 chunk 落盘前检查，避免 stat/Content-Length 的竞态或谎报。 */
  maxBytes?: number
  signal?: AbortSignal
}

export interface PutResourceResult extends ResourceDescriptor {
  created: boolean
}

export interface ResourceGarbageCollectionOptions {
  minimumAgeMs?: number
  dryRun?: boolean
}

export interface ResourceGarbageCollectionResult {
  deleted: ResourceId[]
  retainedByLease: ResourceId[]
  reclaimedBytes: number
}

function abortError(): Error {
  const error = new Error('Image editor resource operation was cancelled')
  error.name = 'AbortError'
  return error
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError()
}

function normalizeExpectedHash(value?: string): string | undefined {
  if (!value) return undefined
  const normalized = value.startsWith('sha256:') ? value.slice('sha256:'.length) : value
  if (!SHA256_PATTERN.test(normalized)) throw new Error('Invalid expected SHA-256 hash')
  return normalized
}

export function parseResourceId(resourceId: ResourceId | string): string {
  if (!resourceId.startsWith('sha256:')) throw new Error(`Invalid resource id: ${resourceId}`)
  const hash = resourceId.slice('sha256:'.length)
  if (!SHA256_PATTERN.test(hash)) throw new Error(`Invalid resource id: ${resourceId}`)
  return hash
}

async function writeChunk(handle: fsp.FileHandle, chunk: Buffer, offset: number): Promise<number> {
  let cursor = 0
  while (cursor < chunk.byteLength) {
    const result = await handle.write(chunk, cursor, chunk.byteLength - cursor, offset + cursor)
    if (result.bytesWritten <= 0) throw new Error('Failed to make progress while writing resource')
    cursor += result.bytesWritten
  }
  return offset + cursor
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'EEXIST'
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

class ResourceIntegrityTransform extends Transform {
  private readonly hash = crypto.createHash('sha256')

  constructor(private readonly expectedSha256: string) {
    super()
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, callback: TransformCallback): void {
    this.hash.update(chunk)
    callback(null, chunk)
  }

  override _flush(callback: TransformCallback): void {
    const actual = this.hash.digest('hex')
    callback(actual === this.expectedSha256
      ? undefined
      : new Error(`Corrupt resource: sha256:${this.expectedSha256}`))
  }
}

async function verifyExistingObject(
  objectPath: string,
  expectedSha256: string,
  expectedBytes: number,
): Promise<boolean> {
  let handle: fsp.FileHandle | undefined
  try {
    handle = await fsp.open(objectPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const stats = await handle.stat()
    if (!stats.isFile() || stats.size !== expectedBytes) return false
    const hash = crypto.createHash('sha256')
    const stream = handle.createReadStream({ autoClose: false })
    for await (const chunk of stream) hash.update(chunk)
    return hash.digest('hex') === expectedSha256
  } catch (error) {
    if (isMissing(error) || (error instanceof Error && 'code' in error && error.code === 'ELOOP')) {
      return false
    }
    throw error
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/**
 * SHA-256 内容寻址资源库。对象落盘后不可修改；引用关系由 document repository 的
 * resourceRefs 提供，GC 仅接受调用方给出的完整 live set，避免持久层猜测业务引用。
 */
export class ContentAddressedResourceStore {
  private readonly executor = new KeyedSerialExecutor()
  private readonly leaseCounts = new Map<ResourceId, number>()
  private readonly objectsDir: string
  private readonly stagingDir: string
  private initialization: Promise<void> | undefined

  constructor(readonly rootDir: string) {
    this.objectsDir = path.join(rootDir, 'objects')
    this.stagingDir = path.join(rootDir, '.staging')
  }

  async initialize(): Promise<void> {
    if (this.initialization) return this.initialization
    const initialization = this.initializeStore()
    this.initialization = initialization
    try {
      await initialization
    } catch (error) {
      if (this.initialization === initialization) this.initialization = undefined
      throw error
    }
  }

  private async initializeStore(): Promise<void> {
    await Promise.all([
      fsp.mkdir(this.objectsDir, { recursive: true }),
      fsp.mkdir(this.stagingDir, { recursive: true }),
    ])
    const cutoff = Date.now() - STALE_STAGING_AGE_MS
    const removeIfStale = async (candidate: string): Promise<void> => {
      const stats = await fsp.lstat(candidate).catch(() => null)
      if (!stats || stats.mtimeMs > cutoff) return
      await fsp.rm(candidate, { recursive: stats.isDirectory(), force: true })
    }
    const stagingEntries = await fsp.readdir(this.stagingDir, { withFileTypes: true }).catch(() => [])
    await Promise.all(stagingEntries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.tmp'))
      .map((entry) => removeIfStale(path.join(this.stagingDir, entry.name))))
    const rootEntries = await fsp.readdir(this.rootDir, { withFileTypes: true }).catch(() => [])
    await Promise.all(rootEntries
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('.henjiimg-import-'))
      .map((entry) => removeIfStale(path.join(this.rootDir, entry.name))))
  }

  getFilesystemPath(resourceId: ResourceId): string {
    const hash = parseResourceId(resourceId)
    return path.join(this.objectsDir, hash.slice(0, 2), hash)
  }

  async has(resourceId: ResourceId): Promise<boolean> {
    return this.describe(resourceId).then(() => true).catch(() => false)
  }

  async describe(resourceId: ResourceId, mediaType?: string): Promise<ResourceDescriptor> {
    const hash = parseResourceId(resourceId)
    const handle = await fsp.open(
      this.getFilesystemPath(resourceId),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW,
    )
    try {
      const stats = await handle.stat()
      if (!stats.isFile()) throw new Error(`Resource is not a file: ${resourceId}`)
      return { id: resourceId, sha256: hash, byteLength: stats.size, mediaType }
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  async putBuffer(bytes: Uint8Array, options: PutResourceOptions = {}): Promise<PutResourceResult> {
    return this.putReadable([bytes], options)
  }

  async putFile(sourcePath: string, options: PutResourceOptions = {}): Promise<PutResourceResult> {
    throwIfAborted(options.signal)
    const sourcePathStats = await fsp.lstat(sourcePath)
    if (sourcePathStats.isSymbolicLink()) {
      throw new Error('Resource source must not be a symbolic link')
    }
    const source = await fsp.open(sourcePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    const stats = await source.stat()
    if (!stats.isFile()) {
      await source.close()
      throw new Error('Resource source is not a regular file')
    }
    if (options.maxBytes !== undefined && stats.size > options.maxBytes) {
      await source.close()
      throw new Error(`Resource exceeds maximum byte length of ${options.maxBytes}`)
    }
    const stream = source.createReadStream({ autoClose: false })
    const onAbort = (): void => {
      stream.destroy(abortError())
    }
    options.signal?.addEventListener('abort', onAbort, { once: true })
    try {
      return await this.putReadable(stream, options)
    } finally {
      options.signal?.removeEventListener('abort', onAbort)
      stream.destroy()
      await source.close().catch(() => undefined)
    }
  }

  async putReadable(
    chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>,
    options: PutResourceOptions = {},
  ): Promise<PutResourceResult> {
    await this.initialize()
    throwIfAborted(options.signal)
    if (options.maxBytes !== undefined
      && (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1)) {
      throw new Error('Resource maxBytes must be a positive safe integer')
    }
    const stagedPath = path.join(this.stagingDir, `${crypto.randomUUID()}.tmp`)
    const expectedHash = normalizeExpectedHash(options.expectedSha256)
    const hash = crypto.createHash('sha256')
    let byteLength = 0
    let handle: fsp.FileHandle | undefined
    try {
      handle = await fsp.open(stagedPath, 'wx', 0o600)
      for await (const value of chunks) {
        throwIfAborted(options.signal)
        const chunk = Buffer.isBuffer(value)
          ? value
          : Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        if (options.maxBytes !== undefined && chunk.byteLength > options.maxBytes - byteLength) {
          throw new Error(`Resource exceeds maximum byte length of ${options.maxBytes}`)
        }
        hash.update(chunk)
        byteLength = await writeChunk(handle, chunk, byteLength)
      }
      await handle.sync()
      await handle.close()
      handle = undefined

      const sha256 = hash.digest('hex')
      if (expectedHash && expectedHash !== sha256) {
        throw new Error(`Resource SHA-256 mismatch: expected ${expectedHash}, received ${sha256}`)
      }
      const id = `sha256:${sha256}` as ResourceId
      const destination = this.getFilesystemPath(id)
      await fsp.mkdir(path.dirname(destination), { recursive: true })
      const created = await this.executor.run(id, async () => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            // link 在同一资源库内提供 no-clobber 提交；并发写同一哈希时只有一个会成功。
            await fsp.link(stagedPath, destination)
            return true
          } catch (error) {
            if (!isAlreadyExists(error)) throw error
          }
          if (await verifyExistingObject(destination, sha256, byteLength)) return false
          const quarantine = `${destination}.${crypto.randomUUID()}.corrupt`
          try {
            await fsp.rename(destination, quarantine)
            await fsp.rm(quarantine, { force: true })
          } catch (error) {
            if (!isMissing(error)) throw error
          }
        }
        throw new Error(`Unable to replace corrupt resource object: ${id}`)
      })
      await fsp.rm(stagedPath, { force: true })
      logger.debug('图片编辑资源写入完成', {
        event: 'image_editor_v3.resource.put.completed',
        context: { resourceId: id, byteLength, created },
      })
      return { id, sha256, byteLength, mediaType: options.mediaType, created }
    } catch (error) {
      await handle?.close().catch(() => undefined)
      await fsp.rm(stagedPath, { force: true }).catch(() => undefined)
      logger.error('图片编辑资源写入失败', {
        event: 'image_editor_v3.resource.put.failed',
        error,
      })
      throw error
    }
  }

  openReadStream(resourceId: ResourceId): fs.ReadStream {
    const objectPath = this.getFilesystemPath(resourceId)
    const descriptor = fs.lstatSync(objectPath)
    if (descriptor.isSymbolicLink()) throw new Error(`Resource is a symbolic link: ${resourceId}`)
    const fd = fs.openSync(objectPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW)
    try {
      if (!fs.fstatSync(fd).isFile()) throw new Error(`Resource is not a file: ${resourceId}`)
      return fs.createReadStream(objectPath, { fd, autoClose: true })
    } catch (error) {
      fs.closeSync(fd)
      throw error
    }
  }

  openVerifiedReadStream(resourceId: ResourceId): Transform {
    const source = this.openReadStream(resourceId)
    const verifier = new ResourceIntegrityTransform(parseResourceId(resourceId))
    source.once('error', (error) => verifier.destroy(error))
    return source.pipe(verifier)
  }

  async readVerifiedBuffer(resourceId: ResourceId, maxBytes: number): Promise<Buffer> {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('Invalid resource read limit')
    const chunks: Buffer[] = []
    let byteLength = 0
    for await (const value of this.openVerifiedReadStream(resourceId)) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      if (chunk.byteLength > maxBytes - byteLength) {
        throw new Error(`Resource exceeds maximum byte length of ${maxBytes}`)
      }
      byteLength += chunk.byteLength
      chunks.push(chunk)
    }
    return Buffer.concat(chunks, byteLength)
  }

  async verify(resourceId: ResourceId, signal?: AbortSignal): Promise<ResourceDescriptor> {
    const expected = parseResourceId(resourceId)
    const hash = crypto.createHash('sha256')
    let byteLength = 0
    for await (const chunk of this.openReadStream(resourceId)) {
      throwIfAborted(signal)
      hash.update(chunk)
      byteLength += chunk.byteLength
    }
    const actual = hash.digest('hex')
    if (actual !== expected) throw new Error(`Corrupt resource: ${resourceId}`)
    return { id: resourceId, sha256: actual, byteLength }
  }

  async acquireLease(resourceIds: readonly ResourceId[]): Promise<ResourceLease> {
    const unique = [...new Set(resourceIds)]
    await this.executor.run('resource-leases', async () => {
      for (const resourceId of unique) {
        if (!(await this.has(resourceId))) throw new Error(`Resource not found: ${resourceId}`)
      }
      for (const resourceId of unique) {
        this.leaseCounts.set(resourceId, (this.leaseCounts.get(resourceId) ?? 0) + 1)
      }
    })
    let released = false
    return {
      resourceIds: unique,
      release: async (): Promise<void> => {
        if (released) return
        released = true
        await this.executor.run('resource-leases', async () => {
          for (const resourceId of unique) {
            const next = (this.leaseCounts.get(resourceId) ?? 1) - 1
            if (next <= 0) this.leaseCounts.delete(resourceId)
            else this.leaseCounts.set(resourceId, next)
          }
        })
      },
    }
  }

  async garbageCollect(
    referencedResourceIds: ReadonlySet<ResourceId>,
    options: ResourceGarbageCollectionOptions = {},
  ): Promise<ResourceGarbageCollectionResult> {
    return this.executor.run('resource-leases', async () => {
      const deleted: ResourceId[] = []
      const retainedByLease: ResourceId[] = []
      let reclaimedBytes = 0
      const minimumAgeMs = Math.max(0, options.minimumAgeMs ?? 60_000)
      const prefixes = await fsp.readdir(this.objectsDir, { withFileTypes: true }).catch(() => [])
      for (const prefix of prefixes) {
        if (!prefix.isDirectory() || !/^[a-f0-9]{2}$/.test(prefix.name)) continue
        const prefixDir = path.join(this.objectsDir, prefix.name)
        const entries = await fsp.readdir(prefixDir, { withFileTypes: true })
        for (const entry of entries) {
          if (!entry.isFile() || !SHA256_PATTERN.test(entry.name)) continue
          const resourceId = `sha256:${entry.name}` as ResourceId
          if (referencedResourceIds.has(resourceId)) continue
          if ((this.leaseCounts.get(resourceId) ?? 0) > 0) {
            retainedByLease.push(resourceId)
            continue
          }
          const resourcePath = path.join(prefixDir, entry.name)
          const stats = await fsp.stat(resourcePath)
          if (Date.now() - stats.mtimeMs < minimumAgeMs) continue
          deleted.push(resourceId)
          reclaimedBytes += stats.size
          if (!options.dryRun) await fsp.rm(resourcePath, { force: true })
        }
      }
      logger.info('图片编辑资源垃圾回收完成', {
        event: 'image_editor_v3.resource_gc.completed',
        context: { deleted: deleted.length, retainedByLease: retainedByLease.length, reclaimedBytes },
      })
      return { deleted, retainedByLease, reclaimedBytes }
    })
  }
}
