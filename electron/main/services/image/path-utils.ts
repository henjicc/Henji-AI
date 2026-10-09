import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { setImmediate as yieldToIO } from 'node:timers/promises'
import { getProgramStoreDir, getUserFolderDir, getUserRootDir } from '../appPaths'
import { createMainLogger } from '../logging'
import { releaseManagedMediaFileLease } from './managed-media-leases'

const uploadImageLeaseCounts = new Map<string, number>()
const imagePathLocks = new Map<string, Promise<void>>()
const logger = createMainLogger('main.image.files')

/** 内容寻址的写入、lease 取得与释放共用屏障，避免异步写入尚未完成就被复用/删除。 */
async function withImagePathLock<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const previous = imagePathLocks.get(filePath)
  let unlock!: () => void
  const barrier = new Promise<void>((resolve) => { unlock = resolve })
  imagePathLocks.set(filePath, barrier)
  await previous
  try {
    return await operation()
  } finally {
    unlock()
    if (imagePathLocks.get(filePath) === barrier) imagePathLocks.delete(filePath)
  }
}

/** 分块大小是调度粒度，不限制媒体总字节数。 */
export async function hashImageBytes(bytes: Buffer, algorithm: 'md5' | 'sha256' = 'md5'): Promise<string> {
  const hash = crypto.createHash(algorithm)
  const chunkSize = 1024 * 1024
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    if (offset > 0) await yieldToIO()
    hash.update(bytes.subarray(offset, offset + chunkSize))
  }
  return hash.digest('hex')
}

export async function encodeImageBase64(bytes: Buffer): Promise<string> {
  // 必须为 3 的倍数，只有最后一块允许 padding。
  const chunkSize = 3 * 256 * 1024
  let encoded = ''
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    if (offset > 0) await yieldToIO()
    encoded += bytes.subarray(offset, offset + chunkSize).toString('base64')
  }
  return encoded
}

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

/**
 * 用户目录根（默认“文档/痕迹AI”）。生成记录等保存的相对路径以它为基准。
 * 目录唯一来源见 `../appPaths.ts`。
 */
export function getDataRootDir(): string {
  return getUserRootDir()
}

/** 上传素材目录（导入与上传的文件）。 */
export function getUploadsDir(): string {
  return getUserFolderDir('uploads')
}

/** 生成结果目录（独立使用生成、画布时的生成产物）。 */
export function getGeneratedMediaDir(): string {
  return getUserFolderDir('generated')
}

export async function getDebugDir(category: string): Promise<string> {
  const debugDir = path.join(getProgramStoreDir('debug'), sanitizeFileStem(category))
  try {
    await fs.promises.mkdir(debugDir, { recursive: true })
  } catch (error) {
    logger.error('创建图片调试目录失败', { event: 'image.file.directory.failed', error })
    throw error
  }
  return debugDir
}

export async function persistImageBytes(bytes: Buffer, extension: string | undefined): Promise<string> {
  return (await persistContentAddressedImage(bytes, extension, false)).filePath
}

export interface PersistedImageBytes {
  filePath: string
  /** true 表示调用方持有一个可释放 lease，不再只表示本次首次创建了文件。 */
  created: boolean
}

interface ContentAddressedImageResult {
  filePath: string
  created: boolean
}

async function persistContentAddressedImage(
  bytes: Buffer,
  extension: string | undefined,
  tracked: boolean,
): Promise<ContentAddressedImageResult> {
  if (bytes.length === 0) throw new Error('Image bytes are empty')
  const digest = await hashImageBytes(bytes)
  const ext = normalizeExtension(extension)
  const filePath = path.resolve(getUploadsDir(), `${digest}.${ext}`)
  return withImagePathLock(filePath, async () => {
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
    let created = false
    let handle: fs.promises.FileHandle | undefined
    try {
      handle = await fs.promises.open(filePath, 'wx')
    } catch (error) {
      if (!isFileExistsError(error)) {
        logger.error('预留图片文件失败', { event: 'image.file.reserve.failed', error })
        throw error
      }
    }
    if (handle) {
      await writeReservedImage({ filePath, handle }, bytes)
      created = true
    }
    const currentLeaseCount = uploadImageLeaseCounts.get(filePath) ?? 0
    if (tracked && (created || currentLeaseCount > 0)) {
      uploadImageLeaseCounts.set(filePath, currentLeaseCount + 1)
      return { filePath, created: true }
    }
    return { filePath, created }
  }).catch((error: unknown) => {
    logger.error('保存内容寻址图片失败', { event: 'image.file.persist.failed', error })
    throw error
  })
}

async function releaseUploadImageLease(filePath: string): Promise<void> {
  return withImagePathLock(filePath, async () => {
    const leaseCount = uploadImageLeaseCounts.get(filePath)
    if (leaseCount === undefined) {
      await fs.promises.rm(filePath, { force: true })
      return
    }
    if (leaseCount > 1) {
      uploadImageLeaseCounts.set(filePath, leaseCount - 1)
      return
    }
    await fs.promises.rm(filePath, { force: true })
    uploadImageLeaseCounts.delete(filePath)
  }).catch((error: unknown) => {
    logger.error('释放图片文件失败', { event: 'image.file.release.failed', error })
    throw error
  })
}

/**
 * 供需要失败回滚的批处理使用。相同内容在同一进程内并行持有独立 lease，
 * 只有最后一个 lease 释放时才删除文件；进程启动前已存在的文件不取得所有权。
 */
export async function persistImageBytesTracked(bytes: Buffer, extension: string | undefined): Promise<PersistedImageBytes> {
  return persistContentAddressedImage(bytes, extension, true)
}

export async function rollbackPersistedImageBytes(entry: PersistedImageBytes): Promise<void> {
  if (!entry.created) return
  try {
    await releaseUploadImageLease(path.resolve(entry.filePath))
  } catch (error) {
    logger.error('回滚图片文件失败', { event: 'image.file.rollback.failed', error })
    // 失败回滚属于 best-effort；原始错误必须继续上抛。
  }
}

export async function releaseManagedImagePaths(filePaths: readonly string[]): Promise<void> {
  const uploadsDir = path.resolve(getUploadsDir())
  const prefix = `${uploadsDir}${path.sep}`
  for (const filePath of new Set(filePaths)) {
    const resolved = path.resolve(filePath)
    if (!resolved.startsWith(prefix)) throw new Error('只能释放上传素材目录（Uploads）内的受管图片')
    await releaseUploadImageLease(resolved)
  }
}

/** 通用生成事务回滚入口；只接受用户目录内上传素材/生成结果中的受管文件。 */
export async function releaseManagedGenerationMediaPaths(filePaths: readonly string[]): Promise<void> {
  const uploadsRoot = path.resolve(getUploadsDir())
  const mediaRoot = path.resolve(getGeneratedMediaDir())
  for (const filePath of new Set(filePaths)) {
    const resolved = path.resolve(filePath)
    const isUpload = resolved.startsWith(`${uploadsRoot}${path.sep}`)
    const isMedia = resolved.startsWith(`${mediaRoot}${path.sep}`)
    if (!isUpload && !isMedia) {
      throw new Error('只能释放应用数据目录内的受管生成媒体')
    }
    if (isUpload) {
      await releaseUploadImageLease(resolved)
      continue
    }
    if (isMedia && releaseManagedMediaFileLease(resolved) === 'retained') continue
    await fs.promises.rm(resolved, { force: true })
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

export interface ReservedImagePath {
  filePath: string
  handle: fs.promises.FileHandle
}

function isFileExistsError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST'
}

/** 原子预留；调用方必须立即交给 writeReservedImage 完成写入或取消清理。 */
export async function ensureUniquePath(targetPath: string, signal?: AbortSignal): Promise<ReservedImagePath> {
  try {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
    const parsed = path.parse(targetPath)
    for (let index = 0n; ; index += 1n) {
      signal?.throwIfAborted()
      const candidate = index === 0n ? targetPath : path.join(parsed.dir, `${parsed.name}-${index}${parsed.ext}`)
      try {
        return { filePath: candidate, handle: await fs.promises.open(candidate, 'wx') }
      } catch (error) {
        if (!isFileExistsError(error)) throw error
      }
    }
  } catch (error) {
    logger.error('预留输出路径失败', { event: 'image.file.reserve.failed', error })
    throw error
  }
}

export async function writeReservedImage(reservation: ReservedImagePath, bytes: Buffer, signal?: AbortSignal): Promise<string> {
  logger.debug('图片写入开始', { event: 'image.file.write.start', context: { byteLength: bytes.length } })
  try {
    signal?.throwIfAborted()
    await reservation.handle.writeFile(bytes, { signal })
    signal?.throwIfAborted()
    await reservation.handle.close()
    logger.debug('图片写入完成', { event: 'image.file.write.completed', context: { byteLength: bytes.length } })
    return reservation.filePath
  } catch (error) {
    logger.error('图片写入失败', { event: 'image.file.write.failed', error })
    try {
      await reservation.handle.close()
    } catch (cleanupError) {
      logger.error('关闭预留图片失败', { event: 'image.file.close.failed', error: cleanupError })
    }
    try {
      await fs.promises.rm(reservation.filePath, { force: true })
    } catch (cleanupError) {
      logger.error('清理预留图片失败', { event: 'image.file.cleanup.failed', error: cleanupError })
    }
    throw error
  }
}

export function ensureOutputPathWithExtension(targetPath: string, extension: string): string {
  return path.extname(targetPath) ? targetPath : `${targetPath}.${normalizeExtension(extension)}`
}

export async function writeBytesToPath(targetPath: string, bytes: Buffer): Promise<void> {
  logger.debug('指定路径图片写入开始', { event: 'image.file.write.start', context: { byteLength: bytes.length } })
  try {
    await fs.promises.mkdir(path.dirname(targetPath), { recursive: true })
    await fs.promises.writeFile(targetPath, bytes)
    logger.debug('指定路径图片写入完成', { event: 'image.file.write.completed', context: { byteLength: bytes.length } })
  } catch (error) {
    logger.error('写入指定图片路径失败', { event: 'image.file.write.failed', error })
    throw error
  }
}
