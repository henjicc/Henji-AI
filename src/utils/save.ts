import { BaseDirectory, writeFile, mkdir, readFile, remove } from '@tauri-apps/plugin-fs'
import Pica from 'pica'
import { save as saveDialog } from '@tauri-apps/plugin-dialog'
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

export async function saveAudioFromUrl(url: string, filename?: string): Promise<{ fullPath: string; webSrc: string }> {
  const res = await httpFetch(url, { method: 'GET' })
  const buf = await res.arrayBuffer()
  const array = new Uint8Array(buf)
  const lower = url.toLowerCase()
  const ext = lower.includes('.mp3') ? 'mp3' : lower.includes('.wav') ? 'wav' : lower.includes('.flac') ? 'flac' : lower.includes('.pcm') ? 'pcm' : 'mp3'
  const name = filename ?? `audio-${Date.now()}.${ext}`
  const saved = await saveBinary(array, name)
  console.log('[save] audio saved', saved.fullPath)
  return saved
}

// 从文件路径提取扩展名
function getFileExtension(filePath: string): string {
  const fileName = filePath.split(/\\|\//).pop() || ''
  const match = fileName.match(/\.([^.]+)$/)
  return match ? match[1].toLowerCase() : ''
}

// 确保文件名有正确的扩展名（防止重复）
function ensureExtension(fileName: string, extension: string): string {
  const ext = extension.startsWith('.') ? extension : `.${extension}`
  const lowerFileName = fileName.toLowerCase()
  const lowerExt = ext.toLowerCase()

  // 如果文件名已经有这个扩展名，直接返回
  if (lowerFileName.endsWith(lowerExt)) {
    return fileName
  }

  // 否则追加扩展名
  return fileName + ext
}

export async function downloadAudioFile(sourcePath: string, suggestedName?: string): Promise<string> {
  const name = suggestedName ?? (sourcePath.split(/\\|\//).pop() || `audio-${Date.now()}.mp3`)
  const ext = getFileExtension(sourcePath) || 'mp3'

  // 设置文件过滤器
  const filters = [
    {
      name: '音频文件',
      extensions: [ext]
    }
  ]

  const target = await saveDialog({
    defaultPath: name,
    filters
  }) as string | null

  if (!target) throw new Error('cancelled')

  // 确保保存的文件有正确的扩展名
  const finalTarget = ensureExtension(target, ext)

  const bytes = await readFile(sourcePath)
  await writeFile(finalTarget, bytes as any)

  console.log('[save] 音频文件已保存:', finalTarget)
  return finalTarget
}

export async function downloadMediaFile(sourcePath: string, suggestedName?: string): Promise<string> {
  const name = suggestedName ?? (sourcePath.split(/\\|\//).pop() || `media-${Date.now()}`)
  const ext = getFileExtension(sourcePath)

  if (!ext) {
    throw new Error('无法确定文件类型')
  }

  // 根据扩展名设置过滤器名称和扩展名列表
  let filterName = '媒体文件'
  const extensions = [ext]

  // 图片格式
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) {
    filterName = '图片文件'
  }
  // 视频格式
  else if (['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext)) {
    filterName = '视频文件'
  }
  // 音频格式
  else if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'pcm'].includes(ext)) {
    filterName = '音频文件'
  }

  const filters = [
    {
      name: filterName,
      extensions
    }
  ]

  const target = await saveDialog({
    defaultPath: name,
    filters
  }) as string | null

  if (!target) throw new Error('cancelled')

  // 确保保存的文件有正确的扩展名
  const finalTarget = ensureExtension(target, ext)

  const bytes = await readFile(sourcePath)
  await writeFile(finalTarget, bytes as any)

  console.log('[save] 媒体文件已保存:', finalTarget)
  return finalTarget
}

export async function quickDownloadMediaFile(sourcePath: string, targetDir: string, suggestedName?: string): Promise<string> {
  try {
    console.log('[save] 快速下载开始:', { sourcePath, targetDir, suggestedName })

    // 验证源文件路径
    if (!sourcePath) {
      throw new Error('源文件路径为空')
    }

    // 验证目标目录
    if (!targetDir) {
      throw new Error('目标目录路径为空，请先在设置中配置快速下载路径')
    }

    // 生成目标文件名
    const name = suggestedName ?? (sourcePath.split(/\\|\//).pop() || `media-${Date.now()}`)
    console.log('[save] 目标文件名:', name)

    // 构建完整的目标路径
    const target = await path.join(targetDir, name)
    console.log('[save] 完整目标路径:', target)

    // 确保目标目录存在（尝试创建，如果已存在会被忽略）
    try {
      // 注意：这里不能直接创建 targetDir，因为它可能是系统路径
      // 我们只是尝试读取源文件并写入目标位置
      const bytes = await readFile(sourcePath)
      console.log('[save] 源文件读取成功，大小:', bytes.length, 'bytes')

      await writeFile(target, bytes as any)
      console.log('[save] 快速下载成功保存到:', target)

      return target
    } catch (error) {
      console.error('[save] 文件操作失败:', error)
      if (error instanceof Error) {
        throw new Error(`文件保存失败: ${error.message}`)
      }
      throw new Error('文件保存失败')
    }
  } catch (error) {
    console.error('[save] 快速下载失败:', error)
    throw error // 重新抛出异常，让调用者处理
  }
}

async function sha256HexString(input: string): Promise<string> {
  const enc = new TextEncoder().encode(input)
  const hashBuf = await crypto.subtle.digest('SHA-256', enc)
  const hashArr = Array.from(new Uint8Array(hashBuf))
  return hashArr.map(b => b.toString(16).padStart(2, '0')).join('')
}

async function waveformCachePaths(audioFullPath: string): Promise<{ rel: string; full: string }> {
  const hash = await sha256HexString(audioFullPath)
  const name = `${hash}.json`
  const rel = await path.join('Henji-AI', 'Waveforms', name)
  const full = await path.join(await path.appLocalDataDir(), 'Henji-AI', 'Waveforms', name)
  return { rel, full }
}

export async function readWaveformCacheForAudio(audioFullPath: string): Promise<number[] | null> {
  try {
    const { full } = await waveformCachePaths(audioFullPath)
    const bytes = await readFile(full)
    const text = new TextDecoder().decode(bytes as any)
    const data = JSON.parse(text)
    if (Array.isArray(data)) return data as number[]
    if (Array.isArray(data?.samples)) return data.samples as number[]
    return null
  } catch {
    return null
  }
}

export async function writeWaveformCacheForAudio(audioFullPath: string, samples: number[]): Promise<string> {
  const { rel, full } = await waveformCachePaths(audioFullPath)
  await mkdir('Henji-AI/Waveforms', { baseDir: BaseDirectory.AppLocalData, recursive: true })
  const payload = JSON.stringify(samples)
  await writeFile(rel, new TextEncoder().encode(payload), { baseDir: BaseDirectory.AppLocalData })
  return full
}

export async function deleteWaveformCacheForAudio(audioFullPath: string): Promise<void> {
  try {
    const { full } = await waveformCachePaths(audioFullPath)
    await remove(full)
  } catch (e) {
    console.warn('[save] delete waveform cache failed', e)
  }
}

export async function fileToBlobSrc(fullPath: string, mimeHint?: string): Promise<string> {
  const bytes = await readFile(fullPath)
  const blob = new Blob([bytes], { type: mimeHint || inferMimeFromPath(fullPath) })
  const url = URL.createObjectURL(blob)
  console.log('[save] display blob created', fullPath)
  return url
}

export function inferMimeFromPath(p: string): string {
  const lower = p.toLowerCase()
  if (lower.endsWith('.png')) return 'image/png'
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg'
  if (lower.endsWith('.webp')) return 'image/webp'
  if (lower.endsWith('.mp4')) return 'video/mp4'
  if (lower.endsWith('.webm')) return 'video/webm'
  if (lower.endsWith('.mp3')) return 'audio/mpeg'
  if (lower.endsWith('.wav')) return 'audio/wav'
  if (lower.endsWith('.flac')) return 'audio/flac'
  if (lower.endsWith('.pcm')) return 'audio/pcm'
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
    const displaySrc = URL.createObjectURL(new Blob([bytes as any], { type: mime }))
    const compressedHash = await sha256Hex(bytes.buffer as ArrayBuffer)
    cached = { bytes, dataUrl, displaySrc, compressedHash }
    uploadCache.set(originalHash, cached)
  }
  const name = `upload-${cached.compressedHash}.${ext}`
  const rel = await path.join('Henji-AI', 'Uploads', name)
  const full = await path.join(await path.appLocalDataDir(), 'Henji-AI', 'Uploads', name)
  if (mode === 'persist') {
    await mkdir('Henji-AI/Uploads', { baseDir: BaseDirectory.AppLocalData, recursive: true })
    let exists = false
    try { await readFile(full); exists = true } catch { }
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

/**
 * 保存上传的视频文件到 Uploads 目录
 * 与 saveUploadImage 类似，但不进行压缩处理
 */
export async function saveUploadVideo(file: File, mode: 'memory' | 'persist' = 'persist'): Promise<{ fullPath: string; displaySrc: string; dataUrl: string }> {
  // 获取视频的 MIME 类型和扩展名
  const mime = file.type || 'video/mp4'
  const ext = mime.includes('webm') ? 'webm' : 'mp4'

  // 读取文件内容并计算哈希
  const originalBuf = await file.arrayBuffer()
  const bytes = new Uint8Array(originalBuf)
  const hash = await sha256Hex(originalBuf)

  // 生成文件名和路径
  const name = `upload-video-${hash}.${ext}`
  const rel = await path.join('Henji-AI', 'Uploads', name)
  const full = await path.join(await path.appLocalDataDir(), 'Henji-AI', 'Uploads', name)

  if (mode === 'persist') {
    // 确保目录存在
    await mkdir('Henji-AI/Uploads', { baseDir: BaseDirectory.AppLocalData, recursive: true })

    // 检查文件是否已存在
    let exists = false
    try {
      await readFile(full)
      exists = true
    } catch { }

    // 如果文件不存在，写入文件
    if (!exists) {
      await writeFile(rel, bytes, { baseDir: BaseDirectory.AppLocalData })
    }

    // 生成显示用的 blob URL 和 data URL
    const displaySrc = await fileToBlobSrc(full, mime)
    const dataUrl = await fileToDataUrl(full, mime)

    console.log('[save] upload video persisted', full)
    return { fullPath: full, displaySrc, dataUrl }
  } else {
    // memory 模式：只生成临时 URL
    const dataUrl = bytesToDataUrl(bytes, mime)
    const displaySrc = URL.createObjectURL(new Blob([bytes], { type: mime }))
    return { fullPath: full, displaySrc, dataUrl }
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
  } catch { }

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
    const p = new Pica()
    await p.resize(srcCanvas, destCanvas, { quality: 3 })
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
    cleanup.forEach(fn => { try { fn() } catch { } })
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
