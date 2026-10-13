import crypto from 'node:crypto'
import { registerOwnedMedia } from '../media-recycle/queue'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getProgramStoreDir } from '../appPaths'
import { generateImageThumbnailBytes } from '../image/ops'
import { generateVideoThumbnailBytes } from '../video/ops'
import type { AssetMediaType } from './types'

interface ThumbnailJob { promise: Promise<string>; controller: AbortController; users: number }
const thumbnailJobs = new Map<string, ThumbnailJob>()
const previewJobs = new Map<string, Promise<boolean>>()

/** Publish only complete derived previews; the same target has a single writer. */
export async function writeOwnedMediaPreview(target: string, sourcePath: string, write: (pending: string) => Promise<void>): Promise<boolean> {
  const existing = previewJobs.get(target)
  if (existing) return await existing
  const job = (async () => {
    await fs.mkdir(path.dirname(target), { recursive: true })
    let cacheHit = false
    try { await fs.access(target); cacheHit = true }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    if (!cacheHit) {
      const pending = `${target}.${crypto.randomUUID()}.tmp`
      try { await write(pending); await fs.rename(pending, target) }
      // media-recycle-allow: unpublished unique preview staging file only.
      finally { await fs.rm(pending, { force: true }) }
    }
    await registerOwnedMedia(target, sourcePath)
    return cacheHit
  })()
  previewJobs.set(target, job)
  try { return await job }
  finally { if (previewJobs.get(target) === job) previewJobs.delete(target) }
}
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
  if (mediaType === 'audio' || mediaType === 'code') return null
  const identity = await thumbnailIdentity(filePath)
  signal?.throwIfAborted()
  if (identity[1] !== modifiedAt) throw new Error('源文件已更新，请重新检查后生成缩略图。')
  const dir = getProgramStoreDir('thumbnails')
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
    // media-recycle-allow: unpublished unique thumbnail staging file only.
    try { await fs.writeFile(pending, bytes, { signal }); signal.throwIfAborted(); await requireThumbnailIdentity(filePath, identity); signal.throwIfAborted(); await fs.rename(pending, target) } finally { await fs.rm(pending, { force: true }) }
    await registerOwnedMedia(target, filePath)
  }
  await requireThumbnailIdentity(filePath, identity)
  signal.throwIfAborted()
  return target
}

