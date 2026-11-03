import type { OffscreenSharedTexture } from 'electron'

export class WebSnapshotMiss extends Error {
  constructor() { super('网页快照被合并，重新取这一帧'); this.name = 'WebSnapshotMiss' }
}

/** 快照脚本返回后，纹理通常不到 20 毫秒送到；超过这么久仍没有就算没画出来。 */
const FRAME_TIMEOUT_MS = 3_000
/** 后一幅已对上号时，前一幅再等这么久仍没到就算被浏览器合并掉了。 */
const MERGED_GRACE_MS = 50

interface Pending {
  order: number
  done: boolean
  resolve(texture: OffscreenSharedTexture): void
  reject(error: Error): void
  timer?: ReturnType<typeof setTimeout>
  missed?: ReturnType<typeof setTimeout>
}

/**
 * 身份来自画面本身；paint 的到达序号、损坏区和请求完成顺序都不能证明它是哪一刻。纹理按页面提交顺序送达，
 * 浏览器来不及时会把相邻几幅合并成最后一幅，所以新帧先到即说明前面没到的被合并了。
 * 读身份失败（读回窗口没了）时让在途各幅按被合并处理、由消费者补取，并经 `onBroken` 让页面改回串行取帧。
 */
export class WebSnapshotFrames {
  private readonly pending = new Map<string, Pending>()
  private order = 0
  private closed = false
  /** 已到达、还在读身份的纹理数。 */
  private identifying = 0
  /** 已确认送到的最新一幅；更早的纹理不会再来。 */
  private settled = 0
  /** 没等到纹理就结束（取消、超时）的最新一幅：它的纹理可能仍在路上，送到之前每幅都要读身份。 */
  private orphaned = 0
  readonly metrics = { matched: 0, direct: 0, missed: 0, stale: 0, reordered: 0 }

  constructor(private readonly identify: (texture: OffscreenSharedTexture) => Promise<string | undefined>, private readonly onBroken: (error: unknown) => void = () => undefined) {}

  /** 登记在快照脚本之前（纹理可能比脚本返回先到）；`start` 在脚本返回后开始计超时，脚本自己的耗时由脚本时限管。 */
  expect(identity: string, signal?: AbortSignal): { frame: Promise<OffscreenSharedTexture>; start(): void; cancel(): void } {
    let pending!: Pending
    const abort = (): void => pending.reject(new Error('网页快照已取消'))
    const finish = (): boolean => {
      if (pending.done) return false
      pending.done = true
      clearTimeout(pending.timer); clearTimeout(pending.missed)
      signal?.removeEventListener('abort', abort)
      if (this.pending.get(identity) === pending) this.pending.delete(identity)
      return true
    }
    const frame = new Promise<OffscreenSharedTexture>((resolve, reject) => {
      pending = {
        order: ++this.order,
        done: false,
        resolve: texture => {
          if (!finish()) { texture.release(); return }
          this.settled = Math.max(this.settled, pending.order)
          resolve(texture)
        },
        reject: error => {
          if (!finish()) return
          if (!(error instanceof WebSnapshotMiss)) this.orphaned = Math.max(this.orphaned, pending.order)
          reject(error)
        },
      }
      this.pending.set(identity, pending)
    })
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
    if (this.closed) pending.reject(new Error('网页快照已失效'))
    void frame.catch(() => undefined)
    return {
      frame,
      start: () => { if (!pending.done) pending.timer ??= setTimeout(() => pending.reject(new Error('网页取帧超时：页面没有画出匹配快照')), FRAME_TIMEOUT_MS) },
      cancel: () => pending.reject(new Error('网页快照已取消')),
    }
  }

  accept(texture: OffscreenSharedTexture): void {
    if (this.closed || !this.pending.size) { texture.release(); return }
    // 只有一幅在等、更早的都已送到或确认被合并时，到达的只可能是它（画面只在快照时变化）。跳过读身份（约 4 毫秒），
    // 逐幅取帧（拖动）就不比串行慢；多幅在途或有取消的快照可能还在路上时才读身份。
    if (this.pending.size === 1 && !this.identifying && this.orphaned <= this.settled) {
      const [only] = this.pending.values()
      if (!only.missed) { this.metrics.direct++; only.resolve(texture); return }
    }
    this.identifying++
    void this.identify(texture).finally(() => { this.identifying-- }).then(identity => {
      const matched = identity && this.pending.get(identity)
      if (!matched || this.closed) {
        this.metrics.stale++; texture.release()
        return
      }
      this.metrics.matched++
      if (matched.missed) this.metrics.reordered++
      matched.resolve(texture)
      for (const previous of this.pending.values()) if (previous.order < matched.order && !previous.missed) {
        // 仍留一点时间给可能的乱序，届时仍缺才让消费者补取。
        previous.missed = setTimeout(() => { this.metrics.missed++; previous.reject(new WebSnapshotMiss()) }, MERGED_GRACE_MS)
      }
    }, error => {
      texture.release()
      if (this.closed) return
      this.close(new WebSnapshotMiss())
      this.onBroken(error)
    })
  }

  close(reason: Error = new Error('网页快照已失效')): void {
    this.closed = true
    for (const pending of [...this.pending.values()]) pending.reject(reason)
  }
}
