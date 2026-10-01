import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getHenjiDataDir } from '../db'
import { generateImageThumbnailBytes } from '../image/ops'
import { generateVideoThumbnailBytes } from '../video/ops'
import type { AssetMediaType } from './types'

interface ThumbnailJob { promise: Promise<string>; controller: AbortController; users: number }
const thumbnailJobs = new Map<string, ThumbnailJob>()
type ThumbnailIdentity = readonly [size: number, modifiedAt: number, changedAt: number, device: number, inode: number]
async function thumbnailIdentity(filePath: string): Promise<ThumbnailIdentity> {
  const stat = await fs.stat(filePath)
  if (!stat.isFile()) throw new Error('缩略图来源不是文件。')
  return [stat.size, stat.mtimeMs, stat.ctimeMs, stat.dev, stat.ino]
}
async function requireThumbnailIdentity(filePath: string, identity: ThumbnailIdentity): Promise<void> {
  const current = await thumbnailIdentity(filePath)
  if (current.some((value, index) => value !== identity[index])) throw new Error('源文件在生成缩略图期间发生变化，请重新检查资产。')
}

export async function ensureAssetThumbnail(filePath: string, mediaType: AssetMediaType, modifiedAt: number, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted()
  if (mediaType === 'audio') return null
  const identity = await thumbnailIdentity(filePath)
  signal?.throwIfAborted()
  if (identity[1] !== modifiedAt) throw new Error('源文件已更新，请重新检查后生成缩略图。')
  const dir = path.join(getHenjiDataDir(), 'Thumbnails')
  const digest = crypto.createHash('sha256').update(JSON.stringify([filePath, mediaType, modifiedAt, ...identity, 'asset-v2'])).digest('hex')
  const target = path.join(dir, `${digest}.webp`)
  let job = thumbnailJobs.get(target)
  if (!job) {
    const controller = new AbortController()
    job = { controller, users: 0, promise: writeThumbnail(filePath, mediaType, target, identity, controller.signal) }
    thumbnailJobs.set(target, job)
    const owned = job
    const finish = (): void => { if (thumbnailJobs.get(target) === owned) thumbnailJobs.delete(target) }
    void job.promise.then(finish, finish)
  }
  job.users++
  const owned = job
  let cancelled: (() => void) | undefined
  try {
    const result = signal ? await Promise.race([owned.promise, new Promise<never>((_resolve, reject) => {
      cancelled = () => reject(signal.reason)
      signal.addEventListener('abort', cancelled, { once: true })
      if (signal.aborted) cancelled()
    })]) : await owned.promise
    signal?.throwIfAborted()
    return result
  } finally {
    if (cancelled) signal?.removeEventListener('abort', cancelled)
    owned.users--
    if (!owned.users) {
      owned.controller.abort(new Error('缩略图已无可见使用者。'))
      if (thumbnailJobs.get(target) === owned) thumbnailJobs.delete(target)
    }
  }
}

async function writeThumbnail(filePath: string, mediaType: AssetMediaType, target: string, identity: ThumbnailIdentity, signal: AbortSignal): Promise<string> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  signal.throwIfAborted()
  try {
    await fs.access(target)
  } catch {
    const bytes = mediaType === 'image'
      ? await generateImageThumbnailBytes(filePath, 320)
      : await generateVideoThumbnailBytes(filePath, 320, signal)
    signal.throwIfAborted()
    await requireThumbnailIdentity(filePath, identity)
    signal.throwIfAborted()
    const pending = `${target}.${crypto.randomUUID()}.tmp`
    try { await fs.writeFile(pending, bytes, { signal }); signal.throwIfAborted(); await requireThumbnailIdentity(filePath, identity); signal.throwIfAborted(); await fs.rename(pending, target) } finally { await fs.rm(pending, { force: true }) }
  }
  await requireThumbnailIdentity(filePath, identity)
  signal.throwIfAborted()
  return target
}

