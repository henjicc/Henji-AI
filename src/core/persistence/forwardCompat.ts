import type { z } from 'zod'

/**
 * 前向兼容（2026-10-21 起正式启用）：文件同时记录写入它的格式版本与“最低可读版本”。
 * 只新增可选字段时最低可读版本不变，旧程序按自己认识的字段打开，并在保存时原样带回它不认识的字段；
 * 改变已有字段含义时才提高最低可读版本，旧程序明确提示升级，不打开、不覆盖。
 */
export type ForwardFieldPath = ReadonlyArray<string | number | { id: string }>
export interface ForwardField { path: ForwardFieldPath; key: string; value: unknown }
export interface ForwardReadResult<T> { value: T; fields: ForwardField[] }

type Record_ = Record<string, unknown>
const isRecord = (value: unknown): value is Record_ => typeof value === 'object' && value !== null && !Array.isArray(value)
const step = (container: unknown[], index: number): string | number | { id: string } => {
  const item = container[index]
  return isRecord(item) && typeof item.id === 'string' && item.id ? { id: item.id } : index
}

/** 文件版本是否可由本程序直接读取（等于当前或更新但最低可读版本不高于当前）。 */
export function persistenceForwardReadable(version: number, minReaderVersion: number | undefined, supported: number): boolean {
  return version > supported && Number.isSafeInteger(minReaderVersion) && minReaderVersion! >= 1 && minReaderVersion! <= supported
}

function at(root: unknown, path: ForwardFieldPath): unknown {
  let value = root
  for (const segment of path) {
    if (Array.isArray(value)) {
      value = typeof segment === 'object' ? value.find(item => isRecord(item) && item.id === segment.id) : value[segment as number]
    } else if (isRecord(value) && typeof segment === 'string') value = Object.hasOwn(value, segment) ? value[segment] : undefined
    else return undefined
  }
  return value
}

function described(root: unknown, path: ReadonlyArray<PropertyKey>): ForwardFieldPath {
  const result: Array<string | number | { id: string }> = []
  let value = root
  for (const segment of path) {
    if (Array.isArray(value) && typeof segment === 'number') { result.push(step(value, segment)); value = value[segment] }
    else if (isRecord(value)) { result.push(String(segment)); value = value[String(segment)] }
    else break
  }
  return result
}

/** raw 中存在、解析结果中被去掉的键（宽松对象静默剥离的未知字段）。按数组下标对齐，记录稳定 id 路径。 */
function collectStripped(raw: unknown, parsed: unknown, path: Array<string | number | { id: string }>, out: ForwardField[]): void {
  if (Array.isArray(raw) && Array.isArray(parsed) && raw.length === parsed.length) {
    raw.forEach((item, index) => collectStripped(item, parsed[index], [...path, step(raw, index)], out))
    return
  }
  if (!isRecord(raw) || !isRecord(parsed)) return
  for (const [key, value] of Object.entries(raw)) {
    if (!Object.hasOwn(parsed, key)) out.push({ path, key, value: structuredClone(value) })
    else collectStripped(value, parsed[key], [...path, key], out)
  }
}

/**
 * 用当前 schema 读取更新版本写出的内容：未知字段（严格对象报错的与宽松对象剥离的）记录下来，其余按当前 schema 校验。
 * 不认识的字段之外的内容不合当前 schema 时照常失败，由调用方按“内容不受支持”报告。
 */
export function readForwardCompatible<T>(schema: z.ZodType<T>, content: unknown, maxRounds = 64): ForwardReadResult<T> {
  const working: unknown = structuredClone(content)
  const fields: ForwardField[] = []
  for (let round = 0; round < maxRounds; round++) {
    const parsed = schema.safeParse(working)
    if (parsed.success) {
      collectStripped(working, parsed.data, [], fields)
      return { value: parsed.data, fields }
    }
    const unknown = parsed.error.issues.filter(issue => issue.code === 'unrecognized_keys')
    if (!unknown.length || unknown.length !== parsed.error.issues.length) throw parsed.error
    for (const issue of unknown) {
      const owner = at(working, issue.path as ForwardFieldPath)
      if (!isRecord(owner)) throw parsed.error
      for (const key of (issue as { keys: string[] }).keys) {
        fields.push({ path: described(working, issue.path), key, value: structuredClone(owner[key]) })
        delete owner[key]
      }
    }
  }
  throw new Error('前向读取的未知字段层级过深。')
}

/** 保存时把本程序不认识的字段放回原处；所在对象已被删除时随之丢弃，已有同名键时以本次内容为准。 */
export function restoreForwardFields<T>(content: T, fields: readonly ForwardField[]): T {
  if (!fields.length) return content
  const next = structuredClone(content)
  for (const field of fields) {
    const owner = at(next, field.path)
    if (isRecord(owner) && !Object.hasOwn(owner, field.key)) owner[field.key] = structuredClone(field.value)
  }
  return next
}
