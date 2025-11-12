import { BaseDirectory, writeFile, mkdir, readFile, remove } from '@tauri-apps/plugin-fs'
import { fetch as httpFetch } from '@tauri-apps/plugin-http'
import * as path from '@tauri-apps/api/path'
import { convertFileSrc } from '@tauri-apps/api/core'

export const isDesktop = (): boolean => {
  const w: any = typeof window !== 'undefined' ? window : {}
  return ('__TAURI__' in w) || (typeof navigator !== 'undefined' && !!navigator.userAgent && (navigator.userAgent.includes('Tauri') || navigator.userAgent.includes('Wry')))
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

export async function saveUploadImage(fileOrBlob: File | Blob): Promise<{ fullPath: string; displaySrc: string; dataUrl: string }> {
  const mime = 'image/png'
  const ext = 'png'
  await mkdir('Henji-AI/Uploads', { baseDir: BaseDirectory.AppLocalData, recursive: true })
  const arrayBuffer = await (fileOrBlob as Blob).arrayBuffer()
  const hashBuf = await crypto.subtle.digest('SHA-256', arrayBuffer)
  const hashArr = Array.from(new Uint8Array(hashBuf))
  const hashHex = hashArr.map(b => b.toString(16).padStart(2, '0')).join('')
  const name = `upload-${hashHex}.${ext}`
  const rel = await path.join('Henji-AI', 'Uploads', name)
  const full = await path.join(await path.appLocalDataDir(), 'Henji-AI', 'Uploads', name)
  try {
    await readFile(full)
  } catch {
    const array = await ensurePngBytes(fileOrBlob as Blob)
    await writeFile(rel, array, { baseDir: BaseDirectory.AppLocalData })
  }
  const displaySrc = await fileToBlobSrc(full, mime)
  const dataUrl = await fileToDataUrl(full, mime)
  console.log('[save] upload image saved', full)
  return { fullPath: full, displaySrc, dataUrl }
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

async function ensurePngBytes(blob: Blob): Promise<Uint8Array> {
  const url = URL.createObjectURL(blob)
  try {
    const img = new Image()
    const p = new Promise<HTMLImageElement>((resolve, reject) => {
      img.onload = () => resolve(img)
      img.onerror = reject
    })
    img.src = url
    const image = await p
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth || image.width
    canvas.height = image.naturalHeight || image.height
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(image, 0, 0)
    const pngDataUrl = canvas.toDataURL('image/png')
    const base64 = pngDataUrl.split(',')[1]
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } finally {
    URL.revokeObjectURL(url)
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
