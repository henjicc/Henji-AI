import { AbortableSingleflight, throwIfImageSourceAborted } from './abortable-singleflight'

/** 原生解码条带的内存预算，包括仍在执行的解码；拒绝缓存不等于拒绝源图。 */
const STRIPE_CACHE_BYTES = 32 * 1024 * 1024
const MAX_STRIPE_BYTES = STRIPE_CACHE_BYTES / 2

export class SourceDecodeStripeCache {
  private readonly flights = new AbortableSingleflight<Buffer | null>()
  private readonly entries = new Map<string, Buffer>()
  private retainedBytes = 0
  private inFlightBytes = 0

  async read(
    key: string,
    byteLength: number,
    decode: (signal: AbortSignal) => Promise<Buffer>,
    signal?: AbortSignal,
  ): Promise<Buffer | null> {
    throwIfImageSourceAborted(signal)
    if (byteLength > MAX_STRIPE_BYTES) return null
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
        const bytes = await decode(sharedSignal)
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
