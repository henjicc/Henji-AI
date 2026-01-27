import { inferMimeFromPath as inferMimeFromPathShared } from './mime'

export { dataUrlToFile, urlToFile, convertBlobToPng } from './imageConversion/fileConversion'
export { extractImagesFromClipboard } from './imageConversion/clipboard'
export { generateThumbnail, generateVideoThumbnail, generateVideoPreviewDataUrl } from './imageConversion/dragThumbnails'
export { getVideoThumbnailCachePath, getImageThumbnailCachePath } from './imageConversion/thumbnailCachePaths'
export { generateAndCacheVideoThumbnail, getOrCreateVideoThumbnail } from './imageConversion/thumbnailCacheVideo'
export { generateAndCacheImageThumbnail, getOrCreateImageThumbnail } from './imageConversion/thumbnailCacheImage'
export { deleteThumbnailCache } from './imageConversion/thumbnailCacheCleanup'

// Backward-compatible helper
export function inferMimeFromPath(path: string): string {
  return inferMimeFromPathShared(path, { fallback: 'image/jpeg' })
}