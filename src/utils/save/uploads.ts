import { createLogger } from '@/core/logging'
import { mkdir, readFile, remove, writeFile } from '@tauri-apps/plugin-fs'
import Pica from 'pica'
import * as path from '@tauri-apps/api/path'
import { convertFileSrc } from '@tauri-apps/api/core'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import { getUploadsPath } from '@/utils/dataPath'
import { inferMimeFromPath as inferMimeFromPathShared } from '@/utils/mime'
import { fileToBlobSrc, fileToDataUrl, bytesToDataUrl } from './fileUrls'
import { sha256Hex } from './hash'

const logger = createLogger('utils.save.uploads')

const uploadCache: Map<string, { bytes: Uint8Array; dataUrl: string; displaySrc: string; compressedHash: string }> = new Map()

export async function saveUploadImage(
  fileOrBlob: File | Blob,
  mode: 'memory' | 'persist' = 'persist',
  opts?: { maxDimension?: number }
): Promise<{ fullPath: string; displaySrc: string; dataUrl: string }> {
  const mime = 'image/jpeg'
  const ext = 'jpg'
  const originalBuf = await (fileOrBlob as Blob).arrayBuffer()
  const originalHash = await sha256Hex(originalBuf)
  let cached = uploadCache.get(originalHash)

  if (!cached) {
    const bytes = await ensureCompressedJpegBytesWithPica(fileOrBlob as Blob, {
      maxPixels: 17_000_000,
      quality: 0.85,
      maxDimension: opts?.maxDimension,
    })
    const dataUrl = bytesToDataUrl(bytes, mime)
    const displaySrc = URL.createObjectURL(new Blob([bytes as any], { type: mime }))
    const compressedHash = await sha256Hex(bytes.buffer as ArrayBuffer)
    cached = { bytes, dataUrl, displaySrc, compressedHash }
    uploadCache.set(originalHash, cached)
  }

  const name = `${cached.compressedHash}.${ext}`
  const uploadsPath = await getUploadsPath()
  const full = await path.join(uploadsPath, name)

  if (mode === 'persist') {
    await mkdir(uploadsPath, { recursive: true })
    let exists = false
    try {
      await readFile(full)
      exists = true
    } catch { }
    if (!exists) {
      await writeFile(full, cached.bytes)
    }
    const displaySrc = await fileToBlobSrc(full, mime)
    const dataUrl = await fileToDataUrl(full, mime)
    logger.info('[save] upload image persisted', full)
    return { fullPath: full, displaySrc, dataUrl }
  }

  return { fullPath: full, displaySrc: cached.displaySrc, dataUrl: cached.dataUrl }
}

/**
 * 保存上传的视频文件到 Uploads 目录
 * 与 saveUploadImage 类似，但不进行压缩处理
 */
export async function saveUploadVideo(
  file: File,
  mode: 'memory' | 'persist' = 'persist'
): Promise<{ fullPath: string; displaySrc: string; dataUrl: string }> {
  const mime = file.type || 'video/mp4'
  const ext = mime.includes('webm') ? 'webm' : 'mp4'

  const originalBuf = await file.arrayBuffer()
  const bytes = new Uint8Array(originalBuf)
  const hash = await sha256Hex(originalBuf)

  const name = `${hash}.${ext}`
  const uploadsPath = await getUploadsPath()
  const full = await path.join(uploadsPath, name)

  if (mode === 'persist') {
    await mkdir(uploadsPath, { recursive: true })

    let exists = false
    try {
      await readFile(full)
      exists = true
    } catch { }

    if (!exists) {
      await writeFile(full, bytes)
    }

    const displaySrc = await fileToBlobSrc(full, mime)
    const dataUrl = await fileToDataUrl(full, mime)

    logger.info('[save] upload video persisted', full)
    return { fullPath: full, displaySrc, dataUrl }
  }

  const dataUrl = bytesToDataUrl(bytes, mime)
  const displaySrc = URL.createObjectURL(new Blob([bytes], { type: mime }))
  return { fullPath: full, displaySrc, dataUrl }
}

export async function saveBase64ToUploads(
  base64: string
): Promise<{ fullPath: string; displaySrc: string; relativePath: string }> {
  const matches = base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/)
  if (!matches || matches.length !== 3) {
    throw new Error('Invalid base64 string')
  }
  const type = matches[1]
  const data = atob(matches[2])
  const len = data.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = data.charCodeAt(i)
  }

  const hash = await sha256Hex(bytes.buffer)
  const ext = type.split('/')[1] === 'jpeg' ? 'jpg' : (type.split('/')[1] || 'png')
  const name = `${hash}.${ext}`

  const uploadsPath = await getUploadsPath()
  const full = await path.join(uploadsPath, name)

  await mkdir(uploadsPath, { recursive: true })
  let exists = false
  try {
    await readFile(full)
    exists = true
  } catch { }

  if (!exists) {
    await writeFile(full, bytes)
    logger.info('[save] base64 image persisted', full)
  } else {
    logger.info('[save] base64 image already exists (hash match)', full)
  }

  const displaySrc = convertFileSrc(full)
  return { fullPath: full, displaySrc, relativePath: name }
}

export async function saveBytesToUploads(
  bytes: Uint8Array,
  mimeType: string
): Promise<{ fullPath: string; displaySrc: string; relativePath: string }> {
  const hash = await sha256Hex(bytes.buffer as ArrayBuffer)
  const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : (mimeType.split('/')[1] || 'dat')
  const name = `${hash}.${ext}`

  const uploadsPath = await getUploadsPath()
  const full = await path.join(uploadsPath, name)

  await mkdir(uploadsPath, { recursive: true })
  let exists = false
  try {
    await readFile(full)
    exists = true
  } catch { }
  if (!exists) {
    await writeFile(full, bytes)
    logger.info('[save] bytes persisted', full)
  } else {
    logger.info('[save] bytes already exists (hash match)', full)
  }

  const displaySrc = convertFileSrc(full)
  return { fullPath: full, displaySrc, relativePath: name }
}

export async function deleteUploads(paths: string[]): Promise<void> {
  for (const p of paths) {
    try {
      await remove(p)
    } catch (e) {
      logger.error('[save] delete upload failed', { data: [p, e] })
    }
  }
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  if (dataUrl.startsWith('data:')) {
    const parts = dataUrl.split(',')
    const header = parts[0]
    const base64 = parts[1]
    const mimeMatch = header.match(/data:(.*?);base64/)
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream'
    const binary = atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i)
    return new Blob([bytes], { type: mime })
  }
  try {
    const res = await fetch(dataUrl)
    return await res.blob()
  } catch {
    const res = await httpFetch(dataUrl, { method: 'GET' })
    const buf = await res.arrayBuffer()
    return new Blob([new Uint8Array(buf)], { type: inferMimeFromPathShared(dataUrl) })
  }
}

export async function ensureCompressedJpegBytesWithPica(
  blob: Blob,
  opts?: { maxPixels?: number; quality?: number; maxDimension?: number }
): Promise<Uint8Array> {
  const maxPixels = opts?.maxPixels ?? 17_000_000
  const quality = opts?.quality ?? 0.85
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(blob)
  } catch { }

  const cleanup: Array<() => void> = []
  let w0 = 0
  let h0 = 0
  let srcCanvas: HTMLCanvasElement

  if (bitmap) {
    w0 = bitmap.width
    h0 = bitmap.height
    srcCanvas = document.createElement('canvas')
    srcCanvas.width = w0
    srcCanvas.height = h0
    const sctx = srcCanvas.getContext('2d')!
    sctx.drawImage(bitmap, 0, 0)
  } else {
    const url = URL.createObjectURL(blob)
    cleanup.push(() => URL.revokeObjectURL(url))
    const img = new Image()
    const p = new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img)
      img.onerror = reject
    })
    img.src = url
    const image = await p
    w0 = image.naturalWidth || image.width
    h0 = image.naturalHeight || image.height
    srcCanvas = document.createElement('canvas')
    srcCanvas.width = w0
    srcCanvas.height = h0
    const sctx = srcCanvas.getContext('2d')!
    sctx.drawImage(image, 0, 0)
  }

  const total = w0 * h0
  const scalePixels = total > maxPixels ? Math.sqrt(maxPixels / total) : 1
  const maxDim = opts?.maxDimension ?? Infinity
  const scaleDim = Math.min(1, maxDim / Math.max(w0, h0))
  const scale = Math.min(scalePixels, scaleDim)
  const w = Math.max(1, Math.floor(w0 * scale))
  const h = Math.max(1, Math.floor(h0 * scale))
  const destCanvas = document.createElement('canvas')
  destCanvas.width = w
  destCanvas.height = h

  try {
    const pica = new Pica()
    await pica.resize(srcCanvas, destCanvas, { quality: 3 })
    const outBlob: Blob = await pica.toBlob(destCanvas, 'image/jpeg', quality)
    const buf = await outBlob.arrayBuffer()
    return new Uint8Array(buf)
  } catch (_e) {
    const dctx = destCanvas.getContext('2d')!
    dctx.drawImage(srcCanvas, 0, 0, w, h)
    const dataUrl = destCanvas.toDataURL('image/jpeg', quality)
    const base64 = dataUrl.split(',')[1]
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } finally {
    cleanup.forEach(fn => { try { fn() } catch { } })
  }
}
