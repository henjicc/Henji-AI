import { AbortableSingleflight, throwIfImageSourceAborted } from './abortable-singleflight'
import fsp from 'node:fs/promises'
import type { DerivedDiskCache } from './derived-disk-cache'
import { createMainLogger } from '../logging'

/** 原生解码条带的内存预算，包括仍在执行的解码；拒绝缓存不等于拒绝源图。 */
const STRIPE_CACHE_BYTES = 32 * 1024 * 1024
export const MAX_SOURCE_DECODE_STRIPE_BYTES = STRIPE_CACHE_BYTES / 2
const logger = createMainLogger('main.image_editor_v3.source_provider')

export class SourceDecodeStripeCache {
  private readonly flights = new AbortableSingleflight<Buffer | null>()
  private readonly entries = new Map<string, Buffer>()
  private retainedBytes = 0
  private inFlightBytes = 0

  constructor(private readonly diskCache?: DerivedDiskCache | null) {}

  private async readOrDecode(key: string, byteLength: number,
    decode: (signal: AbortSignal) => Promise<Buffer>, signal: AbortSignal): Promise<Buffer> {
    const cache = this.diskCache
    if (!cache || byteLength > cache.maxEntryBytes) return decode(signal)
    const address = { kind: 'pyramid' as const, key: `source-stripe-v1:${key}` }
    try {
      const lease = await cache.acquireFileLease(address)
      if (lease) {
        try {
          // 在分配前核对大小；固定条带预算不被损坏的派生缓存扩大。
          if (lease.byteLength === byteLength) {
            const bytes = await fsp.readFile(lease.filePath, { signal })
            if (bytes.byteLength === byteLength) return bytes
          }
        } finally { await lease.release() }
        await cache.invalidate(address)
      }
    } catch (error) {
      throwIfImageSourceAborted(signal)
      logger.warn('读取源条带派生缓存失败，重新解码', {
        event: 'image_editor_v3.source.stripe.cache_read.failed', context: { key }, error,
      })
    }
    throwIfImageSourceAborted(signal)
    const bytes = await decode(signal)
    throwIfImageSourceAborted(signal)
    if (bytes.byteLength !== byteLength) throw new Error('Decoded source stripe has incompatible dimensions')
    try { await cache.put(address, bytes) } catch (error) {
      logger.warn('发布源条带派生缓存失败，保留当前解码结果', {
        event: 'image_editor_v3.source.stripe.cache_write.failed', context: { key }, error,
      })
    }
    return bytes
  }

  async read(
    key: string,
    byteLength: number,
    decode: (signal: AbortSignal) => Promise<Buffer>,
    signal?: AbortSignal,
  ): Promise<Buffer | null> {
    throwIfImageSourceAborted(signal)
    if (byteLength > MAX_SOURCE_DECODE_STRIPE_BYTES) return null
    const cached = this.entries.get(key)
    if (cached) {
      this.entries.delete(key)
      this.entries.set(key, cached)
      return cached
    }
    return this.flights.run(key, async (sharedSignal) => {
      while (this.retainedBytes + this.inFlightBytes + byteLength > STRIPE_CACHE_BYTES) {
        const oldest = this.entries.keys().next().value as string | undefined
        if (oldest === undefined) return null
        this.retainedBytes -= this.entries.get(oldest)!.byteLength
        this.entries.delete(oldest)
      }
      this.inFlightBytes += byteLength
      try {
        const bytes = await this.readOrDecode(key, byteLength, decode, sharedSignal)
        throwIfImageSourceAborted(sharedSignal)
        if (bytes.byteLength !== byteLength) throw new Error('Decoded source stripe has incompatible dimensions')
        this.entries.set(key, bytes)
        this.retainedBytes += byteLength
        return bytes
      } finally {
        this.inFlightBytes -= byteLength
      }
    }, signal)
  }
}
