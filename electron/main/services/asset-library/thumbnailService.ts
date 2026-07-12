import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { getHenjiDataDir } from '../db'
import { generateImageThumbnailBytes } from '../image/ops'
import { generateVideoThumbnailBytes } from '../video/ops'
import type { AssetMediaType } from './types'

export async function ensureAssetThumbnail(filePath: string, mediaType: AssetMediaType, modifiedAt: number): Promise<string | null> {
  if (mediaType === 'audio') return null
  const dir = path.join(getHenjiDataDir(), 'Thumbnails')
  await fs.mkdir(dir, { recursive: true })
  const digest = crypto.createHash('sha256').update(`${filePath}:${modifiedAt}:asset-v1`).digest('hex')
  const target = path.join(dir, `${digest}.webp`)
  try {
    await fs.access(target)
  } catch {
    const bytes = mediaType === 'image'
      ? await generateImageThumbnailBytes(filePath, 320)
      : await generateVideoThumbnailBytes(filePath, 320)
    await fs.writeFile(target, bytes)
  }
  return target
}

