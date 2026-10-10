import { createHash, randomUUID } from 'node:crypto'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { creativeIntentsSchema, storedMotionCandidateSchema, type StoredCreativeIntentResource } from '../../../../src/core/creativeIntent/persistence'
import { creativeIntentPageSchema } from '../../../../src/core/creativeIntent/pages'
import { isSafeRelativeSegment } from '../../../../src/core/storage/pathSyntax'

const digest = (bytes: Uint8Array): string => `sha256:${createHash('sha256').update(bytes).digest('hex')}`
/** Rebinding a copied document publishes new immutable pages; source files are never overwritten. */
export async function rehomeVideoMotionResources(content: unknown, oldId: string, newId: string, root: string): Promise<unknown> {
  if (!content || typeof content !== 'object' || !('creativeIntents' in content) || !content.creativeIntents) return content
  const head = creativeIntentsSchema.parse(content.creativeIntents)
  if ([...head.drafts, ...head.sessions].some(draft => draft.ownerRef.kind !== 'document.video_edit' || draft.ownerRef.id !== oldId)) throw new Error('原稿归属与剪辑文件不符，不能复制或导入。')
  if (oldId === newId) return content
  const refId = (id: string): string => id === oldId ? newId : id.startsWith(`${oldId}:`) ? `${newId}${id.slice(oldId.length)}` : id
  const remap = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(remap)
    if (!value || typeof value !== 'object') return value
    const object = value as Record<string, unknown>
    return Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, typeof entry === 'string' && (key === 'visitRef' || key === 'id' && typeof object.kind === 'string' && ['document.video_edit', 'video_edit.document', 'video_edit.clip', 'video_edit.sequence'].includes(object.kind)) ? refId(entry) : remap(entry)]))
  }
  const replacements = new Map<string, StoredCreativeIntentResource>()
  const published: string[] = []
  const publish = async (resource: StoredCreativeIntentResource, value: unknown): Promise<void> => {
    const relative = resource.path.startsWith('henji:/')
    const segments = relative ? resource.path.slice('henji:/'.length).split('/') : []
    if (relative && (!segments.length || segments.some(s => !isSafeRelativeSegment('win32', s)))) throw new Error('原稿资源路径无效。')
    const source = relative ? path.join(root, ...segments) : resource.path
    if (!path.isAbsolute(source)) throw new Error('原稿资源必须已定位。')
    const bytes = await fsp.readFile(source)
    if (bytes.byteLength !== resource.bytes || digest(bytes) !== resource.digest) throw new Error('原稿资源已损坏，不能复制或导入。')
    const nextBytes = Buffer.from(JSON.stringify(value), 'utf8'); const resourceId = randomUUID(); const name = `henji-intent-${resourceId}.json`
    await fsp.writeFile(path.join(path.dirname(source), name), nextBytes, { flag: 'wx' })
    published.push(path.join(path.dirname(source), name))
    const nextPath = relative ? `henji:/${[...segments.slice(0, -1), name].join('/')}` : path.join(path.dirname(source), name)
    replacements.set(resource.resourceId, { ...resource, resourceId, path: nextPath, digest: digest(nextBytes), bytes: nextBytes.byteLength })
  }
  const read = async (resource: StoredCreativeIntentResource): Promise<unknown> => {
    const relative = resource.path.startsWith('henji:/')
    const segments = relative ? resource.path.slice(7).split('/') : []
    if (relative && segments.some(s => !isSafeRelativeSegment('win32', s))) throw new Error('原稿资源路径无效。')
    return JSON.parse(await fsp.readFile(relative ? path.join(root, ...segments) : resource.path, 'utf8')) as unknown
  }
  try {
  for (const resource of head.resources.filter(r => r.kind === 'page')) await publish(resource, remap(creativeIntentPageSchema.parse(await read(resource))))
  const next = creativeIntentsSchema.parse(remap(head))
  for (const draft of next.drafts) for (const take of draft.takes) for (const ref of take.samplePages) { const r = replacements.get(ref.resourceId); if (r) { ref.resourceId = r.resourceId; ref.digest = r.digest; ref.bytes = r.bytes } }
  const sources = new Map<string, string>()
  for (const draft of next.drafts) {
    const previous = draft.sourceDigest
    draft.sourceDigest = digest(Buffer.from(JSON.stringify({ ...draft, sourceDigest: undefined, candidateRefs: [], selectedCandidateRef: undefined, applications: [] })))
    sources.set(previous, draft.sourceDigest)
  }
  for (const resource of head.resources.filter(r => r.kind === 'candidate')) {
    const candidate = storedMotionCandidateSchema.parse(remap(await read(resource)))
    candidate.identity.sourceDraftDigest = sources.get(candidate.identity.sourceDraftDigest) ?? candidate.identity.sourceDraftDigest
    await publish(resource, candidate)
  }
  for (const draft of next.drafts) for (const ref of draft.candidateRefs) { const r = replacements.get(ref.resourceId); if (r) { ref.digest = r.digest; ref.bytes = r.bytes } }
  for (const options of next.motionOptions ?? []) if (options.originalRef) { const r = replacements.get(options.originalRef.resourceId); if (r) { options.originalRef.digest = r.digest; options.originalRef.bytes = r.bytes } }
  const replaceReferences = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(replaceReferences)
    if (!value || typeof value !== 'object') return value
    const object = value as Record<string, unknown>; const replacement = typeof object.resourceId === 'string' ? replacements.get(object.resourceId) : undefined
    return replacement ? { ...object, resourceId: replacement.resourceId, digest: replacement.digest, bytes: replacement.bytes, ...('path' in object ? { path: replacement.path } : {}) } : Object.fromEntries(Object.entries(object).map(([key, entry]) => [key, typeof entry === 'string' && (key === 'candidateRef' || key === 'selectedCandidateRef') ? replacements.get(entry)?.resourceId ?? entry : replaceReferences(entry)]))
  }
  return { ...content, creativeIntents: creativeIntentsSchema.parse(replaceReferences(next)) }
  } catch (error) {
    for (const file of published) await fsp.unlink(file).catch(cleanupError => { if ((cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw new AggregateError([error, cleanupError], '原稿重绑失败，未发布资源清理失败。') })
    throw error
  }
}
