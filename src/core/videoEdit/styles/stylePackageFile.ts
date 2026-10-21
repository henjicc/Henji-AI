import { PersistenceError, persistenceMinReaderVersion, upgradePersistenceContent, type PersistenceContract } from '../../persistence/migrations'
import type { VideoEditStyle } from './styleSchemas'
import { VIDEO_EDIT_STYLE_PACKAGE_MAX_BYTES, videoEditStylePackageSchema, type VideoEditStylePackage, type VideoEditTemplate } from './templateSchemas'

export interface VideoEditStylePackageMedia { preview?: Uint8Array; thumbnail?: Uint8Array; anchors: Uint8Array[] }

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return btoa(binary)
}
function fromBase64(text: string): Uint8Array {
  const binary = atob(text); const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}
const ascii = (bytes: Uint8Array, start: number, end: number): string => String.fromCharCode(...bytes.subarray(start, end))
/** 只看容器头：预览必须是 MP4（ftyp），图片必须是 JPEG；导入不解码、不运行任何内容。 */
function checkMedia(media: VideoEditStylePackageMedia): void {
  if (media.preview && (media.preview.length < 12 || ascii(media.preview, 4, 8) !== 'ftyp')) throw new Error('风格包里的预览不是 MP4 视频。')
  for (const image of [media.thumbnail, ...media.anchors]) if (image && (image.length < 3 || image[0] !== 0xff || image[1] !== 0xd8 || image[2] !== 0xff)) throw new Error('风格包里的缩略图或锚点帧不是 JPEG 图片。')
}

/** 分享文件文本：版本化 JSON 容器 { version, minReaderVersion, content }，媒体以 base64 内嵌。 */
export function encodeVideoEditStylePackage(contract: PersistenceContract, style: VideoEditStyle, templates: readonly VideoEditTemplate[], media: VideoEditStylePackageMedia): string {
  checkMedia(media)
  const content = videoEditStylePackageSchema.parse({ format: 'henji-video-style', style, templates, media: { ...(media.preview ? { preview: toBase64(media.preview) } : {}), ...(media.thumbnail ? { thumbnail: toBase64(media.thumbnail) } : {}), anchors: media.anchors.map(toBase64) } })
  const text = `${JSON.stringify({ version: contract.version, minReaderVersion: persistenceMinReaderVersion(contract), content })}\n`
  if (new TextEncoder().encode(text).byteLength > VIDEO_EDIT_STYLE_PACKAGE_MAX_BYTES) throw new Error('风格包超过 16 MB，请精简样片或预览后再导出。')
  return text
}
export function decodeVideoEditStylePackage(contract: PersistenceContract, text: string): { value: VideoEditStylePackage; media: VideoEditStylePackageMedia } {
  if (new TextEncoder().encode(text).byteLength > VIDEO_EDIT_STYLE_PACKAGE_MAX_BYTES) throw new Error('风格包超过 16 MB，不是有效的痕迹AI风格包。')
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new Error('这个文件不是可读取的痕迹AI风格包。') }
  if (!raw || typeof raw !== 'object' || typeof (raw as { version?: unknown }).version !== 'number' || !('content' in raw)) throw new Error('这个文件不是痕迹AI风格包。')
  const { version, minReaderVersion, content } = raw as { version: number; minReaderVersion?: number; content: unknown }
  let upgraded: unknown
  try { upgraded = upgradePersistenceContent(contract, content, version, undefined, minReaderVersion) }
  catch (error) { if (error instanceof PersistenceError && error.code === 'newer-version') throw new Error('这个风格包由更新版本的痕迹AI创建，请升级后再导入。'); throw new Error(`风格包内容无效，无法识别：${error instanceof Error ? error.message.slice(0, 200) : String(error)}`, { cause: error }) }
  const parsed = videoEditStylePackageSchema.safeParse(upgraded)
  if (!parsed.success) throw new Error(`风格包内容无效：${parsed.error.issues.slice(0, 3).map(issue => `${issue.path.join('.')} ${issue.message}`).join('；')}`)
  const media = { ...(parsed.data.media.preview ? { preview: fromBase64(parsed.data.media.preview) } : {}), ...(parsed.data.media.thumbnail ? { thumbnail: fromBase64(parsed.data.media.thumbnail) } : {}), anchors: parsed.data.media.anchors.map(fromBase64) }
  checkMedia(media)
  return { value: parsed.data, media }
}
