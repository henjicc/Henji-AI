import {
  comparisonKey,
  formatAbsolutePath,
  isSafeRelativeSegment,
  parseAbsolutePath,
  relativeSegments,
  type ParsedAbsolutePath,
  type PathStyle,
} from './pathSyntax'

/*
 * 位置写法（实施方案 2.5，存储底座 2.2）。
 *
 * 文档文件与数据库里的文件位置只允许下面几种写法，换算只发生在存取边界（主进程文档仓库、
 * 各数据库仓库），工具与界面在内存里看到的始终是绝对路径：
 *
 * | 写法                                  | 含义                                        | 出现在       |
 * |---------------------------------------|---------------------------------------------|--------------|
 * | `henji:/生成结果/a.png`               | 相对文档所在容器（项目文件夹；独立文档为作品目录） | 只在文档文件里 |
 * | `henji://user/生成结果/a.png`         | 相对作品目录                                 | 文档、数据库  |
 * | `henji://project/<项目ID>/素材/a.png` | 相对某个项目                                 | 文档、数据库  |
 * | `D:\外部\a.mp4`                       | 外部文件，原样记录                           | 文档、数据库  |
 *
 * - 相对部分统一用正斜杠分隔；外部文件保持原始字符串，读回时与写入前逐字相同。
 * - 编码遍历整份内容里的字符串（含对象键），工具不用声明哪些字段是路径；落在多个根里时取最深的根
 *   （项目文件夹在作品目录里，因此项目里的文件写成项目写法）。
 * - 内容里指向本地文件的 `henji-media://local/…` 与 `file://…` 先还原成路径再换算，
 *   存储形态里不会出现这两种地址；`henji-media://` 的其他主机（程序内部资源库）无法换算，原样保留并报告。
 * - 落在程序目录里的路径不应写进文档，原样保留并报告，由调用方记日志、测试拦截。
 * - 解码只处理带前缀的值；无法解析的引用（项目不在、写法损坏、`..` 越界）原样保留并报告。
 */

export const LOCATION_CONTAINER_PREFIX = 'henji:/'
export const LOCATION_USER_PREFIX = 'henji://user/'
export const LOCATION_PROJECT_PREFIX = 'henji://project/'
const LOCATION_HOST_PREFIX = 'henji://'
const PROJECT_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const LOCAL_MEDIA_URL = /^henji-media:\/\/local\//i
const MEDIA_URL = /^henji-media:\/\//i
const FILE_URL = /^file:\/\//i
/** 快速筛掉明显不是路径的字符串（提示词、ID、数字文本等），避免逐个解析。 */
const PATH_LIKE = /^(?:[A-Za-z]:[\\/]|[\\/]|henji|file:)/i
const MAX_TRAVERSAL_DEPTH = 1_024

export type LocationContainer = { kind: 'user' } | { kind: 'project'; projectId: string }

export interface LocationProjectRoot {
  id: string
  /** 项目文件夹的绝对路径（原生写法）。 */
  root: string
}

export interface LocationContext {
  style: PathStyle
  /** 作品目录（绝对路径，原生写法）。 */
  userRoot: string
  /** 已知项目：作品目录里的项目与登记过的外部位置。 */
  projects: readonly LocationProjectRoot[]
  /** 不该写进文档的根（程序目录），只用于报告。 */
  programRoots?: readonly string[]
  /** 文档所在容器；数据库记录不传，此时不使用 `henji:/` 写法。 */
  container?: LocationContainer
}

export type LocationScope = 'container' | 'user' | 'project' | 'external'

export interface LocationReference {
  /** 内存形态（绝对路径）。 */
  path: string
  scope: LocationScope
  /** scope 为 project（或容器是项目）时的项目 ID。 */
  projectId?: string
}

export type LocationUnresolvedReason = 'unknown_project' | 'no_container' | 'invalid'

export interface LocationUnresolved {
  /** 原样保留的存储值。 */
  value: string
  reason: LocationUnresolvedReason
  projectId?: string
}

export interface LocationReport {
  /** 内容里引用的文件位置（去重），外部文件 scope 为 external。 */
  references: LocationReference[]
  /** 落在程序目录里的路径，或无法换算的程序内部资源地址；文档里不该出现。 */
  programReferences: string[]
  /** 解码时无法解析的相对写法（原样保留）。 */
  unresolved: LocationUnresolved[]
}

export interface LocationEncodeResult {
  stored: string
  reference?: LocationReference
  programReference?: boolean
}

export interface LocationDecodeResult {
  value: string
  reference?: LocationReference
  programReference?: boolean
  unresolved?: LocationUnresolved
}

export interface LocationCodec {
  encode(value: string): LocationEncodeResult
  decode(value: string): LocationDecodeResult
  /** 深度遍历整份 JSON 内容（对象键与字符串值），返回新对象，不修改入参。 */
  encodeContent(content: unknown): { content: unknown; report: LocationReport }
  decodeContent(content: unknown): { content: unknown; report: LocationReport }
}

export class LocationTraversalError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LocationTraversalError'
  }
}

type RootRole = 'container' | 'project' | 'user' | 'program'

interface PreparedRoot {
  role: RootRole
  parsed: ParsedAbsolutePath
  projectId?: string
}

const ROLE_PRIORITY: Record<RootRole, number> = { container: 0, project: 1, user: 2, program: 3 }

function requireRoot(style: PathStyle, value: string, label: string): ParsedAbsolutePath {
  const parsed = parseAbsolutePath(style, value)
  if (!parsed) throw new Error(`${label}不是绝对路径：${value}`)
  return parsed
}

/** 存储形态是否为相对写法（`henji:/`、`henji://user/`、`henji://project/`）。 */
export function isEncodedLocation(value: string): boolean {
  return value.startsWith(LOCATION_CONTAINER_PREFIX)
}

function localPathFromUrl(style: PathStyle, value: string, kind: 'media' | 'file'): string | null {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return null
  }
  let pathname: string
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (kind === 'media') {
    // 渲染层写法：`henji-media://local/${encodeURIComponent(path)}`，路径前只多一个斜杠。
    return pathname.startsWith('/') ? pathname.slice(1) : pathname
  }
  if (style === 'win32') {
    if (url.hostname && url.hostname !== 'localhost') return `\\\\${url.hostname}${pathname.replaceAll('/', '\\')}`
    return /^\/[A-Za-z]:/.test(pathname) ? pathname.slice(1) : null
  }
  return url.hostname && url.hostname !== 'localhost' ? null : pathname
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value) as unknown
  return prototype === Object.prototype || prototype === null
}

/**
 * 深度遍历 JSON 内容，对每个字符串值与对象键调用 mapString，返回新对象，不修改入参。
 * 位置换算与移动后改写引用共用；非普通对象（Date、类型化数组等）原样保留。
 */
export function mapContentStrings(content: unknown, mapString: (value: string) => string): unknown {
  return traverseContent(content, mapString, 0)
}

function traverseContent(content: unknown, mapString: (value: string) => string, depth: number): unknown {
  if (depth > MAX_TRAVERSAL_DEPTH) throw new LocationTraversalError('文档内容层级过深，无法换算文件位置。')
  if (typeof content === 'string') return mapString(content)
  if (Array.isArray(content)) return content.map((item) => traverseContent(item, mapString, depth + 1))
  if (!isPlainObject(content)) return content
  const entries: Array<[string, unknown]> = []
  const usedKeys = new Set<string>()
  for (const [key, item] of Object.entries(content)) {
    let mappedKey = mapString(key)
    // 两个键换算后相同会丢数据：后出现的键保持原样（只在键本身已是存储写法时才可能发生）。
    if (usedKeys.has(mappedKey)) mappedKey = key
    usedKeys.add(mappedKey)
    entries.push([mappedKey, traverseContent(item, mapString, depth + 1)])
  }
  // fromEntries 以自有属性写入，`__proto__` 这类键不会改写原型。
  return Object.fromEntries(entries)
}

class ReportCollector {
  private readonly references = new Map<string, LocationReference>()
  private readonly program = new Set<string>()
  private readonly unresolved = new Map<string, LocationUnresolved>()

  constructor(private readonly style: PathStyle) {}

  addReference(reference: LocationReference): void {
    const parsed = parseAbsolutePath(this.style, reference.path)
    const key = parsed ? comparisonKey(this.style, parsed) : reference.path
    if (!this.references.has(key)) this.references.set(key, reference)
  }

  addProgram(value: string): void {
    this.program.add(value)
  }

  addUnresolved(entry: LocationUnresolved): void {
    if (!this.unresolved.has(entry.value)) this.unresolved.set(entry.value, entry)
  }

  build(): LocationReport {
    return {
      references: [...this.references.values()],
      programReferences: [...this.program],
      unresolved: [...this.unresolved.values()],
    }
  }
}

export function createLocationCodec(context: LocationContext): LocationCodec {
  const { style } = context
  const userParsed = requireRoot(style, context.userRoot, '作品目录')
  const roots: PreparedRoot[] = []
  const projectsById = new Map<string, PreparedRoot>()
  let containerRoot: PreparedRoot | null = null

  const userRole: RootRole = context.container?.kind === 'user' ? 'container' : 'user'
  const userRoot: PreparedRoot = { role: userRole, parsed: userParsed }
  roots.push(userRoot)
  if (userRole === 'container') containerRoot = userRoot

  for (const project of context.projects) {
    if (!PROJECT_ID_PATTERN.test(project.id)) throw new Error(`项目 ID 无效：${project.id}`)
    const isContainer = context.container?.kind === 'project' && context.container.projectId === project.id
    const prepared: PreparedRoot = {
      role: isContainer ? 'container' : 'project',
      parsed: requireRoot(style, project.root, '项目文件夹'),
      projectId: project.id,
    }
    projectsById.set(project.id, prepared)
    roots.push(prepared)
    if (isContainer) containerRoot = prepared
  }
  if (context.container?.kind === 'project' && !containerRoot) {
    throw new Error(`文档所在项目不在已知项目里：${context.container.projectId}`)
  }
  for (const programRoot of context.programRoots ?? []) {
    roots.push({ role: 'program', parsed: requireRoot(style, programRoot, '程序目录') })
  }

  function deepestRoot(target: ParsedAbsolutePath): { root: PreparedRoot; rest: string[] } | null {
    let best: { root: PreparedRoot; rest: string[] } | null = null
    for (const root of roots) {
      const rest = relativeSegments(style, root.parsed, target)
      if (!rest) continue
      if (!best) {
        best = { root, rest }
        continue
      }
      const depth = root.parsed.segments.length
      const bestDepth = best.root.parsed.segments.length
      if (depth > bestDepth || (depth === bestDepth && ROLE_PRIORITY[root.role] < ROLE_PRIORITY[best.root.role])) {
        best = { root, rest }
      }
    }
    return best
  }

  function scopeOf(root: PreparedRoot): LocationScope {
    return root.role === 'container' ? 'container' : root.role === 'project' ? 'project' : 'user'
  }

  function referenceFor(root: PreparedRoot, path: string): LocationReference {
    const reference: LocationReference = { path, scope: scopeOf(root) }
    if (root.projectId) reference.projectId = root.projectId
    return reference
  }

  function encode(value: string): LocationEncodeResult {
    if (!PATH_LIKE.test(value) || isEncodedLocation(value)) return { stored: value }
    let candidate: string | null = value
    if (LOCAL_MEDIA_URL.test(value)) candidate = localPathFromUrl(style, value, 'media')
    else if (MEDIA_URL.test(value)) return { stored: value, programReference: true }
    else if (FILE_URL.test(value)) candidate = localPathFromUrl(style, value, 'file')
    if (candidate === null) return { stored: value }
    const parsed = parseAbsolutePath(style, candidate)
    if (!parsed) return { stored: value }
    const match = deepestRoot(parsed)
    if (!match) return { stored: candidate, reference: { path: candidate, scope: 'external' } }
    if (match.root.role === 'program') return { stored: candidate, programReference: true }
    const relative = match.rest.join('/')
    const stored = match.root.role === 'container'
      ? `${LOCATION_CONTAINER_PREFIX}${relative}`
      : match.root.role === 'project'
        ? `${LOCATION_PROJECT_PREFIX}${match.root.projectId}/${relative}`
        : `${LOCATION_USER_PREFIX}${relative}`
    return { stored, reference: referenceFor(match.root, candidate) }
  }

  function resolveRelative(root: PreparedRoot, relative: string, value: string): LocationDecodeResult {
    const parts = relative === '' ? [] : relative.split(style === 'win32' ? /[\\/]/ : '/')
    if (!parts.every((part) => isSafeRelativeSegment(style, part))) {
      return { value, unresolved: { value, reason: 'invalid' } }
    }
    const path = formatAbsolutePath(style, { root: root.parsed.root, segments: [...root.parsed.segments, ...parts] })
    return { value: path, reference: referenceFor(root, path) }
  }

  function decode(value: string): LocationDecodeResult {
    if (!PATH_LIKE.test(value)) return { value }
    if (value.startsWith(LOCATION_HOST_PREFIX)) {
      if (value.startsWith(LOCATION_USER_PREFIX)) {
        return resolveRelative(userRoot, value.slice(LOCATION_USER_PREFIX.length), value)
      }
      if (value.startsWith(LOCATION_PROJECT_PREFIX)) {
        const rest = value.slice(LOCATION_PROJECT_PREFIX.length)
        const slash = rest.indexOf('/')
        const projectId = slash < 0 ? rest : rest.slice(0, slash)
        if (!PROJECT_ID_PATTERN.test(projectId)) return { value, unresolved: { value, reason: 'invalid' } }
        const project = projectsById.get(projectId)
        if (!project) return { value, unresolved: { value, reason: 'unknown_project', projectId } }
        return resolveRelative(project, slash < 0 ? '' : rest.slice(slash + 1), value)
      }
      return { value, unresolved: { value, reason: 'invalid' } }
    }
    if (value.startsWith(LOCATION_CONTAINER_PREFIX)) {
      if (!containerRoot) return { value, unresolved: { value, reason: 'no_container' } }
      return resolveRelative(containerRoot, value.slice(LOCATION_CONTAINER_PREFIX.length), value)
    }
    if (MEDIA_URL.test(value) && !LOCAL_MEDIA_URL.test(value)) return { value, programReference: true }
    // 不带前缀的值保持原样，只归类绝对路径供报告（外部文件、程序目录路径或旧写法的作品目录路径）。
    const parsed = parseAbsolutePath(style, value)
    if (!parsed) return { value }
    const match = deepestRoot(parsed)
    if (!match) return { value, reference: { path: value, scope: 'external' } }
    if (match.root.role === 'program') return { value, programReference: true }
    return { value, reference: referenceFor(match.root, value) }
  }

  function encodeString(value: string, collector: ReportCollector): string {
    const result = encode(value)
    if (result.reference) collector.addReference(result.reference)
    if (result.programReference) collector.addProgram(result.stored)
    return result.stored
  }

  function decodeString(value: string, collector: ReportCollector): string {
    const result = decode(value)
    if (result.reference) collector.addReference(result.reference)
    if (result.programReference) collector.addProgram(result.value)
    if (result.unresolved) collector.addUnresolved(result.unresolved)
    return result.value
  }

  return {
    encode,
    decode,
    encodeContent(content) {
      const collector = new ReportCollector(style)
      return { content: mapContentStrings(content, (value) => encodeString(value, collector)), report: collector.build() }
    },
    decodeContent(content) {
      const collector = new ReportCollector(style)
      return { content: mapContentStrings(content, (value) => decodeString(value, collector)), report: collector.build() }
    },
  }
}
