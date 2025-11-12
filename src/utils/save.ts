import { BaseDirectory, writeFile, mkdir, readFile } from '@tauri-apps/plugin-fs'
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
