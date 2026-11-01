import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import type { ContentTrustReference } from '../../../../src/core/contentTrust'
import type { MainLogger } from '../logging/main-logger'
import type { VideoFrameTarget } from '../video-decoder'
import { WebSourceBatch } from './batch'
import { WebCacheFonts } from './fonts'
import type { WebSourcePage } from './page'
import { webSourceSession } from './session'

export interface WebCacheRegistration {
  readonly batch: WebSourceBatch
  readonly signal: AbortSignal
  readonly current: boolean
  environment(): Promise<{ signature: string; isCurrent(): boolean; current: (final?: boolean) => Promise<boolean>; close: () => void } | undefined>
}

interface Entry { batch: WebSourceBatch; controller: AbortController; trust: readonly ContentTrustReference[]; target: VideoFrameTarget; page: WebSourcePage; owner: Owner }
interface Owner { live: boolean; stop: () => void }
interface OnceScope { owner: Owner; roots: Map<string, { hash: string; batch: WebSourceBatch }> }

/** 后台只消费前台已获准来源；一次许可的补录范围固定为首个宿主会话及其中各来源的首个内容代次。 */
export class WebCacheRegistrations {
  private readonly entries = new Map<string, Entry>()
  private readonly scopes = new Map<string, OnceScope>()
  private readonly owners = new Map<number, Owner>()
  private readonly pending = new Map<string, object>()
  private disposed = false

  constructor(private readonly trust: { policy(): boolean; allows(query: { contents: ContentTrustReference[] }): boolean },
    private readonly logger: Pick<MainLogger, 'info' | 'warn'>) {}

  async register(page: WebSourcePage, contents: readonly ContentTrustReference[] | undefined): Promise<void> {
    this.remove(page.streamId)
    if (this.disposed || contents === undefined || page.signal.aborted || page.target.isDestroyed() || !this.trust.allows({ contents: [...contents] })) return
    const attempt = {}
    this.pending.set(page.streamId, attempt)
    const target = page.target
    let owner = this.owners.get(target.id)
    if (!owner) {
      owner = { live: true, stop: () => undefined }
      this.owners.set(target.id, owner)
      const held = owner
      owner.stop = target.onGone(() => {
        held.live = false
        for (const [id, entry] of this.entries) if (entry.target.id === target.id) this.remove(id)
        for (const scope of this.scopes.values()) if (scope.owner === held) for (const root of scope.roots.values()) root.batch.close()
        if (this.owners.get(target.id) === held) this.owners.delete(target.id)
        held.stop()
      })
    }
    if (!owner.live) return
    const rootPath = await fs.realpath(page.folder.root)
    const batch = await WebSourceBatch.begin(rootPath)
    try {
      if (this.disposed || this.pending.get(page.streamId) !== attempt || !owner.live || page.signal.aborted || target.isDestroyed() || !this.trust.allows({ contents: [...contents] }) || batch.source.contentHash !== page.contentHash) return
      if (!this.trust.policy()) {
        for (const content of contents) {
          const key = JSON.stringify([content.sourceType, content.id])
          const scope = this.scopes.get(key)
          const root = scope?.roots.get(rootPath)
          if (scope && (scope.owner !== owner || root && (root.hash !== page.contentHash || !root.batch.current))) return
        }
        for (const content of contents) {
          const key = JSON.stringify([content.sourceType, content.id])
          let scope = this.scopes.get(key)
          if (!scope) { scope = { owner, roots: new Map() }; this.scopes.set(key, scope) }
          if (!scope.roots.has(rootPath)) scope.roots.set(rootPath, { hash: page.contentHash, batch })
        }
      }
      const entry: Entry = { batch, controller: new AbortController(), trust: [...contents], target, page, owner }
      this.entries.set(page.streamId, entry)
      this.logger.info('网页来源已登记后台缓存', { event: 'web_source.registration.completed', context: { streamId: page.streamId, contentHash: page.contentHash, targetId: target.id } })
    } finally {
      if (this.pending.get(page.streamId) === attempt) this.pending.delete(page.streamId)
      if (this.entries.get(page.streamId)?.batch !== batch) batch.close()
    }
  }

  get(streamId: string): WebCacheRegistration | undefined {
    const entry = this.entries.get(streamId)
    if (!entry) return undefined
    const current = (): boolean => !entry.page.signal.aborted && !entry.controller.signal.aborted && entry.batch.current && !entry.target.isDestroyed() &&
      this.trust.allows({ contents: [...entry.trust] }) && (this.trust.policy() || entry.trust.every(content => {
        const scope = this.scopes.get(JSON.stringify([content.sourceType, content.id]))
        const root = scope?.roots.get(entry.batch.root)
        return scope?.owner === entry.owner && root?.hash === entry.batch.source.contentHash && root.batch.current
      }))
    if (!current()) return undefined
    return { batch: entry.batch, signal: entry.controller.signal, get current() { return current() }, environment: async () => {
      if (!current()) return undefined
      const session = webSourceSession(entry.page.folder.root)
      if (!await entry.page.validateEnvironment()) return undefined
      const storage = session.storageSignature
      const fonts = await WebCacheFonts.begin(entry.controller.signal)
      const valid = async (final = false): Promise<boolean> => {
        if (!current() || session.reason || storage !== session.storageSignature) return false
        if (!await (final ? fonts.validate(entry.controller.signal) : fonts.check())) return false
        if (final && !await entry.page.validateEnvironment()) return false
        // 任一次异步检查期间都可能收到宿主关闭、站外请求或存储通知；只在全部检查之后裁定。
        return current() && !session.reason && storage === session.storageSignature && fonts.current
      }
      if (!await valid()) { fonts.close(); return undefined }
      const signature = crypto.createHash('sha256').update(JSON.stringify({ fonts: fonts.signature, storage, partition: session.partition,
        platform: process.platform, arch: process.arch, locale: Intl.DateTimeFormat().resolvedOptions(), electron: process.versions.electron })).digest('hex')
      return { signature, isCurrent: () => current() && !session.reason && storage === session.storageSignature && fonts.current, current: valid, close: () => fonts.close() }
    } }
  }

  remove(streamId: string): void {
    this.pending.delete(streamId)
    const entry = this.entries.get(streamId)
    if (!entry) return
    this.entries.delete(streamId)
    entry.controller.abort(new Error('网页后台登记已结束'))
    // 一次授权的批次监视持续到宿主结束，关页重开不能洗掉期间的来源变化。
    if (![...this.scopes.values()].some(scope => [...scope.roots.values()].some(root => root.batch === entry.batch))) entry.batch.close()
    this.logger.info('网页后台登记已撤销', { event: 'web_source.registration.removed', context: { streamId } })
  }

  dispose(): void {
    this.disposed = true
    this.pending.clear()
    for (const id of this.entries.keys()) this.remove(id)
    for (const scope of this.scopes.values()) for (const root of scope.roots.values()) root.batch.close()
    this.scopes.clear()
    for (const owner of this.owners.values()) { owner.live = false; owner.stop() }
    this.owners.clear()
  }
}
