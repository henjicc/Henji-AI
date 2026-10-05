/**
 * 纯字符串的绝对路径工具（存储底座 2.2）。
 *
 * 主进程与渲染层共用，不依赖 `node:path`：路径写法由调用方显式给出（`win32` / `posix`），
 * 因此两种写法在任何平台上都能精确测试。规则：
 *
 * - win32 只认盘符（`D:\`、`D:/`）与网络路径（`\\server\share`）；`\\?\` 长路径前缀会被去掉，
 *   其他设备路径（`\\.\pipe\…`）、盘符相对路径（`D:foo`）一律不算绝对路径。
 * - posix 只认以 `/` 开头的路径。
 * - 解析时去掉 `.`、按层级解析 `..`；`..` 越过根即视为无效（返回 null）。
 * - 比较时 win32 不区分大小写，两种写法都做 Unicode NFC 归一；输出保留原始大小写。
 * - 含控制字符（换行、NUL 等）的字符串不是路径。
 */

export type PathStyle = 'win32' | 'posix'

export interface ParsedAbsolutePath {
  /** win32：`D:` 或 `\\server\share`；posix：空串（代表 `/`）。 */
  root: string
  /** 规范化后的分段，保留原始拼写。 */
  segments: string[]
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f]/
const WIN_NAMESPACE_UNC = /^[\\/]{2}[?.][\\/]UNC[\\/]/i
const WIN_NAMESPACE_DRIVE = /^[\\/]{2}[?.][\\/](?=[A-Za-z]:[\\/])/
const WIN_DRIVE = /^([A-Za-z]):[\\/]/
const WIN_UNC = /^[\\/]{2}([^\\/?.][^\\/]*)[\\/]+([^\\/]+)(?:[\\/]|$)/
/** 远超系统上限的字符串直接视为非路径，避免对大段文本做无谓解析。 */
const MAX_PATH_LENGTH = 32_767

export function hasControlCharacters(value: string): boolean {
  return CONTROL_CHARACTERS.test(value)
}

function resolveSegments(parts: readonly string[], forbidColon: boolean): string[] | null {
  const segments: string[] = []
  for (const part of parts) {
    if (!part || part === '.') continue
    if (part === '..') {
      if (!segments.length) return null
      segments.pop()
      continue
    }
    if (forbidColon && part.includes(':')) return null
    segments.push(part)
  }
  return segments
}

function parseWin32(value: string): ParsedAbsolutePath | null {
  let input = value
  if (WIN_NAMESPACE_UNC.test(input)) input = `\\\\${input.replace(WIN_NAMESPACE_UNC, '')}`
  else if (WIN_NAMESPACE_DRIVE.test(input)) input = input.replace(WIN_NAMESPACE_DRIVE, '')
  else if (/^[\\/]{2}[?.](?:[\\/]|$)/.test(input)) return null

  const drive = WIN_DRIVE.exec(input)
  if (drive) {
    const segments = resolveSegments(input.slice(drive[0].length).split(/[\\/]+/), true)
    return segments ? { root: `${drive[1].toUpperCase()}:`, segments } : null
  }
  const unc = WIN_UNC.exec(input)
  if (unc) {
    if (unc[1].includes(':') || unc[2].includes(':')) return null
    const segments = resolveSegments(input.slice(unc[0].length).split(/[\\/]+/), true)
    return segments ? { root: `\\\\${unc[1]}\\${unc[2]}`, segments } : null
  }
  return null
}

function parsePosix(value: string): ParsedAbsolutePath | null {
  if (!value.startsWith('/')) return null
  const segments = resolveSegments(value.split('/'), false)
  return segments ? { root: '', segments } : null
}

/** 解析绝对路径；不是绝对路径、含控制字符或 `..` 越过根时返回 null。 */
export function parseAbsolutePath(style: PathStyle, value: string): ParsedAbsolutePath | null {
  if (!value || value.length > MAX_PATH_LENGTH || hasControlCharacters(value)) return null
  return style === 'win32' ? parseWin32(value) : parsePosix(value)
}

export function isAbsolutePath(style: PathStyle, value: string): boolean {
  return parseAbsolutePath(style, value) !== null
}

/** 按平台原生写法输出：win32 用反斜杠，posix 用正斜杠。 */
export function formatAbsolutePath(style: PathStyle, parsed: ParsedAbsolutePath): string {
  if (style === 'posix') return `/${parsed.segments.join('/')}`
  // 盘符根输出 `D:\`，网络根输出 `\\server\share\`；有分段时根后直接接分段。
  return `${parsed.root}\\${parsed.segments.join('\\')}`
}

function comparableSegment(style: PathStyle, segment: string): string {
  const normalized = segment.normalize('NFC')
  return style === 'win32' ? normalized.toLowerCase() : normalized
}

/** 比较用的键：win32 不区分大小写；两种写法都做 NFC 归一并统一用正斜杠。 */
export function comparisonKey(style: PathStyle, parsed: ParsedAbsolutePath): string {
  const root = style === 'win32' ? parsed.root.replaceAll('\\', '/').toLowerCase() : ''
  const tail = parsed.segments.map((segment) => comparableSegment(style, segment)).join('/')
  return `${root}/${tail}`
}

/** 字符串路径的比较键；不是绝对路径时返回 null。 */
export function pathKey(style: PathStyle, value: string): string | null {
  const parsed = parseAbsolutePath(style, value)
  return parsed ? comparisonKey(style, parsed) : null
}

export function samePath(style: PathStyle, left: string, right: string): boolean {
  const leftKey = pathKey(style, left)
  return leftKey !== null && leftKey === pathKey(style, right)
}

/**
 * target 位于 base 之内（含 base 本身）时返回 base 之后的分段（保留 target 的原始拼写），否则 null。
 */
export function relativeSegments(
  style: PathStyle,
  base: ParsedAbsolutePath,
  target: ParsedAbsolutePath,
): string[] | null {
  if (style === 'win32' && base.root.toLowerCase() !== target.root.toLowerCase()) return null
  if (target.segments.length < base.segments.length) return null
  for (let index = 0; index < base.segments.length; index += 1) {
    if (comparableSegment(style, base.segments[index]) !== comparableSegment(style, target.segments[index])) return null
  }
  return target.segments.slice(base.segments.length)
}

/** 字符串版本：target 是否位于 base 之内（含 base 本身）。 */
export function isPathInside(style: PathStyle, base: string, target: string): boolean {
  const parsedBase = parseAbsolutePath(style, base)
  const parsedTarget = parseAbsolutePath(style, target)
  return Boolean(parsedBase && parsedTarget && relativeSegments(style, parsedBase, parsedTarget))
}

/**
 * 相对分段是否可以安全地拼到根目录下：非空、不是 `.`/`..`、不含分隔符与控制字符，
 * win32 下不含 `:`（盘符或备用数据流）。
 */
export function isSafeRelativeSegment(style: PathStyle, segment: string): boolean {
  if (!segment || segment === '.' || segment === '..' || hasControlCharacters(segment)) return false
  if (segment.includes('/')) return false
  if (style === 'win32' && (segment.includes('\\') || segment.includes(':'))) return false
  return true
}

/** 把相对分段拼到绝对根目录下并按原生写法输出；根不是绝对路径或分段不安全时返回 null。 */
export function joinRelativeSegments(style: PathStyle, root: string, segments: readonly string[]): string | null {
  const parsed = parseAbsolutePath(style, root)
  if (!parsed || !segments.every((segment) => isSafeRelativeSegment(style, segment))) return null
  return formatAbsolutePath(style, { root: parsed.root, segments: [...parsed.segments, ...segments] })
}

/** 父目录；已经是根时返回 null。 */
export function parentPath(style: PathStyle, value: string): string | null {
  const parsed = parseAbsolutePath(style, value)
  if (!parsed || !parsed.segments.length) return null
  return formatAbsolutePath(style, { root: parsed.root, segments: parsed.segments.slice(0, -1) })
}

/** 最后一段名称；根目录返回空串，非绝对路径返回 null。 */
export function baseName(style: PathStyle, value: string): string | null {
  const parsed = parseAbsolutePath(style, value)
  if (!parsed) return null
  return parsed.segments[parsed.segments.length - 1] ?? ''
}
