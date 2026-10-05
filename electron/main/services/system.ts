import { app, dialog, shell } from 'electron'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { writeBufferAtomically } from './fs/atomic-file'
import { getAppBaseDir } from './appBasePaths'

export interface FsDirEntryDto {
  name: string
  isDirectory: boolean
}

export interface DialogFilterDto {
  name: string
  extensions: string[]
}

export interface DialogSaveOptionsDto {
  defaultPath?: string
  filters?: DialogFilterDto[]
}

export interface DialogOpenOptionsDto {
  directory?: boolean
  multiple?: boolean
  defaultPath?: string
  filters?: DialogFilterDto[]
}

export interface NativeFetchRequestDto {
  url: string
  method?: string
  headers?: Record<string, string>
  body?: string | Uint8Array
}

export interface NativeFetchResponseDto {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: Uint8Array
}

function ensureValidPath(targetPath: string): void {
  if (!targetPath.trim()) {
    throw new Error('Path cannot be empty')
  }
  if (targetPath.includes('\0')) {
    throw new Error('Path contains invalid null byte')
  }
}

export async function readFileBytes(targetPath: string, options?: { maxBytes: number }): Promise<Uint8Array> {
  ensureValidPath(targetPath)
  if (!options) return await fs.readFile(targetPath)
  const { maxBytes } = options
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 16 * 1024 * 1024) throw new Error('maxBytes必须为1至16MiB的整数。')
  const handle = await fs.open(targetPath, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > maxBytes) throw new Error('文件超出读取预算或不是普通文件。')
    const bytes = Buffer.alloc(maxBytes + 1)
    let offset = 0
    while (offset < bytes.byteLength) {
      const read = await handle.read(bytes, offset, bytes.byteLength - offset, offset)
      if (!read.bytesRead) return bytes.subarray(0, offset)
      offset += read.bytesRead
      if (offset > maxBytes) throw new Error('文件在读取期间超出预算。')
    }
    throw new Error('文件在读取期间超出预算。')
  } finally { await handle.close() }
}

export async function readTextFile(targetPath: string): Promise<string> {
  ensureValidPath(targetPath)
  return await fs.readFile(targetPath, 'utf8')
}

export async function writeFileBytes(
  targetPath: string,
  data: Uint8Array,
  options?: { exclusive?: boolean; position?: number },
): Promise<void> {
  ensureValidPath(targetPath)
  if (options?.position !== undefined) {
    if (!Number.isSafeInteger(options.position) || options.position < 0 || options.exclusive) throw new Error('Invalid file write position')
    const handle = await fs.open(targetPath, 'r+')
    try {
      let offset = 0
      while (offset < data.byteLength) {
        const { bytesWritten } = await handle.write(data, offset, data.byteLength - offset, options.position + offset)
        if (!bytesWritten) throw new Error('File write made no progress')
        offset += bytesWritten
      }
    } finally { await handle.close() }
    return
  }
  if (options?.exclusive) await writeBufferAtomically(targetPath, data, undefined, { exclusive: true })
  else { await fs.mkdir(path.dirname(targetPath), { recursive: true }); await fs.writeFile(targetPath, data) }
}

export async function writeTextFile(targetPath: string, data: string): Promise<void> {
  ensureValidPath(targetPath)
  await writeBufferAtomically(targetPath, Buffer.from(data, 'utf8'))
}

export async function pathExists(targetPath: string): Promise<boolean> {
  ensureValidPath(targetPath)
  try {
    await fs.access(targetPath)
    return true
  } catch {
    return false
  }
}

export async function makeDir(targetPath: string, recursive = false): Promise<void> {
  ensureValidPath(targetPath)
  await fs.mkdir(targetPath, { recursive })
}

export async function readDirectory(targetPath: string): Promise<FsDirEntryDto[]> {
  ensureValidPath(targetPath)
  const entries = await fs.readdir(targetPath, { withFileTypes: true })
  return entries.map((entry) => ({
    name: entry.name,
    isDirectory: entry.isDirectory(),
  }))
}

export async function copyFilePath(src: string, dest: string): Promise<void> {
  ensureValidPath(src)
  ensureValidPath(dest)
  await fs.mkdir(path.dirname(dest), { recursive: true })
  await fs.copyFile(src, dest)
}

export async function removePath(targetPath: string, recursive = false): Promise<void> {
  ensureValidPath(targetPath)
  await fs.rm(targetPath, { recursive, force: true })
}

export async function showSaveDialog(options?: DialogSaveOptionsDto): Promise<string | null> {
  const result = await dialog.showSaveDialog({
    defaultPath: options?.defaultPath,
    filters: options?.filters,
  })
  return result.canceled ? null : result.filePath || null
}

export async function showOpenDialog(options?: DialogOpenOptionsDto): Promise<string | string[] | null> {
  const properties: Array<'openFile' | 'openDirectory' | 'multiSelections'> = []
  properties.push(options?.directory ? 'openDirectory' : 'openFile')
  if (options?.multiple) {
    properties.push('multiSelections')
  }

  const result = await dialog.showOpenDialog({
    defaultPath: options?.defaultPath,
    filters: options?.filters,
    properties,
  })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return options?.multiple ? result.filePaths : result.filePaths[0]
}

export async function openExternalUrl(url: string): Promise<void> {
  const parsed = new URL(url)
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
    throw new Error(`Unsupported external URL protocol: ${parsed.protocol}`)
  }
  await shell.openExternal(parsed.toString())
}

export function getAppLocalDataDir(): string {
  return getAppBaseDir()
}

export function getDownloadDir(): string {
  return app.getPath('downloads')
}

export function joinPath(parts: string[]): string {
  if (parts.length === 0) {
    throw new Error('Expected at least one path segment')
  }
  return path.join(...parts)
}

export function dirnamePath(targetPath: string): string {
  ensureValidPath(targetPath)
  return path.dirname(targetPath)
}

export function getTempDir(): string {
  return app.getPath('temp') || os.tmpdir()
}

export async function nativeFetch(request: NativeFetchRequestDto): Promise<NativeFetchResponseDto> {
  const requestBody = typeof request.body === 'string' || request.body === undefined
    ? request.body
    : Uint8Array.from(request.body).buffer
  const response = await fetch(request.url, {
    method: request.method,
    headers: request.headers,
    body: requestBody,
  })
  const body = new Uint8Array(await response.arrayBuffer())
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Array.from(response.headers.entries()),
    body,
  }
}
