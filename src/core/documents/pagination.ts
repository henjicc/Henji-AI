/** Per-response work budget; callers can continue until nextCursor is null. */
export const DOCUMENT_PAGE_SIZE = 100
export const MAX_DOCUMENT_PAGE_SIZE = 1000

export interface ListPageRequest {
  cursor?: string
  pageSize?: number
}

export interface ListPage<T> {
  items: T[]
  total: number
  nextCursor: string | null
}

export interface ListCursor { time: number; name: string; id: string }

export function readListCursor(cursor?: string): ListCursor | null {
  if (cursor === undefined) return null
  let value: unknown
  try { value = JSON.parse(cursor) }
  catch { throw new Error('列表位置无效，请重新加载列表。') }
  if (!value || typeof value !== 'object' || !('time' in value) || !('name' in value) || !('id' in value)
    || typeof value.time !== 'number' || !Number.isFinite(value.time) || typeof value.name !== 'string' || typeof value.id !== 'string') {
    throw new Error('列表位置无效，请重新加载列表。')
  }
  return { time: value.time, name: value.name, id: value.id }
}

export function listPageSize(request: ListPageRequest): number {
  const size = request.pageSize ?? DOCUMENT_PAGE_SIZE
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_DOCUMENT_PAGE_SIZE) throw new Error('列表批次大小无效。')
  return size
}

/** Storage test doubles use the same ordering/cursor contract as SQLite BINARY. */
export function pageList<T>(rows: readonly T[], request: ListPageRequest, key: (row: T) => ListCursor): ListPage<T> {
  const compare = (a: ListCursor, b: ListCursor): number => b.time - a.time
    || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  const cursor = readListCursor(request.cursor)
  const sorted = [...rows].sort((a, b) => compare(key(a), key(b)))
  const remaining = cursor ? sorted.filter((row) => compare(key(row), cursor) > 0) : sorted
  const size = listPageSize(request)
  const items = remaining.slice(0, size)
  return { items, total: rows.length, nextCursor: remaining.length > size ? JSON.stringify(key(items[items.length - 1])) : null }
}
