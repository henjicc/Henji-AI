import { BaseDirectory, writeFile, mkdir, readFile, remove } from '@tauri-apps/plugin-fs'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import * as path from '@tauri-apps/api/path'
import { convertFileSrc } from '@tauri-apps/api/core'

export const isDesktop = (): boolean => {
  const w: any = typeof window !== 'undefined' ? window : {}
  if (w && w.__TAURI__ && typeof w.__TAURI__.invoke === 'function') return true
  if (w && (w.__TAURI__ || w.__TAURI_INTERNALS__)) return true
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) ? navigator.userAgent : ''
  return /Tauri|Wry/i.test(ua)
}

export const isDesktopAsync = async (): Promise<boolean> => {
  try {
    await path.appLocalDataDir()
    return true
  } catch {
    return false
  }
}

export async function saveBinary(data: Uint8Array, filename: string): Promise<{ fullPath: string; webSrc: string }> {
  const rel = await path.join('Henji-AI', 'Media', filename)
  await mkdir('Henji-AI/Media', { baseDir: BaseDirectory.AppLocalData, recursive: true })
  await writeFile(rel, data, { baseDir: BaseDirectory.AppLocalData })
  const full = await path.join(await path.appLocalDataDir(), 'Henji-AI', 'Media', filename)
  const webSrc = convertFileSrc(full)
  console.log('[save] wrote file', full)
  return { fullPath: full, webSrc }
}

export async function saveImageFromUrl(url: string, filename?: string): Promise<{ fullPath: string; webSrc: string }> {
  const res = await httpFetch(url, { method: 'GET' })
  const buf = await res.arrayBuffer()
  const array = new Uint8Array(buf)
  // 内容类型可能不可用，基于 URL 简单判断
  const lower = url.toLowerCase()
  const ext = lower.includes('.png') ? 'png' : lower.includes('.jpg') || lower.includes('.jpeg') ? 'jpg' : 'png'
  const name = filename ?? `image-${Date.now()}.${ext}`
  const saved = await saveBinary(array, name)
  console.log('[save] image saved', saved.fullPath)
  return saved
}

export async function saveVideoFromUrl(url: string, filename?: string): Promise<{ fullPath: string; webSrc: string }> {
  const res = await httpFetch(url, { method: 'GET' })
  const buf = await res.arrayBuffer()
  const array = new Uint8Array(buf)
  const lower = url.toLowerCase()
  const ext = lower.includes('.mp4') ? 'mp4' : lower.includes('.webm') ? 'webm' : 'mp4'
  const name = filename ?? `video-${Date.now()}.${ext}`
  const saved = await saveBinary(array, name)
  console.log('[save] video saved', saved.fullPath)
  return saved
}

export async function fileToBlobSrc(fullPath: string, mimeHint?: string): Promise<string> {
  const bytes = await readFile(fullPath)
  const blob = new Blob([bytes], { type: mimeHint || inferMimeFromPath(fullPath) })
  const url = URL.createObjectURL(blob)
  console.log('[save] display blob created', fullPath)
  return url
}

function inferMimeFromPath(p: string): string {
  const lower = p.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  return 'application/octet-stream'
}

export async function fileToDataUrl(fullPath: string, mimeHint?: string): Promise<string> {
  const bytes = await readFile(fullPath)
  const blob = new Blob([bytes], { type: mimeHint || inferMimeFromPath(fullPath) })
  const reader = new FileReader()
  const p = new Promise<string>((resolve, reject) => {
    reader.onloadend = () => resolve(reader.result as string)
    reader.onerror = (e) => reject(e)
  })
  reader.readAsDataURL(blob)
  return p
}

const uploadCache: Map<string, { bytes: Uint8Array; dataUrl: string; displaySrc: string; compressedHash: string }> = new Map()

function bytesToDataUrl(bytes: Uint8Array, mime: string): string {
  const bin = Array.from(bytes).map(b => String.fromCharCode(b)).join('')
  const base64 = btoa(bin)
  return `data:${mime};base64,${base64}`
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const hashBuf = await crypto.subtle.digest('SHA-256', buf)
  const hashArr = Array.from(new Uint8Array(hashBuf))
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function saveUploadImage(fileOrBlob: File | Blob, mode: 'memory' | 'persist' = 'persist', opts?: { maxDimension?: number }): Promise<{ fullPath: string; displaySrc: string; dataUrl: string }> {
  const mime = 'image/jpeg'
  const ext = 'jpg'
  const originalBuf = await (fileOrBlob as Blob).arrayBuffer()
  const originalHash = await sha256Hex(originalBuf)
  let cached = uploadCache.get(originalHash)
  if (!cached) {
    const bytes = await ensureCompressedJpegBytesWithPica(fileOrBlob as Blob, { maxPixels: 17_000_000, quality: 0.85, maxDimension: opts?.maxDimension })
    const dataUrl = bytesToDataUrl(bytes, mime)
    const displaySrc = URL.createObjectURL(new Blob([bytes], { type: mime }))
    const compressedHash = await sha256Hex(bytes.buffer)
    cached = { bytes, dataUrl, displaySrc, compressedHash }
    uploadCache.set(originalHash, cached)
  }
  const name = `upload-${cached.compressedHash}.${ext}`
  const rel = await path.join('Henji-AI', 'Uploads', name)
  const full = await path.join(await path.appLocalDataDir(), 'Henji-AI', 'Uploads', name)
  if (mode === 'persist') {
    await mkdir('Henji-AI/Uploads', { baseDir: BaseDirectory.AppLocalData, recursive: true })
    let exists = false
    try { await readFile(full); exists = true } catch {}
    if (!exists) {
      await writeFile(rel, cached.bytes, { baseDir: BaseDirectory.AppLocalData })
    }
    const displaySrc = await fileToBlobSrc(full, mime)
    const dataUrl = await fileToDataUrl(full, mime)
    console.log('[save] upload image persisted', full)
    return { fullPath: full, displaySrc, dataUrl }
  } else {
    return { fullPath: full, displaySrc: cached.displaySrc, dataUrl: cached.dataUrl }
  }
}

export async function deleteUploads(paths: string[]): Promise<void> {
  for (const p of paths) {
    try { await remove(p) } catch (e) { console.error('[save] delete upload failed', p, e) }
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
    return new Blob([new Uint8Array(buf)], { type: inferMimeFromPath(dataUrl) })
  }
}

async function ensureCompressedJpegBytesWithPica(blob: Blob, opts?: { maxPixels?: number; quality?: number; maxDimension?: number }): Promise<Uint8Array> {
  const maxPixels = opts?.maxPixels ?? 17_000_000
  const quality = opts?.quality ?? 0.85
  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(blob)
  } catch {}

  const cleanup: Array<() => void> = []
  let w0 = 0, h0 = 0
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
    const mod = await import('pica')
    const Pica = (mod as any).default || mod
    const p = typeof Pica === 'function' ? Pica() : new Pica()
    await p.resize(srcCanvas, destCanvas, { quality: 3, alpha: false })
    const outBlob: Blob = await p.toBlob(destCanvas, 'image/jpeg', quality)
    const buf = await outBlob.arrayBuffer()
    return new Uint8Array(buf)
  } catch (e) {
    const dctx = destCanvas.getContext('2d')!
    dctx.drawImage(srcCanvas, 0, 0, w, h)
    const dataUrl = destCanvas.toDataURL('image/jpeg', quality)
    const base64 = dataUrl.split(',')[1]
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } finally {
    cleanup.forEach(fn => { try { fn() } catch {} })
  }
}

export async function writeJsonToAppData(relPath: string, data: any): Promise<void> {
  await mkdir('Henji-AI', { baseDir: BaseDirectory.AppLocalData, recursive: true })
  const json = JSON.stringify(data)
  const bytes = new TextEncoder().encode(json)
  await writeFile(relPath.startsWith('Henji-AI') ? relPath : `Henji-AI/${relPath}`, bytes, { baseDir: BaseDirectory.AppLocalData })
}

export async function readJsonFromAppData<T = any>(relPath: string): Promise<T | null> {
  try {
    const bytes = await readFile(relPath.startsWith('Henji-AI') ? relPath : `Henji-AI/${relPath}`, { baseDir: BaseDirectory.AppLocalData } as any)
    const json = new TextDecoder().decode(bytes as any)
    return JSON.parse(json) as T
  } catch {
    return null
  }
}
