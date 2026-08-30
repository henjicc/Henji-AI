import path from 'node:path'

import { getDataRootDir } from '../image/path-utils'
import type { ResourceId } from './contracts'
import { parseResourceId } from './resource-store'

export const IMAGE_EDITOR_V3_MEDIA_HOST = 'image-editor-v3'

const IMAGE_MEDIA_TYPES = new Set([
  'image/avif',
  'image/jpeg',
  'image/png',
  'image/tiff',
  'image/webp',
])

function normalizeMediaType(value: string): string {
  const mediaType = value.trim().toLowerCase()
  if (!IMAGE_MEDIA_TYPES.has(mediaType)) throw new Error('Unsupported image editor media type')
  return mediaType
}

export function imageEditorV3ResourceObjectPath(resourceId: ResourceId): string {
  const hash = parseResourceId(resourceId)
  return path.join(
    getDataRootDir(),
    'ImageEditorV3',
    'resources',
    'objects',
    hash.slice(0, 2),
    hash,
  )
}

/** 只公开内容哈希能力 URL，不把资源库文件路径交给渲染层。 */
export function createImageEditorV3ResourceMediaUrl(
  resourceId: ResourceId,
  mediaType: string,
): string {
  const hash = parseResourceId(resourceId)
  const query = new URLSearchParams({ mediaType: normalizeMediaType(mediaType) })
  return `henji-media://${IMAGE_EDITOR_V3_MEDIA_HOST}/${hash}?${query.toString()}`
}

export function resolveImageEditorV3ResourceMediaUrl(url: URL): {
  targetPath: string
  mediaType: string
} {
  if (
    url.protocol !== 'henji-media:'
    || url.hostname !== IMAGE_EDITOR_V3_MEDIA_HOST
    || url.username
    || url.password
    || url.port
  ) throw new Error('Unsupported image editor media URL')
  const hash = url.pathname.startsWith('/') ? url.pathname.slice(1) : url.pathname
  if (!/^[a-f0-9]{64}$/.test(hash) || hash.includes('/')) {
    throw new Error('Invalid image editor resource hash')
  }
  if ([...url.searchParams.keys()].some((key) => key !== 'mediaType')) {
    throw new Error('Unsupported image editor media URL query')
  }
  const mediaType = normalizeMediaType(url.searchParams.get('mediaType') ?? '')
  const resourceId = `sha256:${hash}` as ResourceId
  return {
    targetPath: imageEditorV3ResourceObjectPath(resourceId),
    mediaType,
  }
}
