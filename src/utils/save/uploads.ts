import { createLogger } from '@/core/logging'
import {
  getPathForFile,
  join,
  mkdir,
  nativeFetch as httpFetch,
  readFile,
  remove,
  toDisplaySrc,
  writeFile,
} from '@/platform/desktopApi'
import {
  grantMediaAccessForReference,
  resolveLargeUploadAction,
} from '@/services/largeUploadPolicy'
import { getUploadsPath } from '@/utils/dataPath'
import { inferMimeFromPath as inferMimeFromPathShared } from '@/utils/mime'
import { fileToBlobSrc, fileToDataUrl, bytesToDataUrl } from './fileUrls'
import { sha256Hex } from './hash'

const logger = createLogger('utils.save.uploads')

const uploadCache: Map<string, { bytes: Uint8Array; dataUrl: string; displaySrc: string; compressedHash: string }> = new Map()

function normalizeBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const normalized = new Uint8Array(bytes.byteLength)
  normalized.set(bytes)
  return normalized
}

export async function saveUploadImage(
  fileOrBlob: File | Blob,
  mode: 'memory' | 'persist' = 'persist',
  opts?: { maxDimension?: number }
): Promise<{ fullPath: string; displaySrc: string; dataUrl: string }> {
  // Fast path: use main process sharp when a real file path is available
  if (fileOrBlob instanceof File) {
    const filePath = getPathForFile(fileOrBlob)
    if (filePath) {
      const result = await window.henjiNative!.image.compressImageSource({
        source: filePath,
        maxPixels: 17_000_000,
        quality: 0.85,
        maxDimension: opts?.maxDimension,
      })
      const displaySrc = await fileToBlobSrc(result.fullPath, 'image/jpeg')
      return { fullPath: result.fullPath, displaySrc, dataUrl: result.dataUrl }
    }
  }

  const mime = 'image/jpeg'
  const ext = 'jpg'
  const originalBuf = await (fileOrBlob as Blob).arrayBuffer()
  const originalHash = await sha256Hex(originalBuf)
  let cached = uploadCache.get(originalHash)

  if (!cached) {
    const bytes = normalizeBytes(await ensureCompressedJpegBytesWithPica(fileOrBlob as Blob, {
      maxPixels: 17_000_000,
      quality: 0.85,
      maxDimension: opts?.maxDimension,
    }))
    const dataUrl = bytesToDataUrl(bytes, mime)
    const displaySrc = URL.createObjectURL(new Blob([bytes], { type: mime }))
    const compressedHash = await sha256Hex(bytes.buffer as ArrayBuffer)
    cached = { bytes, dataUrl, displaySrc, compressedHash }
    uploadCache.set(originalHash, cached)
  }

  const name = `${cached.compressedHash}.${ext}`
  const uploadsPath = await getUploadsPath()
  const full = await join(uploadsPath, name)

  if (mode === 'persist') {
    await mkdir(uploadsPath, { recursive: true })
    let exists = false
    try {
      await readFile(full)
      exists = true
    } catch {
      // Missing cached file means it needs to be written.
    }
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

  // 大文件策略（用户约定，见 services/largeUploadPolicy.ts）：
  // ≤100MB 一律复制进 Uploads；>100MB 按设置执行（每次询问 / 复制 / 引用原路径）。
  // 引用模式会主动授权原文件所在目录给 henji-media 协议（授权持久化，重启不失效），
  // 避免复制几百 MB 视频的读取+哈希+落盘耗时；复制模式更稳妥但大文件较慢。
  if (mode === 'persist') {
    const directPath = getPathForFile(file)
    const action = await resolveLargeUploadAction(file, directPath ?? null)
    if (action === 'reference' && directPath) {
      await grantMediaAccessForReference(directPath)
      logger.info('[save] upload video referenced source path (no copy)', directPath)
      return { fullPath: directPath, displaySrc: toDisplaySrc(directPath), dataUrl: '' }
    }
  }

  const originalBuf = await file.arrayBuffer()
  const bytes = new Uint8Array(originalBuf)
  const hash = await sha256Hex(originalBuf)

  const name = `${hash}.${ext}`
  const uploadsPath = await getUploadsPath()
  const full = await join(uploadsPath, name)

  if (mode === 'persist') {
    await mkdir(uploadsPath, { recursive: true })

    let exists = false
    try {
      await readFile(full)
      exists = true
    } catch {
      // Missing cached file means it needs to be written.
    }

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

function resolveAudioMimeAndExt(file: File): { mime: string; ext: string } {
  const inferredMime = inferMimeFromPathShared(file.name, { fallback: 'audio/mpeg' })
  const mime = (file.type && file.type.trim().length > 0) ? file.type : inferredMime
  const normalized = mime.toLowerCase()

  if (normalized.includes('wav')) {
    return { mime, ext: 'wav' }
  }
  if (normalized.includes('flac')) {
    return { mime, ext: 'flac' }
  }
  if (normalized.includes('ogg')) {
    return { mime, ext: 'ogg' }
  }
  if (normalized.includes('m4a') || normalized.includes('mp4')) {
    return { mime, ext: 'm4a' }
  }
  if (normalized.includes('pcm')) {
    return { mime, ext: 'pcm' }
  }

  return { mime, ext: 'mp3' }
}

export async function saveUploadAudio(
  file: File,
  mode: 'memory' | 'persist' = 'persist'
): Promise<{ fullPath: string; displaySrc: string; dataUrl: string }> {
  const { mime, ext } = resolveAudioMimeAndExt(file)

  // 与视频一致的大文件策略：>100MB 的音频（长录音/无损）按设置选择复制或引用原路径
  if (mode === 'persist') {
    const directPath = getPathForFile(file)
    const action = await resolveLargeUploadAction(file, directPath ?? null)
    if (action === 'reference' && directPath) {
      await grantMediaAccessForReference(directPath)
      logger.info('[save] upload audio referenced source path (no copy)', directPath)
      return { fullPath: directPath, displaySrc: toDisplaySrc(directPath), dataUrl: '' }
    }
  }

  const originalBuf = await file.arrayBuffer()
  const bytes = new Uint8Array(originalBuf)
  const hash = await sha256Hex(originalBuf)
  const name = `${hash}.${ext}`

  const uploadsPath = await getUploadsPath()
  const full = await join(uploadsPath, name)

  if (mode === 'persist') {
    await mkdir(uploadsPath, { recursive: true })

    let exists = false
    try {
      await readFile(full)
      exists = true
    } catch {
      // Missing cached file means it needs to be written.
    }

    if (!exists) {
      await writeFile(full, bytes)
    }

    const displaySrc = await fileToBlobSrc(full, mime)
    const dataUrl = await fileToDataUrl(full, mime)

    logger.info('[save] upload audio persisted', full)
    return { fullPath: full, displaySrc, dataUrl }
  }

  const dataUrl = bytesToDataUrl(bytes, mime)
  const displaySrc = URL.createObjectURL(new Blob([bytes], { type: mime }))
  return { fullPath: full, displaySrc, dataUrl }
}

export async function saveBase64ToUploads(
  base64: string
): Promise<{ fullPath: string; displaySrc: string; relativePath: string }> {
  const matches = base64.match(/^data:([A-Za-z-+/]+);base64,(.+)$/)
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
  const full = await join(uploadsPath, name)

  await mkdir(uploadsPath, { recursive: true })
  let exists = false
  try {
    await readFile(full)
    exists = true
  } catch {
    // Missing cached file means it needs to be written.
  }

  if (!exists) {
    await writeFile(full, bytes)
    logger.info('[save] base64 image persisted', full)
  } else {
    logger.info('[save] base64 image already exists (hash match)', full)
  }

  const displaySrc = toDisplaySrc(full)
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
  const full = await join(uploadsPath, name)

  await mkdir(uploadsPath, { recursive: true })
  let exists = false
  try {
    await readFile(full)
    exists = true
  } catch {
    // Missing cached file means it needs to be written.
  }
  if (!exists) {
    await writeFile(full, bytes)
    logger.info('[save] bytes persisted', full)
  } else {
    logger.info('[save] bytes already exists (hash match)', full)
  }

  const displaySrc = toDisplaySrc(full)
  return { fullPath: full, displaySrc, relativePath: name }
}

/**
 * 判断一个路径是否落在本应用托管的 Uploads 目录内。
 *
 * saveUploadVideo 现在可能直接复用用户磁盘上的原始文件路径（见 getPathForFile 快路径），
 * 不再保证"凡是出现在 uploadedXxxFilePaths 里的路径都是 Uploads 目录下的自有副本"。
 * 任何要"删除已上传文件"的清理逻辑（如删除历史任务时清理上传源文件）必须先用这个函数确认
 * 路径在托管目录内，否则可能把用户自己磁盘上的原始文件删掉。
 */
export async function isWithinUploadsDir(filePath: string): Promise<boolean> {
  const uploadsPath = await getUploadsPath()
  const normalize = (p: string): string => p.replace(/\\/g, '/').toLowerCase()
  const normalizedUploads = normalize(uploadsPath).replace(/\/$/, '')
  const normalizedTarget = normalize(filePath)
  return normalizedTarget === normalizedUploads || normalizedTarget.startsWith(`${normalizedUploads}/`)
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
  } catch {
    // createImageBitmap may fail for uncommon image encodings.
  }

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
    // pica 只在这一处缩放用到，静态导入会把它压进启动 chunk；
    // 本函数已是 async 且带 catch 兜底，动态导入失败会自然回落到下方 canvas 缩放。
    const { default: Pica } = await import('pica')
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
    cleanup.forEach(fn => {
      try {
        fn()
      } catch {
        // Ignore cleanup failures.
      }
    })
  }
}
