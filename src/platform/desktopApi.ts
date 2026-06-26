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
