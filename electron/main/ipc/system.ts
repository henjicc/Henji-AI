import {
  copyFilePath,
  dirnamePath,
  getAppLocalDataDir,
  getDownloadDir,
  getTempDir,
  joinPath,
  makeDir,
  nativeFetch,
  openExternalUrl,
  pathExists,
  readDirectory,
  readFileBytes,
  readTextFile,
  removePath,
  showOpenDialog,
  showSaveDialog,
  writeFileBytes,
  writeTextFile,
  type DialogOpenOptionsDto,
  type DialogSaveOptionsDto,
  type FsDirEntryDto,
  type NativeFetchRequestDto,
  type NativeFetchResponseDto,
} from '../services/system'
import { parseRecord, parseStringField, parseVoid, registerIpcHandler } from './registry'

interface PathPayload {
  path: string
}

interface WriteFilePayload extends PathPayload {
  data: Uint8Array
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
  return { path: targetPath, data }
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
  if (typeof url !== 'string' || url.length === 0) {
    throw new Error('Expected non-empty string field "url"')
  }
  if (method !== undefined && typeof method !== 'string') {
    throw new Error('Expected string field "method"')
  }
  if (body !== undefined && typeof body !== 'string' && !isUint8Array(body)) {
    throw new Error('Expected string or Uint8Array field "body"')
  }
  return {
    url,
    method,
    headers: parseHeaders(record.headers),
    body,
  }
}

export function registerSystemIpc(): void {
  registerIpcHandler<WriteFilePayload, void>('fs:writeFile', parseWriteFilePayload, ({ path, data }) => writeFileBytes(path, data))
  registerIpcHandler<WriteTextFilePayload, void>('fs:writeTextFile', parseWriteTextFilePayload, ({ path, data }) => writeTextFile(path, data))
  registerIpcHandler<PathPayload, Uint8Array>('fs:readFile', parsePathPayload, ({ path }) => readFileBytes(path))
  registerIpcHandler<PathPayload, string>('fs:readTextFile', parsePathPayload, ({ path }) => readTextFile(path))
  registerIpcHandler<PathPayload, boolean>('fs:exists', parsePathPayload, ({ path }) => pathExists(path))
  registerIpcHandler<MkdirPayload, void>('fs:mkdir', parseMkdirPayload, ({ path, recursive }) => makeDir(path, recursive))
  registerIpcHandler<PathPayload, FsDirEntryDto[]>('fs:readDir', parsePathPayload, ({ path }) => readDirectory(path))
  registerIpcHandler<CopyFilePayload, void>('fs:copyFile', parseCopyFilePayload, ({ src, dest }) => copyFilePath(src, dest))
  registerIpcHandler<RemovePayload, void>('fs:remove', parseRemovePayload, ({ path, recursive }) => removePath(path, recursive))

  registerIpcHandler<DialogSaveOptionsDto | undefined, string | null>('dialog:save', parseDialogSaveOptions, (options) => showSaveDialog(options))
  registerIpcHandler<DialogOpenOptionsDto | undefined, string | string[] | null>('dialog:open', parseDialogOpenOptions, (options) => showOpenDialog(options))
  registerIpcHandler<string, void>('shell:openExternal', (input) => parseStringField(input, 'url'), (url) => openExternalUrl(url))

  registerIpcHandler('paths:appLocalDataDir', parseVoid, () => getAppLocalDataDir())
  registerIpcHandler('paths:downloadDir', parseVoid, () => getDownloadDir())
  registerIpcHandler<JoinPayload, string>('paths:join', parseJoinPayload, ({ parts }) => joinPath(parts))
  registerIpcHandler<string, string>('paths:dirname', (input) => parseStringField(input, 'path'), (targetPath) => dirnamePath(targetPath))
  registerIpcHandler('paths:tempDir', parseVoid, () => getTempDir())

  registerIpcHandler<NativeFetchRequestDto, NativeFetchResponseDto>('http:fetch', parseNativeFetchRequest, (request) => nativeFetch(request))
}
