import { createHash, randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { VideoDecoderService } from '../video-decoder/client'

export interface WebCacheSegmentLease {
  /** 持锁进程退出即失效；取消后的收尾不能再删除已被其他实例接管的段。 */
  signal: AbortSignal
  prepare(destination: string): Promise<void>
  commit(temporary: string, destination: string): Promise<void>
  rollback(): Promise<void>
  discard(destination: string): Promise<boolean>
}

export type WebCacheLockService = Pick<VideoDecoderService, 'ensureStarted' | 'onLifecycle' | 'webCacheLock' | 'webCacheUnlock' | 'webCacheCommit' | 'webCacheRollback' | 'webCachePrepare' | 'webCacheDiscard'>
export class WebCacheLockBusy extends Error { constructor() { super('网页缓存段正在写入') } }

/** 内核锁与段发布共用原生控制通道；没有选主、心跳文件或进程内互斥回退。 */
export class WebCacheLocks {
  constructor(private readonly service: WebCacheLockService) {}

  async withSegmentLock<T>(identity: string, work: (lease: WebCacheSegmentLease) => Promise<T>, signal?: AbortSignal, wait = true): Promise<T> {
    signal?.throwIfAborted()
    await this.service.ensureStarted()
    const key = createHash('sha256').update(process.platform === 'win32' ? identity.toLowerCase() : identity).digest('hex')
    const token = randomUUID(), lifetime = new AbortController()
    const unsubscribe = this.service.onLifecycle(event => { if (event.type === 'exited') lifetime.abort(new Error('网页缓存段写锁所属进程已退出')) })
    const active = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal
    let requested = false
    try {
      for (;;) {
        active.throwIfAborted()
        requested = true
        const { acquired } = await this.service.webCacheLock(key, token)
        active.throwIfAborted()
        if (acquired) break
        requested = false
        if (!wait) throw new WebCacheLockBusy()
        await delay(25, undefined, { signal: active })
      }
      const result = await work({ signal: active,
        discard: async destination => {
          active.throwIfAborted()
          const result = await this.service.webCacheDiscard(key, token, destination)
          active.throwIfAborted()
          return result.removed
        },
        prepare: async destination => {
          active.throwIfAborted()
          await this.service.webCachePrepare(key, token, destination)
          active.throwIfAborted()
        },
        commit: async (temporary, destination) => {
          active.throwIfAborted()
          await this.service.webCacheCommit(key, token, temporary, destination)
          active.throwIfAborted()
        },
        rollback: async () => {
          // 原生线程同时核验 token 并删除，不能先在主进程检查锁再异步 rm。
          lifetime.signal.throwIfAborted()
          await this.service.webCacheRollback(key, token)
        },
      })
      active.throwIfAborted()
      return result
    } finally {
      try {
        // 获取回复超时/取消也发同 token 释放；控制通道 FIFO 保证迟到获取不会漏掉。
        if (requested && !lifetime.signal.aborted) await this.service.webCacheUnlock(key, token)
      } finally { unsubscribe() }
    }
  }
}
