import { app } from 'electron'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getCustomDataRoot } from '../dataRoot'

const APP_IDENTIFIER = 'com.henji.ai'

export function normalizeExtension(rawExt: string | undefined): string {
  const ext = (rawExt ?? '').trim().replace(/^\./, '').toLowerCase()
  if (!ext) return 'png'
  return ext === 'jpeg' ? 'jpg' : ext
}

export function extensionFromMime(mime: string | undefined): string {
  const normalized = (mime ?? '').trim().toLowerCase().split(';')[0]
  if (normalized === 'image/png') return 'png'
  if (normalized === 'image/jpeg' || normalized === 'image/jpg') return 'jpg'
  if (normalized === 'image/webp') return 'webp'
  if (normalized === 'image/gif') return 'gif'
  if (normalized === 'image/bmp') return 'bmp'
  if (normalized === 'image/avif') return 'avif'
  return 'png'
}

export function mimeFromExtension(extension: string | undefined): string {
  switch (normalizeExtension(extension)) {
    case 'png': return 'image/png'
    case 'jpg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    case 'bmp': return 'image/bmp'
    case 'avif': return 'image/avif'
    default: return 'application/octet-stream'
  }
}

export function getDataRootDir(): string {
  const custom = getCustomDataRoot()
  const root = custom
    ? custom
    : path.join(
        process.platform === 'win32' && process.env.LOCALAPPDATA
          ? path.join(process.env.LOCALAPPDATA, APP_IDENTIFIER)
          : path.join(app.getPath('appData'), APP_IDENTIFIER),
        'Henji-AI'
      )
  fs.mkdirSync(root, { recursive: true })
  return root
}

export function getUploadsDir(): string {
  const uploads = path.join(getDataRootDir(), 'Uploads')
  fs.mkdirSync(uploads, { recursive: true })
  return uploads
}

export function getDebugDir(category: string): string {
  const debugDir = path.join(getDataRootDir(), 'debug', sanitizeFileStem(category))
  fs.mkdirSync(debugDir, { recursive: true })
  return debugDir
}

export function persistImageBytes(bytes: Buffer, extension: string | undefined): string {
  return persistImageBytesTracked(bytes, extension).filePath
}

export interface PersistedImageBytes {
  filePath: string
  created: boolean
}

/** 供需要失败回滚的批处理使用；只能删除本次新建的内容寻址文件。 */
export function persistImageBytesTracked(bytes: Buffer, extension: string | undefined): PersistedImageBytes {
  if (bytes.length === 0) {
    throw new Error('Image bytes are empty')
  }
  const digest = crypto.createHash('md5').update(bytes).digest('hex')
  const ext = normalizeExtension(extension)
  const targetPath = path.join(getUploadsDir(), `${digest}.${ext}`)
  const created = !fs.existsSync(targetPath)
  if (created) {
    fs.writeFileSync(targetPath, bytes)
  }
  return { filePath: targetPath, created }
}

export function rollbackPersistedImageBytes(entry: PersistedImageBytes): void {
  if (!entry.created) return
  try {
    fs.rmSync(entry.filePath, { force: true })
  } catch {
    // 失败回滚属于 best-effort；原始错误必须继续上抛。
  }
}

export function releaseManagedImagePaths(filePaths: readonly string[]): void {
  const uploadsDir = path.resolve(getUploadsDir())
  const prefix = `${uploadsDir}${path.sep}`
  for (const filePath of new Set(filePaths)) {
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(prefix)) throw new Error('只能释放 Uploads 目录内的受管图片')
    fs.rmSync(resolved, { force: true })
  }
}

/** 通用生成事务回滚入口；只接受应用数据根内的 Uploads/Media 受管文件。 */
export function releaseManagedGenerationMediaPaths(filePaths: readonly string[]): void {
  const managedRoots = ['Uploads', 'Media'].map((segment) => path.resolve(getDataRootDir(), segment))
  for (const filePath of new Set(filePaths)) {
    const resolved = path.resolve(filePath)
    if (!managedRoots.some((root) => resolved.startsWith(`${root}${path.sep}`))) {
      throw new Error('只能释放应用数据目录内的受管生成媒体')
    }
    fs.rmSync(resolved, { force: true })
  }
}

export function sanitizeFileStem(raw: string | undefined): string {
  const trimmed = (raw ?? '').trim()
  if (!trimmed) return 'storyboard-image'
  const sanitized = Array.from(trimmed)
    .filter((char) => !isBlockedFilenameChar(char))
    .join('')
    .trim()
    .replace(/^\.+|\.+$/g, '')
  return sanitized || 'storyboard-image'
}

function isBlockedFilenameChar(char: string): boolean {
  return char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char)
}

export function ensureUniquePath(targetPath: string): string {
  if (!fs.existsSync(targetPath)) return targetPath
  const parsed = path.parse(targetPath)
  for (let index = 1; index < 10000; index += 1) {
    const candidate = path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`)
    if (!fs.existsSync(candidate)) return candidate
  }
  return targetPath
}

export function ensureOutputPathWithExtension(targetPath: string, extension: string): string {
  return path.extname(targetPath) ? targetPath : `${targetPath}.${normalizeExtension(extension)}`
}

export function writeBytesToPath(targetPath: string, bytes: Buffer): void {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  fs.writeFileSync(targetPath, bytes)
}
