import { z } from 'zod'
import type { DocumentContainerRef, DocumentSummary } from '@/core/documents/types'
import type { RecordingDocument } from '@/core/screenRecording/document'
import { createLogger } from '@/core/logging'
import { getAudioEditProjectInstance, loadAudioEditProject } from '@/features/audioEdit'
import { getPlatform } from '@/platform/runtime'
import type { DocumentsPlatform } from '@/platform/contracts/documents'
import type { CapabilityExecutionContext } from '@/features/application-control'
import type { MediaContentQueryProgressUpdate } from '@/core/media/contentIndex'
import { sameVideoEditMediaPath } from './videoEditMedia'

type AudioOwner = Awaited<ReturnType<typeof loadAudioEditProject>>
type Scope = 'none' | 'project' | 'all'
interface Options { discoveryScope: Scope; audioDocumentRef?: { id: string }; recordingRef?: { id: string } }
interface RecordingOwner { meta: { id: string; revision: number }; content: RecordingDocument }
interface Catalog { entries: DocumentSummary[]; active: Map<string, unknown>; complete: boolean; warnings: string[] }
const logger = createLogger('features.videoEdit.contentDocuments')
// Derived path hints only: never retain cold transcripts, or add another persisted content index.
const pathCaches = new WeakMap<DocumentsPlatform, Map<string, { token: string; paths: string[] }>>()
const audioPaths = z.object({ source: z.object({ sourcePath: z.string().min(1) }).nullable() })
const recordingPaths = z.object({ media: z.array(z.object({ path: z.string().min(1) })) })
const summaryToken = (value: DocumentSummary): string => JSON.stringify([value.id, value.kind, value.path, value.container, value.revision, value.fileModifiedAt, value.sizeBytes])
const activeToken = (value: DocumentSummary): unknown => {
  const active = value.kind === 'audio_edit' ? getAudioEditProjectInstance(value.id) : undefined
  return active ? [active.version, active.document.source.sourcePath] : null
}

/** Discover authorized documents without opening unrelated editors or cloning their full word tables. */
export async function readVideoEditContentDocuments(options: Options, container: DocumentContainerRef, mediaPath: string,
  context: Pick<CapabilityExecutionContext, 'signal' | 'callerGrant' | 'requestId'>, onProgress?: (update: MediaContentQueryProgressUpdate) => void) {
  const platform = getPlatform(); const signal = context.signal
  const permissions = context.callerGrant?.permissions
  const permitted = (permission: 'audio_edit:read' | 'screen_recording:read'): boolean => !permissions || permissions.includes(permission)
  if (options.audioDocumentRef && !permitted('audio_edit:read')) throw new Error('PERMISSION_DENIED:读取关联口播需要 audio_edit:read。')
  if (options.recordingRef && !permitted('screen_recording:read')) throw new Error('PERMISSION_DENIED:读取关联录制需要 screen_recording:read。')
  const warnFailure = (id: string, error: unknown): void => {
    logger.warn('素材关联文档发现不完整', { event: 'video_edit.content_index.discovery.incomplete', requestId: context.requestId, context: { documentId: id }, error })
  }
  const catalog = async (report = true): Promise<Catalog> => {
    const entries: DocumentSummary[] = []; const warnings: string[] = []; const failures: string[] = []
    if (options.discoveryScope !== 'none') for (const [kind, permission] of [['audio_edit', 'audio_edit:read'], ['screen_recording', 'screen_recording:read']] as const) {
      if (!permitted(permission)) { warnings.push(`没有${kind === 'audio_edit' ? '口播' : '录制'}读取权限，未发现这类关联文档。`); failures.push(kind); continue }
      let cursor: string | undefined
      const seen = new Set<string>()
      try {
        do {
          signal.throwIfAborted()
          const page = await platform.documents.listDocumentsPage({ kind, container: options.discoveryScope === 'all' ? { kind: 'any' } : container, includeDrafts: true, includeMissing: false, pageSize: 100, ...(cursor ? { cursor } : {}) })
          signal.throwIfAborted()
          entries.push(...page.items)
          if (report) onProgress?.({ phase: 'listing_documents', message: '查找关联文档', completedUnits: entries.length, totalUnits: null })
          cursor = page.nextCursor ?? undefined
          if (cursor && seen.has(cursor)) throw new Error('关联文档列表分页未推进。')
          if (cursor) seen.add(cursor)
        } while (cursor)
      } catch (error) {
        signal.throwIfAborted(); failures.push(kind); warnings.push(`${kind === 'audio_edit' ? '口播' : '录制'}文档列表未能完整读取，请稍后重试。`); warnFailure(kind, error)
      }
    }
    const unique = [...new Map(entries.map(entry => [entry.id, entry])).values()].sort((a, b) => a.id.localeCompare(b.id))
    return { entries: unique, active: new Map(unique.map(entry => [entry.id, activeToken(entry)])), complete: !failures.length, warnings }
  }
  onProgress?.({ phase: 'listing_documents', message: '查找关联文档', completedUnits: 0, totalUnits: null })
  const initial = await catalog(); const warnings = [...initial.warnings]
  let complete = initial.complete; let failedDocuments = 0
  let cache = pathCaches.get(platform.documents)
  if (!cache) { cache = new Map(); pathCaches.set(platform.documents, cache) }
  const discovered = new Map<string, DocumentSummary>()
  let scanned = 0
  onProgress?.({ phase: 'reading_documents', message: '检查关联文档的来源', completedUnits: 0, totalUnits: initial.entries.length })
  for (const entry of initial.entries) {
    signal.throwIfAborted()
    try {
      const active = entry.kind === 'audio_edit' ? getAudioEditProjectInstance(entry.id) : undefined
      const token = summaryToken(entry)
      let paths: string[]
      if (active) paths = [active.document.source.sourcePath]
      else {
        const hint = cache.get(entry.id)
        if (hint?.token === token) { paths = hint.paths; cache.delete(entry.id); cache.set(entry.id, hint) }
        else {
          const read = await platform.documents.readDocument({ id: entry.id })
          signal.throwIfAborted()
          if (read.meta.kind !== entry.kind || read.meta.revision !== entry.revision) throw new Error('发现期间文档已改变，请重新查询。')
          if (entry.kind === 'audio_edit') { const source = audioPaths.parse(read.content).source; paths = source ? [source.sourcePath] : [] }
          else paths = recordingPaths.parse(read.content).media.map(media => media.path)
          cache.delete(entry.id)
          while (cache.size >= 512) cache.delete(cache.keys().next().value!)
          cache.set(entry.id, { token, paths })
        }
      }
      if (paths.some(path => sameVideoEditMediaPath(path, mediaPath))) discovered.set(entry.id, entry)
    } catch (error) { signal.throwIfAborted(); complete = false; failedDocuments++; warnFailure(entry.id, error) }
    onProgress?.({ phase: 'reading_documents', message: '检查关联文档的来源', completedUnits: ++scanned, totalUnits: initial.entries.length })
  }
  const audioIds = new Set([...discovered.values()].filter(entry => entry.kind === 'audio_edit').map(entry => entry.id))
  const recordingIds = new Set([...discovered.values()].filter(entry => entry.kind === 'screen_recording').map(entry => entry.id))
  if (options.audioDocumentRef) audioIds.add(options.audioDocumentRef.id)
  if (options.recordingRef) recordingIds.add(options.recordingRef.id)
  const audios: Array<{ owner: AudioOwner; version: number }> = []
  const loadedAudioTokens = new Map<string, unknown>()
  const recordings: RecordingOwner[] = []
  const totalAssociated = audioIds.size + recordingIds.size; let checked = 0
  onProgress?.({ phase: 'checking_associated_sources', message: '核对匹配的口播与录制', completedUnits: 0, totalUnits: totalAssociated })
  for (const id of audioIds) {
    signal.throwIfAborted()
    try {
      const owner = await loadAudioEditProject(id); const version = owner.version
      loadedAudioTokens.set(id, [version, owner.document.source.sourcePath])
      if (!sameVideoEditMediaPath(owner.document.source.sourcePath, mediaPath)) throw new Error('audioDocumentRef 的原文件与目标素材不同，请选择同源口播。')
      await platform.audioEdit.verifySource(id)
      signal.throwIfAborted()
      audios.push({ owner, version })
    } catch (error) {
      signal.throwIfAborted()
      if (id === options.audioDocumentRef?.id) throw error
      complete = false; failedDocuments++; warnFailure(id, error)
    }
    onProgress?.({ phase: 'checking_associated_sources', message: '核对匹配的口播与录制', completedUnits: ++checked, totalUnits: totalAssociated })
  }
  const recordingApi = recordingIds.size ? await import('@/features/screenRecording') : undefined
  for (const id of recordingIds) {
    signal.throwIfAborted()
    try {
      const read = await recordingApi!.readRecordingUnderstanding(id)
      if (!read.content.media.some(media => sameVideoEditMediaPath(media.path, mediaPath)) || !['stopped', 'interrupted'].includes(read.content.status)) throw new Error('recordingRef 必须是包含此原文件的已停止录制。')
      recordings.push(read)
    } catch (error) {
      signal.throwIfAborted()
      if (id === options.recordingRef?.id) throw error
      complete = false; failedDocuments++; warnFailure(id, error)
    }
    onProgress?.({ phase: 'checking_associated_sources', message: '核对匹配的口播与录制', completedUnits: ++checked, totalUnits: totalAssociated })
  }
  if (failedDocuments) warnings.push(`有 ${failedDocuments} 份文档未能读取或核实，关联内容不完整；可修复来源后重新查询。`)
  if (recordings.length) warnings.push('关联录制仅保存了原文件路径，未保存文件身份；这些记录的来源尚未核实，请结合实际画面复核。')
  const assertAudioCurrent = (): void => {
    if (audios.some(({ owner, version }) => getAudioEditProjectInstance(owner.document.id) !== owner || owner.version !== version || owner.session.isEnded)) throw new Error('查询期间关联口播已改变，请重新查询。')
  }
  // Loading a cold matching audio creates an instance; bind discovery to the resulting live version.
  const expectedCatalog = JSON.stringify(initial.entries.map(entry => [summaryToken(entry), initial.active.get(entry.id) ?? loadedAudioTokens.get(entry.id) ?? null]))
  const signature = JSON.stringify([container, options.discoveryScope, initial.warnings, expectedCatalog, [...discovered.keys()], audios.map(({ owner, version }) => [owner.document.id, version]), recordings.map(read => [read.meta.id, read.meta.revision]), complete])
  return {
    audios, recordings, warnings, signature,
    discovery: { scope: options.discoveryScope, complete, scannedDocuments: initial.entries.length, matchedDocuments: audios.length + recordings.length },
    assertCurrentSync: assertAudioCurrent,
    async assertCurrent(): Promise<void> {
      signal.throwIfAborted(); assertAudioCurrent()
      const latest = await catalog(false)
      if (JSON.stringify(latest.warnings) !== JSON.stringify(initial.warnings) || JSON.stringify(latest.entries.map(entry => [summaryToken(entry), latest.active.get(entry.id)])) !== expectedCatalog) throw new Error('查询期间关联文档目录或内容已改变，请重新查询。')
      for (const read of recordings) if ((await recordingApi!.readRecordingUnderstanding(read.meta.id)).meta.revision !== read.meta.revision) throw new Error('查询期间录制理解已改变，请重新查询。')
      assertAudioCurrent(); signal.throwIfAborted()
    },
  }
}
