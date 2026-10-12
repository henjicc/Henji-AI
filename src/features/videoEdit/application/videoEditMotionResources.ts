import { decodePersistenceResource } from '@/core/persistence/resourceContracts'
import { getPlatform } from '@/platform/runtime'
import { creativeIntentPageSchema, type CreativeIntentPage } from '@/core/creativeIntent/pages'
import { assertDraftPage, storedMotionCandidateSchema, type StoredCreativeIntentResource } from '@/core/creativeIntent/persistence'
import { clockEventIssue, refKey, type CreativeIntentPageRef, type MotionDraft, type MotionSample } from '@/core/creativeIntent/contracts'
import type { MotionCandidate } from '@/core/creativeIntent/candidates'
import { requireVideoEditInstance } from './videoEditService'

export async function motionDigest(value: unknown): Promise<string> {
  return hashMotionBytes(new TextEncoder().encode(JSON.stringify(value)))
}
async function hashMotionBytes(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer)
  return `sha256:${[...new Uint8Array(hash)].map(v => v.toString(16).padStart(2, '0')).join('')}`
}
/** Existing import-file contract publishes immutable pages to the document container. */
export async function storeMotionResource(id: string, value: unknown, kind: StoredCreativeIntentResource['kind']): Promise<StoredCreativeIntentResource> {
  return importMotionResourceBytes(id, new TextEncoder().encode(JSON.stringify(value)), kind, 'json', kind === 'page' ? creativeIntentPageSchema.parse(value).sourceDigest : undefined)
}
/** Binary history attachments use the same immutable document-import path as structured evidence. */
export async function storeMotionResourceBytes(id: string, bytes: Uint8Array, kind: StoredCreativeIntentResource['kind'], sourceDigest?: string): Promise<StoredCreativeIntentResource> {
  return importMotionResourceBytes(id, bytes, kind, kind === 'visual' ? 'png' : 'json', sourceDigest)
}
async function importMotionResourceBytes(id: string, bytes: Uint8Array, kind: StoredCreativeIntentResource['kind'], extension: 'json' | 'png', sourceDigest?: string): Promise<StoredCreativeIntentResource> {
  const owner = requireVideoEditInstance(id); const platform = getPlatform()
  const digest = await hashMotionBytes(bytes)
  const resourceId = crypto.randomUUID()
  const temporary = await platform.system.paths.join(await platform.system.paths.tempDir(), `henji-intent-${resourceId}.${extension}`)
  await platform.system.fs.writeFile(temporary, bytes, { exclusive: true })
  try {
    const imported = await platform.documents.importFile({ container: owner.session.documentMeta.container, sourcePath: temporary, folder: 'materials' })
    return { resourceId, path: imported.path, digest, bytes: bytes.byteLength, kind, ...(sourceDigest ? { sourceDigest } : {}) }
  } finally { await platform.system.fs.remove(temporary) }
}
export async function readMotionResourceBytes(resource: StoredCreativeIntentResource): Promise<Uint8Array> {
  const bytes = await getPlatform().system.fs.readFile(resource.path)
  if (bytes.byteLength !== resource.bytes || await hashMotionBytes(bytes) !== resource.digest) throw new Error('原稿或历史画面文件缺失或已被修改，请从项目备份恢复后重试。')
  return bytes
}
export async function readMotionResource(resource: StoredCreativeIntentResource): Promise<unknown> {
  const bytes = await readMotionResourceBytes(resource)
  const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
  return resource.kind === 'page' ? decodePersistenceResource('creative-intent-page', raw)
    : resource.kind === 'candidate' ? decodePersistenceResource('creative-intent-candidate', raw) : raw
}
export async function* readMotionPages(id: string, draft: MotionDraft, signal?: AbortSignal): AsyncGenerator<CreativeIntentPage> {
  if (draft.ownerRef.kind !== 'document.video_edit' || draft.ownerRef.id !== id) throw new Error('原稿归属与当前剪辑不符，请恢复原文件。')
  const head = requireVideoEditInstance(id).document.creativeIntents
  const resources = new Map(head?.resources.map(r => [r.resourceId, r]))
  const refs = draft.takes.flatMap(t => t.samplePages).sort((a, b) => a.seqSpan[0] - b.seqSpan[0])
  const takeOfPage = new Map(draft.takes.flatMap(take => take.samplePages.map(ref => [ref.resourceId, take.id] as const)))
  const targets = new Set(draft.targets.map(target => refKey(target.ref)))
  let seq = -1; let mono = -1
  for (const ref of refs) {
    signal?.throwIfAborted()
    const resource = resources.get(ref.resourceId)
    if (!resource || resource.kind !== 'page' || ref.digest !== resource.digest || ref.bytes !== resource.bytes) throw new Error('草稿页引用缺失，请恢复原文件。')
    const page = creativeIntentPageSchema.parse(await readMotionResource(resource))
    assertDraftPage(page, draft)
    if (page.kind !== 'samples' || page.sourceDigest !== resource.sourceDigest || JSON.stringify(page.ownerRef) !== JSON.stringify(draft.ownerRef) || page.count !== ref.count || JSON.stringify(page.seqSpan) !== JSON.stringify(ref.seqSpan) || JSON.stringify(page.monoSpanUs) !== JSON.stringify(ref.monoSpanUs)) throw new Error('原稿页目录与内容不符，请恢复原文件。')
    for (const sample of page.entries) {
      if (sample.takeRef !== takeOfPage.get(ref.resourceId) || !targets.has(refKey(sample.targetRef))) throw new Error('原稿姿态的片段或示范归属不符，请恢复原文件。')
      if (sample.seq <= seq || sample.monoUs < mono) throw new Error('原稿采样乱序，请恢复原文件。')
      const issue = clockEventIssue(sample, draft.clockSegments)
      if (issue) throw new Error('原稿的采集时间与实际画面不符，请恢复原文件。')
      seq = sample.seq; mono = sample.monoUs
    }
    yield page
  }
}
export function motionSamplePage(draft: MotionDraft, entries: MotionSample[]): CreativeIntentPage {
  const first = entries[0]; const last = entries[entries.length - 1]
  return creativeIntentPageSchema.parse({ version: 1, kind: 'samples', ownerRef: draft.ownerRef, sourceDigest: draft.sourceDigest,
    monoSpanUs: [first.monoUs, last.monoUs], seqSpan: [first.seq, last.seq], count: entries.length, entries })
}
export function motionPageRef(resource: StoredCreativeIntentResource, page: CreativeIntentPage): CreativeIntentPageRef {
  return { resourceId: resource.resourceId, digest: resource.digest, bytes: resource.bytes, kind: page.kind, count: page.count, seqSpan: page.seqSpan, monoSpanUs: page.monoSpanUs }
}
export async function readMotionCandidate(resource: StoredCreativeIntentResource): Promise<MotionCandidate> {
  const { version: _version, ...candidate } = storedMotionCandidateSchema.parse(await readMotionResource(resource))
  return candidate
}
