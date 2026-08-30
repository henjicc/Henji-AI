import path from 'node:path'

export interface LocalRedrawSourceDescriptor {
  kind: 'data-url' | 'remote-url' | 'local-path' | 'other'
  mime?: string
  length?: number
}

export interface LocalRedrawErrorDescriptor {
  name: string
  code?: string
}

/**
 * 日志只保留来源类别和不会反推出资源位置的元数据。
 * 本地路径、远程 URL 与未知输入都可能包含用户名、目录或访问凭证，不写入日志。
 */
export function describeLocalRedrawSource(source: string): LocalRedrawSourceDescriptor {
  if (source.startsWith('data:')) {
    const mime = source.match(/^data:([^;,]+)/)?.[1]
    return { kind: 'data-url', mime, length: source.length }
  }
  if (source.startsWith('http://') || source.startsWith('https://')) {
    return { kind: 'remote-url' }
  }
  if (path.isAbsolute(source) || source.startsWith('file://')) {
    return { kind: 'local-path' }
  }
  return { kind: 'other' }
}

/** 原始错误消息和堆栈可能包含文件路径或远程地址；日志只保留稳定错误类别。 */
export function describeLocalRedrawError(error: unknown): LocalRedrawErrorDescriptor {
  if (!(error instanceof Error)) return { name: 'UnknownError' }
  const safeName = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(error.name) ? error.name : 'Error'
  const rawCode = (error as Error & { code?: unknown }).code
  const code = typeof rawCode === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(rawCode)
    ? rawCode
    : undefined
  return { name: safeName, ...(code ? { code } : {}) }
}
