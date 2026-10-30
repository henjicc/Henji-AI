import { createLogger } from '@/core/logging'
import type { VideoEditClip, VideoEditDocument } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import { VideoEditCodeMetadataPending } from './videoEditCodeState'

/**
 * 网页参数引用的网页文件夹的内容指纹（主进程散列）：预渲染的窗口指纹带上它，网页文件改了，用到它的窗口就失效。
 * 打开着的剪辑引用的网页路径整份交给主进程监视（有没有页面开着都监视），文件夹改动由主进程按路径通知，
 * 不靠窗口重算来复核。第一次读到某个路径时抛出 VideoEditWebContentPending，调用方等它读好（读好以前的指纹
 * 不能拿来回收或渲染文件，与代码声明读取中同一处理）。从没读出来过的路径按“不可用”计入，文件夹出现后主进程的
 * 通知换成真实指纹；读出来过的路径一时读不出（构建工具正整个替换文件夹）时沿用上一次的指纹。
 */
const logger = createLogger('features.videoEdit.webContent')
const hashes = new Map<string, string>()
const unavailable = new Set<string>()
const listeners = new Set<() => void>()
/** 打开着的剪辑引用的网页路径。 */
let referenced = new Set<string>()
/** 查询过、但还不在引用清单里的路径（引用清单更新时以清单为准）。 */
const queried = new Set<string>()
/** 交给主进程的监视清单串行发送；`sent` 是上一次发送成功的清单。 */
let flushing: Promise<void> = Promise.resolve()
let sent: string | undefined
let warned = false
let subscribed = false

/** 网页内容指纹还在读取：指纹与读好后的不同，不能拿来回收或渲染预览文件。 */
export class VideoEditWebContentPending extends VideoEditCodeMetadataPending {
  constructor(ready: Promise<void>) { super(ready); this.message = '正在读取网页内容…' }
}

function identityOf(path: string): string | undefined {
  return hashes.get(path) ?? (unavailable.has(path) ? 'unavailable' : undefined)
}

/** 记下主进程给的指纹（null 为读不出来），返回这个路径的指纹是否因此改变。 */
function apply(path: string, hash: string | null): boolean {
  const before = identityOf(path)
  if (hash !== null) { hashes.set(path, hash); unavailable.delete(path) } else if (!hashes.has(path)) unavailable.add(path)
  return identityOf(path) !== before
}

function changed(): void { for (const listener of listeners) listener() }

function flush(): Promise<void> {
  const run = flushing.then(async () => {
    const paths = [...new Set([...referenced, ...queried])].sort()
    const key = paths.join('\n')
    if (key === sent) return
    const platform = getPlatform()
    if (!subscribed) {
      subscribed = true
      platform.videoFrames.onWebContentChanged(change => { if (identityOf(change.path) !== undefined && apply(change.path, change.contentHash)) changed() })
    }
    let result: Record<string, string | null>
    try {
      result = await platform.videoFrames.watchWebContent(paths)
      sent = key
      warned = false
    } catch (error) {
      // 没交上去：这次读不到的路径按“不可用”计入（不让等它的调用方一直等），下次清单变化时再交。
      if (!warned) logger.warn('网页文件夹监视清单没有交给主进程', { event: 'video_edit.web_content.watch_failed', error, context: { paths: paths.length } })
      warned = true
      result = {}
    }
    let any = false
    for (const path of paths) if (apply(path, result[path] ?? null)) any = true
    if (any) changed()
  })
  flushing = run.catch(() => undefined)
  return run
}

/** 这个网页路径当前的内容指纹；还没读过时抛出 VideoEditWebContentPending，从没读出来过时为 'unavailable'。 */
export function videoEditWebContentIdentity(path: string): string {
  const known = identityOf(path)
  if (known !== undefined) return known
  if (!referenced.has(path)) queried.add(path)
  throw new VideoEditWebContentPending(flush())
}

const clipPaths = new WeakMap<VideoEditClip, readonly string[]>()
/** 片段的代码参数与代码效果参数引用的网页路径（片段是不可变快照，按对象缓存：拖动时只重扫动过的片段）。 */
function webPathsOf(clip: VideoEditClip): readonly string[] {
  const cached = clipPaths.get(clip)
  if (cached) return cached
  const found = new Set<string>()
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return }
    if (!value || typeof value !== 'object') return
    const record = value as Record<string, unknown>
    if (record.kind === 'web' && typeof record.path === 'string') found.add(record.path)
    Object.values(record).forEach(visit)
  }
  visit(clip.code); visit(clip.effects)
  const paths = [...found]
  clipPaths.set(clip, paths)
  return paths
}

/** 打开着的剪辑引用的网页路径整份交给主进程监视；清单没变时不重发。 */
export function watchVideoEditWebContent(documents: readonly VideoEditDocument[]): void {
  const next = new Set(documents.flatMap(document => document.sequences.flatMap(sequence => sequence.clips.flatMap(webPathsOf))))
  if (next.size === referenced.size && [...next].every(path => referenced.has(path))) return
  referenced = next
  queried.clear()
  void flush()
}

export function subscribeVideoEditWebContent(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
