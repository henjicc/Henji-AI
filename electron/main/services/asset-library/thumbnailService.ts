import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getHenjiDataDir } from '../db'
import { generateImageThumbnailBytes } from '../image/ops'
import { generateVideoThumbnailBytes } from '../video/ops'
import type { AssetMediaType } from './types'

interface ThumbnailJob { promise: Promise<string>; controller: AbortController; users: number }
const thumbnailJobs = new Map<string, ThumbnailJob>()

export async function ensureAssetThumbnail(filePath: string, mediaType: AssetMediaType, modifiedAt: number, signal?: AbortSignal): Promise<string | null> {
  signal?.throwIfAborted()
  if (mediaType === 'audio') return null
  const dir = path.join(getHenjiDataDir(), 'Thumbnails')
  const digest = crypto.createHash('sha256').update(`${filePath}:${modifiedAt}:asset-v1`).digest('hex')
  const target = path.join(dir, `${digest}.webp`)
  let job = thumbnailJobs.get(target)
  if (!job) {
    const controller = new AbortController()
    job = { controller, users: 0, promise: writeThumbnail(filePath, mediaType, target, controller.signal) }
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

async function writeThumbnail(filePath: string, mediaType: AssetMediaType, target: string, signal: AbortSignal): Promise<string> {
  await fs.mkdir(path.dirname(target), { recursive: true })
  signal.throwIfAborted()
  try {
    await fs.access(target)
  } catch {
    const bytes = mediaType === 'image'
      ? await generateImageThumbnailBytes(filePath, 320)
      : await generateVideoThumbnailBytes(filePath, 320, signal)
    signal.throwIfAborted()
    const pending = `${target}.${crypto.randomUUID()}.tmp`
    try { await fs.writeFile(pending, bytes, { signal }); signal.throwIfAborted(); await fs.rename(pending, target) } finally { await fs.rm(pending, { force: true }) }
  }
  signal.throwIfAborted()
  return target
}

