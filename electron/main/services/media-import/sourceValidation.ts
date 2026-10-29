import { normalizeMediaImportPath, MediaPathInputError, redactMediaError } from '../../../../src/core/media/localMediaImportSafety'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { FileHandle } from 'node:fs/promises'
import type { LocalMediaKind } from '../../../../src/core/media/localMediaImportContracts'
import { detectMediaFormat, detectBySignature, IMPORT_EXTENSION_FORMATS, type DetectedMediaFormat } from './format'

export class MediaSourceValidationError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'MediaSourceValidationError' }
}

export function normalizeMediaSourcePath(source: string): string {
  return path.normalize(normalizeMediaImportPath(source, process.platform === 'win32'))
}

/** 错误只保留可修正的原因；Node 的原始错误会携带用户的完整路径，不能作为 cause 流出。 */
export function mediaSourceFailure(error: unknown): Error {
  if (error instanceof MediaSourceValidationError || error instanceof MediaPathInputError) return error
  if (error instanceof Error && error.name === 'AbortError') return redactMediaError(error)
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
  if (['EACCES', 'EPERM'].includes(code)) return new MediaSourceValidationError('MEDIA_PERMISSION_DENIED', '当前用户没有读取权限。请授予当前用户读取权限，或换用可读取的媒体文件后重试。')
  if (['ENETUNREACH', 'EHOSTUNREACH', 'ENETDOWN', 'ETIMEDOUT', 'ENODEV', 'ENXIO'].includes(code)) return new MediaSourceValidationError('MEDIA_DRIVE_UNAVAILABLE', '磁盘或网络共享不可达。请连接磁盘、恢复网络共享或在当前用户会话映射盘符后重试，也可改用可达的 UNC 路径。')
  if (['EISDIR', 'UNKNOWN'].includes(code)) return new MediaSourceValidationError('MEDIA_DRIVE_UNAVAILABLE', '磁盘或网络共享不可达，或此虚拟盘、云盘不支持当前路径类型。请先将文件下载到本机，或改用可访问的普通文件路径后重试。')
  if (['ENOENT', 'ENOTDIR'].includes(code)) return new MediaSourceValidationError('MEDIA_NOT_FOUND', '文件不存在或上级目录不可用。请核对文件名与绝对路径；网络盘请先恢复连接，映射盘请确认当前用户会话可见，或改用 UNC 路径后重试。')
  return redactMediaError(error)
}

export async function readDetectedMediaFormat(file: FileHandle, fileName: string, allowRawPcm = false, realPath = fileName): Promise<DetectedMediaFormat> {
  const header = Buffer.alloc(4096)
  const { bytesRead } = await file.read(header, 0, header.length, 0)
  const extension = path.extname(fileName).toLowerCase()
  if (extension === '.ts' && !(bytesRead >= 3 * 188 && header[0] === 0x47 && header[188] === 0x47 && header[376] === 0x47)) {
    throw new MediaSourceValidationError('MEDIA_FORMAT_UNSUPPORTED', '此 .ts 文件不是 MPEG-TS 视频（缺少每 188 字节的同步标记），请使用真实视频文件；代码文件请从代码素材入口导入。')
  }
  if (extension === '.heic' || extension === '.heif') {
    try {
      const sharp = (await import('sharp')).default
      // HEIF 容器可被识别并不代表本机具备 HEVC 解码器，实际试解码才能决定能否继续制作预览。
      await sharp(realPath, { limitInputPixels: false }).resize(1, 1).raw().toBuffer()
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
      if (code !== undefined || error instanceof Error && error.name === 'AbortError') throw error
      throw new MediaSourceValidationError('MEDIA_FORMAT_UNSUPPORTED', '当前不支持 HEIC，请转成 JPEG/PNG 后重试。')
    }
  }
  try { return detectMediaFormat(header.subarray(0, bytesRead), fileName, { allowRawPcm }) }
  catch {
    const expected = IMPORT_EXTENSION_FORMATS[extension]
    const known = detectBySignature(header.subarray(0, bytesRead), extension, true)
    if (expected && known && expected.kind === known.kind && expected.extension !== 'pcm') return expected
    // 签名表只作快路径；专业容器和历史媒体由正式解析器判断，不能凭表遗漏收窄剪辑格式。
    if (expected && !known && expected.extension !== 'pcm') {
      try {
        if (expected.kind === 'image') {
          const sharp = (await import('sharp')).default
          const metadata = await sharp(realPath, { limitInputPixels: false }).metadata()
          if (metadata.width && metadata.height) {
            return expected
          }
        } else {
          const { probeLocalMedia } = await import('./probe')
          const probe = await probeLocalMedia(realPath)
          // 容器可能只有音轨，音频也可能含封面；实际播放种类仍交给正式导入探测决定。
          if (expected.kind === 'audio' ? probe.hasAudio : probe.width > 0 && probe.height > 0 || probe.hasAudio) return expected
        }
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
        const imageFormatFailure = expected.kind === 'image' && error instanceof Error && /^(?:Input file contains unsupported image format|Input file has corrupt header)/.test(error.message)
        // 解析器的格式拒绝与临时故障含义不同；启动、权限、离线和取消必须保留可重试语义。
        if (code !== 'MEDIA_FORMAT_UNSUPPORTED' && !imageFormatFailure) throw error
      }
    }
    throw new MediaSourceValidationError('MEDIA_FORMAT_UNSUPPORTED', '内容不是受支持的媒体或扩展名与内容不符。请使用真实图片、视频或带文件头的音频；裸 PCM 请先转为 WAV，不能仅修改扩展名。')
  }
}

export async function validateLocalMediaSource(source: string, expectedKind?: LocalMediaKind, allowRawPcm = true): Promise<{
  sourcePath: string; realPath: string; format: DetectedMediaFormat; sizeBytes: number; mtimeMs: number
}> {
  try {
    const sourcePath = normalizeMediaSourcePath(source)
    const realPath = await fs.realpath(sourcePath)
    const stat = await fs.stat(realPath)
    if (!stat.isFile()) throw new MediaSourceValidationError('MEDIA_NOT_REGULAR_FILE', '此路径不是普通文件。请选择媒体文件，文件夹请从文件夹导入入口导入。')
    const file = await fs.open(realPath, 'r')
    try {
      const format = await readDetectedMediaFormat(file, sourcePath, allowRawPcm, realPath)
      if (expectedKind && format.kind !== expectedKind) throw new MediaSourceValidationError('MEDIA_KIND_MISMATCH', `文件实际为${({ image: '图片', video: '视频', audio: '音频' })[format.kind]}，请按真实媒体类型重试。`)
      return { sourcePath, realPath, format, sizeBytes: stat.size, mtimeMs: stat.mtimeMs }
    } finally { await file.close() }
  } catch (error) { throw mediaSourceFailure(error) }
}
