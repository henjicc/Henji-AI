import { getPlatform, isDesktopRuntime } from '@/platform/runtime'
import type { DialogOpenOptions, DialogSaveOptions, FsDirEntry } from '@/platform/contracts/system'

export function isDesktopShell(): boolean {
  return isDesktopRuntime()
}

export function toDisplaySrc(localPath: string): string {
  if (!isDesktopRuntime()) {
    return localPath
  }
  return getPlatform().media.toDisplaySrc(localPath)
}

/**
 * 渲染层 File 对象若来自真实磁盘文件（文件选择器/拖拽），直接拿到它的文件系统路径，
 * 不需要再读字节、算哈希、写一份新文件——只有合成 Blob（如剪贴板生成）才会返回空字符串。
 */
export function getPathForFile(file: File): string {
  if (!isDesktopRuntime()) {
    return ''
  }
  return getPlatform().media.getPathForFile(file)
}

/**
 * 确认某个绝对路径是否在 henji-media:// 协议允许读取的范围内——复用 getPathForFile
 * 拿到的原始磁盘路径前必须先过这一关，否则可能出现"路径有效但协议 403 拒绝"的
 * 静默失败（<video src> 既不显示缩略图也放不了）。
 */
export async function isPathAllowedForMedia(targetPath: string): Promise<boolean> {
  if (!isDesktopRuntime()) {
    return false
  }
  return await getPlatform().media.isPathAllowed(targetPath)
}

export async function readFile(path: string): Promise<Uint8Array<ArrayBuffer>> {
  const bytes = await getPlatform().system.fs.readFile(path)
  const normalized = new Uint8Array(bytes.byteLength)
  normalized.set(bytes)
  return normalized
}

export async function readTextFile(path: string): Promise<string> {
  return await getPlatform().system.fs.readTextFile(path)
}

export async function writeFile(path: string, data: Uint8Array): Promise<void> {
  await getPlatform().system.fs.writeFile(path, data)
}

export async function writeTextFile(path: string, data: string): Promise<void> {
  await getPlatform().system.fs.writeTextFile(path, data)
}

export async function exists(path: string): Promise<boolean> {
  return await getPlatform().system.fs.exists(path)
}

export async function mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
  await getPlatform().system.fs.mkdir(path, options)
}

export async function readDir(path: string): Promise<FsDirEntry[]> {
  return await getPlatform().system.fs.readDir(path)
}

export async function copyFile(src: string, dest: string): Promise<void> {
  await getPlatform().system.fs.copyFile(src, dest)
}

export async function remove(path: string, options?: { recursive?: boolean }): Promise<void> {
  await getPlatform().system.fs.remove(path, options)
}

export async function appLocalDataDir(): Promise<string> {
  return await getPlatform().system.paths.appLocalDataDir()
}

export async function downloadDir(): Promise<string> {
  return await getPlatform().system.paths.downloadDir()
}

export async function join(...parts: string[]): Promise<string> {
  return await getPlatform().system.paths.join(...parts)
}

export async function dirname(path: string): Promise<string> {
  return await getPlatform().system.paths.dirname(path)
}

export async function tempDir(): Promise<string> {
  return await getPlatform().system.paths.tempDir()
}

export function basename(path: string, ext?: string): string {
  const normalized = path.replace(/\\/g, '/')
  const name = normalized.split('/').filter(Boolean).pop() ?? ''
  return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name
}

export function extname(path: string): string {
  const name = basename(path)
  const dotIndex = name.lastIndexOf('.')
  return dotIndex > 0 ? name.slice(dotIndex) : ''
}

export async function openExternal(url: string): Promise<void> {
  await getPlatform().system.shell.openExternal(url)
}

export async function openDialog(options?: DialogOpenOptions): Promise<string | string[] | null> {
  return await getPlatform().system.dialog.open(options)
}

export async function saveDialog(options?: DialogSaveOptions): Promise<string | null> {
  return await getPlatform().system.dialog.save(options)
}

export async function nativeFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!isDesktopRuntime()) {
    return await fetch(url, init)
  }
  return await getPlatform().system.http.fetch(url, init)
}
