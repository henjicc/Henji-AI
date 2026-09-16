import { z } from 'zod'

const reference = z.object({ kind: z.string().regex(/^[a-z][a-z0-9_.-]*$/), id: z.string().min(1).max(512) }).strict()
export type ResourceRef = z.infer<typeof reference>
export function applicationResourceUri(ref: ResourceRef, format: 'entity' | 'text' | 'media' = 'entity'): string {
  const parsed = reference.parse(ref)
  return `henji://${format}/${encodeURIComponent(parsed.kind)}/${encodeURIComponent(parsed.id)}`
}
export function parseApplicationResourceUri(uri: string): { ref: ResourceRef; format: 'entity' | 'text' | 'media' } {
  const url = new URL(uri)
  if (url.protocol !== 'henji:' || url.search || url.hash || !['entity', 'text', 'media'].includes(url.host)) throw new Error('INVALID_RESOURCE:资源引用格式不正确。')
  const parts = url.pathname.slice(1).split('/')
  if (parts.length !== 2) throw new Error('INVALID_RESOURCE:资源引用格式不正确。')
  const ref = reference.parse({ kind: decodeURIComponent(parts[0]), id: decodeURIComponent(parts[1]) })
  const format = url.host as 'entity' | 'text' | 'media'
  if (applicationResourceUri(ref, format) !== uri) throw new Error('INVALID_RESOURCE:请使用正式资源引用。')
  return { ref, format }
}
