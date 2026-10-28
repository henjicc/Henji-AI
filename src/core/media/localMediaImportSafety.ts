export class MediaPathInputError extends Error {
  constructor(readonly code: string, message: string) { super(`${code}: ${message}`); this.name = 'MediaPathInputError' }
}

/** 只处理路径语义，不访问文件系统，供主进程与导入请求在触碰来源前共用。 */
export function normalizeMediaImportPath(source: string, windows: boolean): string {
  if (!source.trim() || source.includes('\0')) throw new MediaPathInputError('MEDIA_PATH_INVALID', '路径为空或含无效字符，请提供完整文件或文件夹路径。')
  if (!windows) {
    if (!source.startsWith('/')) throw new MediaPathInputError('MEDIA_PATH_NOT_ABSOLUTE', '请提供完整绝对路径，不要使用相对路径。')
    return source
  }
  let value = source.replaceAll('/', '\\')
  if (value.startsWith('\\\\.\\')) throw new MediaPathInputError('MEDIA_DEVICE_PATH', '不能导入设备或命名管道，请选择磁盘上的普通文件或文件夹。')
  if (value.startsWith('\\\\?\\')) {
    value = value.slice(4)
    if (/^UNC\\/i.test(value)) value = `\\\\${value.slice(4)}`
  }
  if (!/^(?:[a-z]:\\|\\\\[^\\?]+\\[^\\]+)/i.test(value) || /^\\\\[.?]\\/.test(value)) throw new MediaPathInputError('MEDIA_PATH_NOT_ABSOLUTE', '请提供带盘符或网络共享名的完整绝对路径，不要使用相对路径。')
  const segments = value.split('\\').filter(Boolean)
  if (segments.some(segment => segment !== '.' && segment !== '..' && /[. ]$/.test(segment))) throw new MediaPathInputError('MEDIA_PATH_TRAILING_CHARACTER', '路径段末尾含点或空格，普通 Windows 路径会将它们忽略。请使用文件的实际名称；特殊名称请先重命名再导入。')
  if (segments.slice(1).some(segment => /:/.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) throw new MediaPathInputError('MEDIA_DEVICE_PATH', '路径包含设备名或备用数据流，请选择普通文件或文件夹。')
  return value
}

export interface MediaErrorDetails { name: string; code?: string | number; message: string }

/** 保留错误事实与取消身份，只剥离来源路径；不把解码、数据库等错误改判成文件读取错误。 */
export function mediaErrorDetails(error: unknown, paths: readonly string[] = []): MediaErrorDetails {
  const record = error && typeof error === 'object' ? error as { name?: unknown; code?: unknown; message?: unknown; path?: unknown; dest?: unknown } : {}
  let message = typeof record.message === 'string' ? record.message : String(error)
  for (const value of [...paths, record.path, record.dest]) if (typeof value === 'string' && value) {
    for (const variant of [value, value.replaceAll('\\', '/'), value.replaceAll('/', '\\')]) message = message.split(variant).join('[本地路径]')
  }
  message = message.replace(/(?:(?<![a-z])[a-z]:[\\/]|\\\\)[^:\r\n'"<>)]+/gi, '[本地路径]')
    .replace(/(^|[\s'"(])\/(?!\/)[^\s'"<>),]+/g, '$1[本地路径]')
  return { name: typeof record.name === 'string' ? record.name : 'Error', ...(typeof record.code === 'string' || typeof record.code === 'number' ? { code: record.code } : {}), message }
}

export function redactMediaError(error: unknown, paths: readonly string[] = []): Error & { code?: string | number } {
  const details = mediaErrorDetails(error, paths)
  const safe = Object.assign(new Error(details.message), { name: details.name, ...(details.code !== undefined ? { code: details.code } : {}) })
  if (error instanceof Error && error.stack) safe.stack = mediaErrorDetails({ message: error.stack }, paths).message
  return safe
}
