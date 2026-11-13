import { freemem, totalmem } from 'node:os'
import { powerMonitor, type WebContents } from 'electron'
import { holdBackgroundWork } from '../services/background-work'
import {
  copyFilePath,
  dirnamePath,
  getAppLocalDataDir,
  getDownloadDir,
  getTempDir,
  joinPath,
  makeDir,
  nativeFetch,
  NATIVE_FETCH_MAX_TIMEOUT_MS,
  openExternalUrl,
  pathExists,
  readDirectory,
  readFileBytes,
  readTextFile,
  removePath,
  showItemInFolder,
  showOpenDialog,
  showSaveDialog,
  writeFileBytes,
  writeZipArchive,
  writeTextFile,
  type DialogOpenOptionsDto,
  type DialogSaveOptionsDto,
  type FsDirEntryDto,
  type NativeFetchRequestDto,
  type NativeFetchResponseDto,
  type ZipEntryDto,
} from '../services/system'
import { getAppDirectories, setUserFolderLanguageHint, type AppDirectoriesDto } from '../services/appPaths'
import { parseOptionalStringField, parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'
import { closeDirectoryScans, readDirectoryPage } from '../services/systemDirectory'
import type { FsDirPage } from '../../../src/platform/contracts/system'

interface PathPayload {
  path: string
}
interface ReadDirPayload extends PathPayload { paged?: boolean; cursor?: string; close?: boolean }
function parseReadDirPayload(input: unknown): ReadDirPayload {
  const record = parseRecord(input)
  if (record.paged !== undefined && typeof record.paged !== 'boolean' || record.close !== undefined && typeof record.close !== 'boolean') throw new Error('目录读取选项无效。')
  const cursor = parseOptionalStringField(input, 'cursor')
  if (cursor !== undefined && !/^[a-f0-9-]{36}$/.test(cursor)) throw new Error('目录读取游标无效。')
  return { ...parsePathPayload(input), paged: record.paged as boolean | undefined, close: record.close as boolean | undefined, cursor }
}

interface ReadFilePayload extends PathPayload { maxBytes?: number }
function parseReadFilePayload(input: unknown): ReadFilePayload {
  const record = parseRecord(input)
  if (record.maxBytes !== undefined && (!Number.isSafeInteger(record.maxBytes) || Number(record.maxBytes) < 1)) throw new Error('maxBytes必须为正的安全整数。')
  return { ...parsePathPayload(input), ...(record.maxBytes !== undefined ? { maxBytes: Number(record.maxBytes) } : {}) }
}

interface WriteFilePayload extends PathPayload {
  data: Uint8Array
  exclusive?: boolean
  position?: number
}

interface WriteTextFilePayload extends PathPayload {
  data: string
}

interface MkdirPayload extends PathPayload {
  recursive?: boolean
}

interface CopyFilePayload {
  src: string
  dest: string
}

interface WriteZipPayload {
  target: string
  entries: ZipEntryDto[]
}

function parseWriteZipPayload(input: unknown): WriteZipPayload {
  const record = parseRecord(input)
  const target = parseStringField(input, 'target')
  if (!Array.isArray(record.entries) || record.entries.length === 0) throw new Error('Expected non-empty array field "entries"')
  const entries = record.entries.map((entry) => ({ source: parseStringField(entry, 'source'), name: parseStringField(entry, 'name') }))
  return { target, entries }
}

interface RemovePayload extends PathPayload {
  recursive?: boolean
}

interface JoinPayload {
  parts: string[]
}

function parsePathPayload(input: unknown): PathPayload {
  return { path: parseStringField(input, 'path') }
}

function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array
}

function parseWriteFilePayload(input: unknown): WriteFilePayload {
  const record = parseRecord(input)
  const targetPath = record.path
  const data = record.data
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('Expected non-empty string field "path"')
  }
  if (!isUint8Array(data)) {
    throw new Error('Expected Uint8Array field "data"')
  }
  if (record.position !== undefined && (typeof record.position !== 'number' || !Number.isSafeInteger(record.position) || record.position < 0)) throw new Error('Expected non-negative integer position')
  if (record.position !== undefined && record.exclusive) throw new Error('Position and exclusive cannot be combined')
  return { path: targetPath, data, exclusive: record.exclusive === true, position: record.position as number | undefined }
}

function parseWriteTextFilePayload(input: unknown): WriteTextFilePayload {
  const record = parseRecord(input)
  const targetPath = record.path
  const data = record.data
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('Expected non-empty string field "path"')
  }
  if (typeof data !== 'string') {
    throw new Error('Expected string field "data"')
  }
  return { path: targetPath, data }
}

function parseMkdirPayload(input: unknown): MkdirPayload {
  const record = parseRecord(input)
  const targetPath = record.path
  const recursive = record.recursive
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('Expected non-empty string field "path"')
  }
  if (recursive !== undefined && typeof recursive !== 'boolean') {
    throw new Error('Expected boolean field "recursive"')
  }
  return { path: targetPath, recursive }
}

function parseCopyFilePayload(input: unknown): CopyFilePayload {
  const record = parseRecord(input)
  const src = record.src
  const dest = record.dest
  if (typeof src !== 'string' || src.length === 0) {
    throw new Error('Expected non-empty string field "src"')
  }
  if (typeof dest !== 'string' || dest.length === 0) {
    throw new Error('Expected non-empty string field "dest"')
  }
  return { src, dest }
}

function parseRemovePayload(input: unknown): RemovePayload {
  const record = parseRecord(input)
  const targetPath = record.path
  const recursive = record.recursive
  if (typeof targetPath !== 'string' || targetPath.length === 0) {
    throw new Error('Expected non-empty string field "path"')
  }
  if (recursive !== undefined && typeof recursive !== 'boolean') {
    throw new Error('Expected boolean field "recursive"')
  }
  return { path: targetPath, recursive }
}

function parseJoinPayload(input: unknown): JoinPayload {
  const record = parseRecord(input)
  const parts = record.parts
  if (!Array.isArray(parts) || !parts.every((part): part is string => typeof part === 'string')) {
    throw new Error('Expected string array field "parts"')
  }
  return { parts }
}

function parseDialogSaveOptions(input: unknown): DialogSaveOptionsDto | undefined {
  if (input === undefined) {
    return undefined
  }
  const record = parseRecord(input)
  return {
    defaultPath: typeof record.defaultPath === 'string' ? record.defaultPath : undefined,
    filters: Array.isArray(record.filters) ? record.filters as DialogSaveOptionsDto['filters'] : undefined,
  }
}

function parseDialogOpenOptions(input: unknown): DialogOpenOptionsDto | undefined {
  if (input === undefined) {
    return undefined
  }
  const record = parseRecord(input)
  return {
    directory: typeof record.directory === 'boolean' ? record.directory : undefined,
    multiple: typeof record.multiple === 'boolean' ? record.multiple : undefined,
    defaultPath: typeof record.defaultPath === 'string' ? record.defaultPath : undefined,
    filters: Array.isArray(record.filters) ? record.filters as DialogOpenOptionsDto['filters'] : undefined,
  }
}

function parseHeaders(input: unknown): Record<string, string> | undefined {
  if (input === undefined) {
    return undefined
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Expected headers object')
  }
  const headers: Record<string, string> = {}
  Object.entries(input).forEach(([key, value]) => {
    if (typeof value === 'string') {
      headers[key] = value
    }
  })
  return headers
}

function parseNativeFetchRequest(input: unknown): NativeFetchRequestDto {
  const record = parseRecord(input)
  const url = record.url
  const method = record.method
  const body = record.body
  const timeoutMs = record.timeoutMs
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('Expected non-empty string field "url"')
  }
  if (method !== undefined && typeof method !== 'string') {
    throw new Error('Expected string field "method"')
  }
  if (body !== undefined && typeof body !== 'string' && !isUint8Array(body)) {
    throw new Error('Expected string or Uint8Array field "body"')
  }
  if (timeoutMs !== undefined && (typeof timeoutMs !== 'number' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > NATIVE_FETCH_MAX_TIMEOUT_MS)) {
    throw new Error(`Expected timeoutMs to be an integer between 1 and ${NATIVE_FETCH_MAX_TIMEOUT_MS}`)
  }
  return {
    url,
    method,
    headers: parseHeaders(record.headers),
    body,
    timeoutMs,
  }
}

function parseBackgroundWork(input: unknown): boolean {
  if (typeof input !== 'boolean') throw new Error('backgroundWork 需要布尔值。')
  return input
}

const rendererBackgroundWork = new WeakMap<WebContents, () => void>()
function setRendererBackgroundWork(contents: WebContents, active: boolean): void {
  const release = rendererBackgroundWork.get(contents)
  if (!active) { release?.(); rendererBackgroundWork.delete(contents); return }
  if (release) return
  const hold = holdBackgroundWork(contents)
  const stop = (): void => {
    if (rendererBackgroundWork.get(contents) !== stop) return
    rendererBackgroundWork.delete(contents); hold()
    contents.off('did-start-navigation', onNavigate)
    contents.off('destroyed', stop)
  }
  // 页面重载后原先的请求方已不在，不能一直不节流
  const onNavigate = (details: { isMainFrame: boolean; isSameDocument: boolean }): void => { if (details.isMainFrame && !details.isSameDocument) stop() }
  rendererBackgroundWork.set(contents, stop)
  contents.on('did-start-navigation', onNavigate)
  contents.on('destroyed', stop)
}

export function registerSystemIpc(): void {
  registerIpcHandler('system:memoryInfo', parseVoid, () => ({ availableBytes: freemem(), totalBytes: totalmem() }))
  // 全系统距上次键盘鼠标输入的秒数（不分哪个程序）：后台预渲染据此判断用户是不是真的走开了。
  registerIpcHandler('system:idleSeconds', parseVoid, () => powerMonitor.getSystemIdleTime())
  // 页面要在窗口最小化或被遮住时继续出帧（自动预渲染）：开着时不节流页面定时器，页面重载或关闭自动放开。
  registerIpcHandler('system:backgroundWork', parseBackgroundWork, (active, event) => setRendererBackgroundWork(event.sender, active))
  registerIpcHandler<WriteFilePayload, void>('fs:writeFile', parseWriteFilePayload, ({ path, data, exclusive, position }) => writeFileBytes(path, data, { exclusive, position }))
  registerIpcHandler<WriteTextFilePayload, void>('fs:writeTextFile', parseWriteTextFilePayload, ({ path, data }) => writeTextFile(path, data))
  registerIpcHandler<ReadFilePayload, Uint8Array>('fs:readFile', parseReadFilePayload, ({ path, maxBytes }) => readFileBytes(path, maxBytes === undefined ? undefined : { maxBytes }))
  registerIpcHandler<PathPayload, string>('fs:readTextFile', parsePathPayload, ({ path }) => readTextFile(path))
  registerIpcHandler<PathPayload, boolean>('fs:exists', parsePathPayload, ({ path }) => pathExists(path))
  registerIpcHandler<MkdirPayload, void>('fs:mkdir', parseMkdirPayload, ({ path, recursive }) => makeDir(path, recursive))
  const directoryOwners = new Set<number>()
  registerIpcHandler<ReadDirPayload, FsDirEntryDto[] | FsDirPage>('fs:readDir', parseReadDirPayload, (input, event) => {
    if (!input.paged) return readDirectory(input.path)
    if (!directoryOwners.has(event.sender.id)) {
      const owner = event.sender.id; directoryOwners.add(owner)
      event.sender.once('destroyed', () => { directoryOwners.delete(owner); void closeDirectoryScans(owner) })
    }
    return readDirectoryPage(input.path, input, event.sender.id)
  })
  registerIpcHandler<CopyFilePayload, void>('fs:copyFile', parseCopyFilePayload, ({ src, dest }) => copyFilePath(src, dest))
  registerIpcHandler<WriteZipPayload, void>('fs:writeZip', parseWriteZipPayload, ({ target, entries }) => writeZipArchive(target, entries))
  registerIpcHandler<RemovePayload, void>('fs:remove', parseRemovePayload, ({ path, recursive }) => removePath(path, recursive))

  registerIpcHandler<DialogSaveOptionsDto | undefined, string | null>('dialog:save', parseDialogSaveOptions, (options) => showSaveDialog(options))
  registerIpcHandler<DialogOpenOptionsDto | undefined, string | string[] | null>('dialog:open', parseDialogOpenOptions, (options) => showOpenDialog(options))
  registerIpcHandler<string, void>('shell:openExternal', (input) => parseStringField(input, 'url'), (url) => openExternalUrl(url))
  registerIpcHandler<string, void>('shell:showItemInFolder', (input) => parseStringField(input, 'path'), (target) => showItemInFolder(target))

  registerIpcHandler('paths:appLocalDataDir', parseVoid, () => getAppLocalDataDir())
  registerIpcHandler<string | undefined, AppDirectoriesDto>(
    'paths:appDirectories',
    (input) => (input === undefined ? undefined : parseOptionalStringField(input, 'uiLanguage')),
    (uiLanguage) => {
      setUserFolderLanguageHint(uiLanguage)
      return getAppDirectories()
    },
  )
  registerIpcHandler('paths:downloadDir', parseVoid, () => getDownloadDir())
  registerIpcHandler<JoinPayload, string>('paths:join', parseJoinPayload, ({ parts }) => joinPath(parts))
  registerIpcHandler<string, string>('paths:dirname', (input) => parseStringField(input, 'path'), (targetPath) => dirnamePath(targetPath))
  registerIpcHandler('paths:tempDir', parseVoid, () => getTempDir())

  registerIpcHandler<NativeFetchRequestDto, NativeFetchResponseDto>('http:fetch', parseNativeFetchRequest, (request) => nativeFetch(request))
}
