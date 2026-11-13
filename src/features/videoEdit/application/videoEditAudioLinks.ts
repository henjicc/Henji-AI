import { finalizeDocument } from '@/commands/documents'
import { createLogger } from '@/core/logging'
import { videoEditClipMedia, type VideoEditDocument, type VideoEditMedia } from '@/core/videoEdit/document'
import type { DocumentSummary } from '@/core/documents/types'
import { videoEditClipSourceRange } from '@/core/videoEdit/clipSpeed'
import { videoEditFps, videoEditSourceSeconds } from '@/core/videoEdit/time'
import { applyVideoEditTimelineEdit } from '@/core/videoEdit/timelineEdits'
import { updateVideoEditAudioLinks, type AudioLinkNotice } from '@/core/videoEdit/audioLink'
import { videoEditCaptionsFromAudioEdit, videoEditLinkedTimeline, type VideoEditLinkedTimeline } from '@/core/videoEdit/audioEditLink'
import { buildProjectAudioEditTimeline } from '@/core/audioEdit/timeline'
import { buildProjectAudioEditSubtitleCues, type AudioEditSubtitleCue } from '@/core/audioEdit/subtitles'
import { getPlatform } from '@/platform/runtime'
import { createAudioEditDraft, editAudioEditProject, flushAudioEditProject, getAudioEditProjectInstance, loadAudioEditProject, registerAudioEditMultitrackOpener, subscribeAudioEditInstances, renderAudioEdit } from '@/features/audioEdit'
import { createVideoEditDocument, createVideoEditSequence } from '@/core/videoEdit/document'
import { videoEditLayoutPresets, VIDEO_EDIT_AUDIO_LAYOUT_PRESET } from '../layout/videoEditDockLayout'
import { setVideoEditView, subscribeVideoEditView, switchVideoEditSequence } from './videoEditService'
import { editVideoProject, listVideoEditInstances, requireVideoEditInstance, subscribeVideoEditDomain, videoEditDocumentOperations, saveVideoEdit } from './videoEditService'
import { openDocumentFromVideoEdit } from './videoEditComposition'
import { matchHenjiExtension } from '@/core/fileExtensions'
import { useNavigationStore } from '@/stores/navigationStore'
import { videoEditMediaPathKey } from './videoEditMedia'

const logger = createLogger('features.videoEdit.audioLinks')
const notices = new Map<string, AudioLinkNotice[]>()
/** 刷新期间口播又保存了新版本：这一版作废，等新版本的刷新，不算失败。 */
class AudioLinkStaleError extends Error {}
export function getVideoEditAudioLinkNotices(projectId: string): readonly AudioLinkNotice[] { return notices.get(projectId) ?? [] }
function links(document: VideoEditDocument, id?: string) {
  return document.sequences.flatMap(s => s.clips).filter(c => c.kind === 'audio' && c.creativeSource?.type === 'document' && matchHenjiExtension('audio_edit', c.creativeSource.docRef.path) && (!id || c.creativeSource.docRef.docId === id))
}
/** 成品是按内容命名、写完不再改动的缓存文件，放进项目时用硬链接：同一磁盘不再多占一份几百 MB 的空间。 */
async function durableAudio(projectId: string, rendered: Awaited<ReturnType<typeof renderAudioEdit>>, name: string, linkedTimeline?: VideoEditLinkedTimeline): Promise<{ media: VideoEditMedia; created: boolean }> {
  const container = requireVideoEditInstance(projectId).session.documentMeta.container
  const imported = await videoEditDocumentOperations().importFile({ container, sourcePath: rendered.audioPath, folder: 'generated', link: true })
  return { created: imported.copied, media: { id: crypto.randomUUID(), name, kind: 'audio', path: imported.path, durationSeconds: rendered.durationFrames / rendered.sampleRate, width: 0, height: 0, hasAudio: true, ...(linkedTimeline ? { linkedTimeline } : {}) } }
}
/** 成品文件按内容命名（finished-<内容键>.wav）：剪辑里已有同一份成品（复制进项目时只可能多一个序号后缀）就直接沿用，不再复制一遍。 */
function sameRender(media: VideoEditMedia, rendered: { audioPath: string }): boolean {
  const stem = (path: string): string => (path.split(/[\\/]/).pop() ?? '').replace(/\.wav$/i, '').replace(/ \(\d+\)$/, '')
  return stem(media.path) === stem(rendered.audioPath)
}
/** 音频编辑文档当前的源录音时间线与字幕段（与渲染所用的同一版本）。 */
async function loadAudioLinkTimeline(documentId: string, revision: number): Promise<{ timeline: VideoEditLinkedTimeline; cues: AudioEditSubtitleCue[] }> {
  const audio = await loadAudioEditProject(documentId)
  // 渲染读的是文件版本（会话 revision）；document.revision 是内存编辑计数，两者不同步。内存里还有未保存的修改时字幕会领先声音，等保存后再刷新。
  if (audio.persistedRevision !== revision || audio.dirty) throw new AudioLinkStaleError('音频正在更新，将在保存后重试')
  const spans = buildProjectAudioEditTimeline(audio.document)
  return { timeline: videoEditLinkedTimeline(spans, audio.document.source.sampleRate), cues: buildProjectAudioEditSubtitleCues(audio.document) }
}
export async function sendVideoEditClipToAudioEdit(projectId: string, clipId: string, open = true): Promise<{ documentId: string; clipId: string; created: boolean }> {
  const owner = requireVideoEditInstance(projectId), baseline = owner.document
  const sequence = baseline.sequences.find(s => s.clips.some(c => c.id === clipId))
  const clip = sequence?.clips.find(c => c.id === clipId)
  if (!sequence || !clip || !['audio', 'video'].includes(clip.kind)) throw new Error('请选择音频片段或带声音的视频片段')
  const linked = clip.kind === 'audio' ? clip : sequence.clips.find(c => c.kind === 'audio' && c.linkId && c.linkId === clip.linkId)
  if (linked?.creativeSource?.type === 'document' && matchHenjiExtension('audio_edit', linked.creativeSource.docRef.path)) {
    const resolved = await videoEditDocumentOperations().resolveDocumentLink(linked.creativeSource.docRef)
    if (resolved.status !== 'found') throw new Error('链接的音频作品找不到，请重新定位')
    // 已有链接：顺带把音频作品最新保存的版本立即更新进剪辑，不等停改计时
    await refreshAudioLinkNow(projectId, resolved.meta.id)
    const summary = await videoEditDocumentOperations().findDocument(resolved.meta.id)
    if (open && summary) await openDocumentFromVideoEdit(projectId, summary)
    return { documentId: resolved.meta.id, clipId: linked.id, created: false }
  }
  if (clip.sourceComponent === 'video') throw new Error('请在已分离的声音片段上打开音频编辑')
  const track = sequence.tracks.find(t => t.index === clip.track)
  if (track?.locked) throw new Error('请先解锁片段轨道')
  if (clip.kind === 'video' && !sequence.tracks.some(t => t.kind === 'audio' && !t.locked)) throw new Error('请先新建一条未锁定的音频轨道')
  const media = videoEditClipMedia(baseline, clip)
  if (!media || media.hasAudio === false) throw new Error('该片段没有可编辑的源音频')
  logger.info('开始送到音频编辑', { event: 'video_edit.audio_link.send.start', context: { projectId, clipId } })
  try {
    const source = await getPlatform().audioEdit.probeSource(media.path)
    const range = videoEditClipSourceRange(clip, videoEditFps(sequence.frameRate))
    const startFrame = Math.max(0, Math.floor(range.from * source.sampleRate)), endFrame = Math.min(source.durationFrames, Math.ceil(range.to * source.sampleRate))
    if (endFrame <= startFrame) throw new Error('片段没有可编辑的声音范围')
    const audio = await createAudioEditDraft(source, owner.session.documentMeta.container)
    editAudioEditProject(audio.document.id, doc => ({ ...doc, cuts: [
      ...(startFrame ? [{ id: crypto.randomUUID(), startFrame: 0, endFrame: startFrame, mode: 'delete' as const, reason: 'manual' as const, enabled: true }] : []),
      ...(endFrame < source.durationFrames ? [{ id: crypto.randomUUID(), startFrame: endFrame, endFrame: source.durationFrames, mode: 'delete' as const, reason: 'manual' as const, enabled: true }] : []),
    ] }))
    await flushAudioEditProject(audio.document.id)
    // Promote the linked document out of the disposable draft lifecycle.
    // 作品以片段名命名（“旁白”而不是“未命名音频 1”）；同名时依次加序号。
    await audio.session.withTransfer(async () => {
      const base = (clip.name || media.name).trim().slice(0, 120) || audio.session.documentMeta.name
      let result: Awaited<ReturnType<typeof finalizeDocument>> | undefined
      for (let attempt = 1; !result; attempt++) {
        try { result = await finalizeDocument({ target: audio.session.target, name: attempt === 1 ? base : `${base} ${attempt}` }) }
        catch (error) { if (attempt >= 20 || !String(error instanceof Error ? error.message : error).includes('同名')) throw error }
      }
      await audio.session.applyTransfer(result)
    })
    const rendered = await renderAudioEdit(audio.document.id)
    const { media: output } = await durableAudio(projectId, rendered, `${(clip.name || media.name).trim()} · 音频编辑`, videoEditLinkedTimeline(buildProjectAudioEditTimeline(audio.document), audio.document.source.sampleRate))
    if (requireVideoEditInstance(projectId) !== owner || owner.document !== baseline) throw new Error('准备期间剪辑已改变，请重新选择片段')
    const itemId = crypto.randomUUID()
    let targetId = clipId
    editVideoProject(projectId, document => {
      let next = document
      if (clip.kind === 'video') {
        const audioTrack = sequence.tracks.find(t => t.kind === 'audio' && !t.locked)
        if (!audioTrack) throw new Error('请先新建一条未锁定的音频轨道')
        const split = applyVideoEditTimelineEdit(document, sequence.id, { kind: 'separate_audio', clipIds: [clipId], linked: false, audioTrack: audioTrack.index })
        const sound = split.clips.find(c => c.kind === 'audio' && !sequence.clips.some(old => old.id === c.id))
        if (!sound) throw new Error('无法分离视频声音')
        targetId = sound.id
        next = { ...next, sequences: next.sequences.map(s => s.id === sequence.id ? split : s) }
      }
      return { ...next, media: [...next.media, output], items: [...next.items, { id: itemId, name: output.name, kind: 'audio', mediaId: output.id }], sequences: next.sequences.map(s => ({ ...s, clips: s.clips.map(c => c.id !== targetId ? c : {
        ...c, itemId, sourceComponent: undefined, sourceInUs: Math.max(0, Math.round((videoEditSourceSeconds(clip) - startFrame / source.sampleRate) * 1e6)), sourceRemainder: { numerator: 0, denominator: 1 },
        creativeSource: { type: 'document' as const, docRef: { docId: audio.document.id, path: audio.session.documentMeta.path }, revision: rendered.revision },
      }) })) }
    })
    await saveVideoEdit(projectId)
    const summary = await videoEditDocumentOperations().findDocument(audio.document.id)
    if (open && summary) await openDocumentFromVideoEdit(projectId, summary)
    logger.info('已送到音频编辑', { event: 'video_edit.audio_link.send.completed', context: { projectId, clipId: targetId, documentId: audio.document.id } })
    return { documentId: audio.document.id, clipId: targetId, created: true }
  } catch (error) { logger.error('送到音频编辑失败', { event: 'video_edit.audio_link.send.failed', error, context: { projectId, clipId } }); throw error }
}

const queues = new Map<string, Promise<number>>()
/**
 * 每个“剪辑:口播”放进项目的成品：paths 从旧到新，始终保留最新两版；discarded 是放进项目后因口播又改了而作废、没用上的。
 * 只清理本次运行里新建的文件。
 */
const versions = new Map<string, { paths: string[]; discarded: string[] }>()
const createdFiles = new Set<string>()
const fileName = (path: string): string => path.split(/[\\/]/).pop() ?? path

/** 剪辑里有片段引用着的一个链接素材项，且没有别的东西用它时，新版成品直接换进这一项，素材箱里不再每次多一条。 */
function replaceableItem(document: VideoEditDocument, documentId: string): VideoEditDocument['items'][number] | undefined {
  const linked = links(document, documentId)
  const ids = new Set(linked.map(clip => clip.itemId))
  if (ids.size !== 1) return undefined
  const [id] = ids
  const item = document.items.find(value => value.id === id)
  if (!item?.mediaId) return undefined
  const clips = document.sequences.flatMap(sequence => sequence.clips)
  const usedElsewhere = clips.some(clip => clip.itemId === id && !linked.includes(clip) || clip.takes?.some(take => take.itemId === id || take.linkedAudio?.some(audio => audio.clip.itemId === id)))
    || document.creativePlacements?.some(placement => placement.itemId === id)
  return usedElsewhere ? undefined : item
}

/**
 * 还可能有人用的文件名：打开的剪辑（当前内容与撤销、重做记录），以及磁盘上全部剪辑文档最后存盘的内容（含已关闭、未打开的）。
 * 直接读文件原文按文件名查找（不走文档读取，免得旧格式被升级写回），宁可多留；有剪辑文件找不到或读不出来就返回 undefined，这次不清。
 */
async function referencedFileNames(names: readonly string[]): Promise<Set<string> | undefined> {
  const found = new Set<string>()
  for (const instance of listVideoEditInstances()) for (const document of [instance.document, ...instance.past, ...instance.future]) for (const media of document.media) found.add(fileName(media.path))
  try {
    for (const summary of await videoEditDocumentOperations().listDocuments({ kind: 'video_edit', includeDrafts: true, includeMissing: true })) {
      if (summary.missing) throw new Error('有剪辑文件找不到，无法确认它是否引用旧版成品')
      const text = await getPlatform().system.fs.readTextFile(summary.path)
      for (const name of names) if (text.includes(name)) found.add(name)
    }
  } catch (error) {
    logger.warn('读不全剪辑文档的引用，这次不清理旧版口播成品', { event: 'video_edit.audio_link.cleanup.deferred', error })
    return undefined
  }
  return found
}
/** 旧版成品进回收区（可恢复），返回这次留下的那些（还有人用、读不全引用或移入失败）。 */
async function trashUnusedVersions(key: string, paths: readonly string[]): Promise<string[]> {
  const candidates = paths.filter(path => createdFiles.has(videoEditMediaPathKey(path)))
  if (!candidates.length) return []
  const referenced = await referencedFileNames(candidates.map(fileName))
  if (!referenced) return candidates
  const kept: string[] = []
  for (const path of candidates) {
    const id = videoEditMediaPathKey(path)
    // 读引用期间别的清理可能已经处理过它
    if (!createdFiles.has(id)) continue
    if (referenced.has(fileName(path))) { kept.push(path); continue }
    createdFiles.delete(id)
    try {
      await getPlatform().settings.trashFile(path)
      logger.info('旧版口播成品已移入回收区', { event: 'video_edit.audio_link.cleanup.completed', context: { key, path } })
    } catch (error) { createdFiles.add(id); kept.push(path); logger.warn('旧版口播成品未能移入回收区', { event: 'video_edit.audio_link.cleanup.failed', error, context: { key, path } }) }
  }
  return kept
}
/** 清理最新两版之外的旧成品与作废的成品；还有人用的留到下次更新或剪辑关闭时再看。 */
async function cleanupAudioLinkVersions(key: string): Promise<void> {
  const entry = versions.get(key)
  if (!entry) return
  const latest = new Set(entry.paths.slice(-2).map(videoEditMediaPathKey))
  const old = [...entry.discarded, ...entry.paths.slice(0, -2)].filter(path => !latest.has(videoEditMediaPathKey(path)))
  if (!old.length) return
  const kept = new Set((await trashUnusedVersions(key, old)).map(videoEditMediaPathKey))
  const current = versions.get(key) ?? entry
  current.discarded = current.discarded.filter(path => kept.has(videoEditMediaPathKey(path)) || !old.includes(path))
  current.paths = current.paths.filter(path => !old.includes(path) || kept.has(videoEditMediaPathKey(path)))
}

export async function refreshVideoEditAudioDocumentClips(projectId: string, documentId: string): Promise<number> {
  const key = `${projectId}:${documentId}`
  const run = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(async () => {
    const owner = requireVideoEditInstance(projectId), linked = links(owner.document, documentId)
    const origin = linked[0]?.creativeSource
    if (origin?.type !== 'document') return 0
    const resolved = await videoEditDocumentOperations().resolveDocumentLink(origin.docRef)
    if (resolved.status !== 'found') throw new Error('找不到链接的音频作品，保留上次声音')
    if (linked.every(c => c.creativeSource?.type === 'document' && c.creativeSource.revision === resolved.meta.revision)) return 0
    const revision = resolved.meta.revision
    const started = performance.now()
    logger.info('开始更新口播链接', { event: 'video_edit.audio_link.refresh.start', context: { projectId, documentId, revision } })
    // 成品由主进程按内容缓存：同一版内容只渲染一次；渲染在后台进行，期间剪辑照常可用、旧声音照常播放。
    const rendered = await getPlatform().audioEdit.render({ projectId: resolved.meta.id })
    if (rendered.revision !== revision) throw new AudioLinkStaleError('音频正在更新，将在保存后重试')
    const { timeline, cues } = await loadAudioLinkTimeline(resolved.meta.id, revision)
    // 字幕文字或分段不影响声音成品，因此可复用剪辑里已有的声音文件
    const reused = owner.document.media.find(media => sameRender(media, rendered) && linked.some(clip => owner.document.items.find(item => item.id === clip.itemId)?.mediaId === media.id))
    const durable = reused ? undefined : await durableAudio(projectId, rendered, resolved.meta.name, timeline)
    const media = reused ?? durable!.media
    const entry = versions.get(key) ?? { paths: [], discarded: [] }
    versions.set(key, entry)
    if (durable?.created) createdFiles.add(videoEditMediaPathKey(media.path))
    let changed = 0
    try {
      const latest = await videoEditDocumentOperations().resolveDocumentLink(origin.docRef)
      if (requireVideoEditInstance(projectId) !== owner) throw new Error('剪辑已关闭，未应用声音更新')
      if (latest.status !== 'found' || latest.meta.revision !== revision) throw new AudioLinkStaleError('链接来源已变化，未应用过期声音')
      // 一次口播更新（声音、片段长度、字幕）在剪辑里是一步撤销
      editVideoProject(projectId, document => {
        const reusedItem = reused ? document.items.find(item => item.mediaId === reused.id) : undefined
        const replaced = reusedItem ? undefined : replaceableItem(document, documentId)
        const itemId = reusedItem?.id ?? replaced?.id ?? crypto.randomUUID()
        const result = updateVideoEditAudioLinks(document, documentId, itemId, { ...origin, revision }, media.durationSeconds, timeline, cues)
        changed = result.changed; notices.set(projectId, [...otherNotices(projectId, document, documentId), ...result.notices])
        if (!changed) return document
        if (reusedItem) return result.document
        if (replaced) {
          const stillUsed = result.document.items.some(item => item.id !== replaced.id && item.mediaId === replaced.mediaId)
          return { ...result.document, media: [...result.document.media.filter(value => stillUsed || value.id !== replaced.mediaId), media], items: result.document.items.map(item => item.id === replaced.id ? { ...item, mediaId: media.id } : item) }
        }
        return { ...result.document, media: [...document.media, media], items: [...document.items, { id: itemId, name: media.name, kind: 'audio', mediaId: media.id }] }
      }, [], true)
    } catch (error) {
      // 已放进项目却没用上的成品记为作废，之后随清理一起处理
      if (durable?.created) entry.discarded.push(media.path)
      throw error
    }
    await saveVideoEdit(projectId)
    if (changed) {
      entry.paths = [...entry.paths.filter(path => videoEditMediaPathKey(path) !== videoEditMediaPathKey(media.path)), media.path]
      await cleanupAudioLinkVersions(key)
    }
    logger.info('口播链接已更新', { event: 'video_edit.audio_link.refresh.completed', context: { projectId, documentId, revision, changed, reused: Boolean(reused), elapsedMs: Math.round(performance.now() - started) } })
    return changed
  })
  queues.set(key, run)
  try { return await run } finally { if (queues.get(key) === run) queues.delete(key) }
}

/** 口播停止改动这么久之后才刷新剪辑；回到剪辑、开始播放、导出前或助手同步时立即开始。 */
export const VIDEO_EDIT_AUDIO_LINK_IDLE_MS = 5000
/** 失败后按指数退避自动重试的上限。 */
const AUDIO_LINK_RETRY_MAX_MS = 5 * 60_000
const pending = new Map<string, { projectId: string; documentId: string; attempt: number; timer: ReturnType<typeof setTimeout> }>()
function otherNotices(projectId: string, document: VideoEditDocument, documentId: string): AudioLinkNotice[] {
  const ids = new Set(links(document, documentId).map(clip => clip.id))
  return (notices.get(projectId) ?? []).filter(notice => !ids.has(notice.clipId))
}
function setDocumentNotices(projectId: string, documentId: string, message: string): void {
  const owner = listVideoEditInstances().find(instance => instance.document.id === projectId)
  if (owner) notices.set(projectId, [...otherNotices(projectId, owner.document, documentId), ...links(owner.document, documentId).map(clip => ({ clipId: clip.id, message }))])
}
/**
 * 立即刷新一条链接（取消它的停改计时），返回剪辑是否已是口播最新保存的版本。
 * 失败时保留上次声音，并按退避自动重试（参数拖动中、剪辑正在导出等暂时写不进去的情况，条件满足后自然成功）。
 */
async function refreshAudioLinkNow(projectId: string, documentId: string): Promise<boolean> {
  const key = `${projectId}:${documentId}`
  const waiting = pending.get(key)
  if (waiting) { clearTimeout(waiting.timer); pending.delete(key) }
  try { await refreshVideoEditAudioDocumentClips(projectId, documentId); return true }
  catch (error) {
    // 刷新期间又有新的保存排好了计时：交给它，不改成退避重试
    if (pending.has(key)) { logger.debug('口播又保存了新版本，等待新版本刷新', { event: 'video_edit.audio_link.refresh.superseded', error, context: { projectId, documentId } }); return false }
    if (!listVideoEditInstances().some(instance => instance.document.id === projectId)) return false
    const attempt = (waiting?.attempt ?? 0) + 1
    scheduleAudioLinkRefresh(projectId, documentId, attempt)
    setDocumentNotices(projectId, documentId, '音频更新未完成，仍使用上次声音，稍后自动重试。')
    logger.warn('音频链接未更新，保留上次声音，稍后重试', { event: 'video_edit.audio_link.refresh.failed', error, context: { projectId, documentId, attempt } })
    return false
  }
}
function scheduleAudioLinkRefresh(projectId: string, documentId: string, attempt = 0): void {
  const key = `${projectId}:${documentId}`
  const waiting = pending.get(key)
  if (waiting) clearTimeout(waiting.timer)
  const delay = Math.min(AUDIO_LINK_RETRY_MAX_MS, VIDEO_EDIT_AUDIO_LINK_IDLE_MS * 2 ** attempt)
  const entry = { projectId, documentId, attempt, timer: setTimeout(() => { void refreshAudioLinkNow(projectId, documentId) }, delay) }
  pending.set(key, entry)
  if (!attempt) setDocumentNotices(projectId, documentId, '音频作品有新的保存，停止修改几秒后、回到剪辑或开始播放时开始更新（新声音就绪前继续播放旧的），导出前会先更新。')
}
/**
 * 把等待中的口播改动立即更新进剪辑，并等正在进行的更新结束；导出前、播放时与助手同步时调用。
 * 返回剪辑是否已用上口播最新保存的版本；signal 取消时不再等待（更新本身照常在后台完成）。
 */
export async function flushVideoEditAudioLinks(projectId?: string, documentId?: string, signal?: AbortSignal): Promise<boolean> {
  signal?.throwIfAborted()
  const matches = (key: string): boolean => (!projectId || key.startsWith(`${projectId}:`)) && (!documentId || key.endsWith(`:${documentId}`))
  const runs: Promise<boolean>[] = []
  for (const [key, entry] of [...pending]) if (matches(key)) runs.push(refreshAudioLinkNow(entry.projectId, entry.documentId))
  for (const [key, run] of queues) if (matches(key)) runs.push(run.then(() => true, () => false))
  if (!runs.length) return true
  const all = Promise.all(runs).then(results => results.every(Boolean) && ![...pending.keys()].some(matches))
  if (!signal) return await all
  return await new Promise<boolean>((resolve, reject) => {
    const abort = (): void => reject(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    void all.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}
/** 导出前把口播最新改动更新进剪辑；没能更新时给导出结果一句用户看得到的提示。 */
export async function prepareVideoEditAudioLinksForExport(projectId: string, signal?: AbortSignal): Promise<string | undefined> {
  return await flushVideoEditAudioLinks(projectId, undefined, signal) ? undefined : '音频作品的最新改动没能更新进剪辑，这次导出用的是上次的声音和字幕。'
}
/** 切到“音频”布局：剪辑工作区的布局配置读完之后再切，否则读到的旧配置会把它覆盖。 */
async function applyVideoEditAudioLayout(): Promise<void> {
  await videoEditLayoutPresets.load().catch(() => undefined)
  await videoEditLayoutPresets.apply(VIDEO_EDIT_AUDIO_LAYOUT_PRESET).catch(error => logger.warn('切换音频布局失败', { event: 'video_edit.audio_link.multitrack.layout_failed', error }))
}

/**
 * 音频编辑的“多轨”（参照 Audition 的“波形 | 多轨”）：多轨就是剪辑的序列，用“音频”布局打开（时间线 + 音轨混合器）。
 * 已打开的剪辑里有片段链接着这份音频作品时回到那里；否则新建一份多轨剪辑，把这份作品渲染的声音以动态链接放在第一条音频轨上。
 */
async function openAudioDocumentInMultitrack(audioDocumentId: string): Promise<void> {
  const operations = videoEditDocumentOperations()
  /** 打开剪辑、切到音频布局，并选中链接着这份作品的片段。 */
  const reveal = async (summary: DocumentSummary): Promise<void> => {
    await operations.openDocument(summary)
    await applyVideoEditAudioLayout()
    const video = listVideoEditInstances().find(instance => instance.document.id === summary.id)
    const clip = video && links(video.document, audioDocumentId)[0]
    const sequence = clip && video.document.sequences.find(s => s.clips.some(c => c.id === clip.id))
    if (video && clip && sequence) { switchVideoEditSequence(video.document.id, sequence.id); setVideoEditView(video.document.id, { selection: clip.id }) }
    logger.info('回到多轨', { event: 'video_edit.audio_link.multitrack.opened', context: { projectId: summary.id, documentId: audioDocumentId } })
  }
  for (const video of listVideoEditInstances()) {
    const summary = links(video.document, audioDocumentId).length ? await operations.findDocument(video.document.id) : undefined
    if (summary) return await reveal(summary)
  }
  const audio = getAudioEditProjectInstance(audioDocumentId)
  if (!audio) throw new Error('请先打开这份音频作品。')
  const container = audio.session.documentMeta.container
  // 多轨剪辑没打开（例如重启之后）：在同一容器里找链接着这份作品的剪辑，找到就打开它，不重复新建。
  for (const summary of await operations.listDocuments({ kind: 'video_edit', container, includeDrafts: false, includeMissing: false })) {
    const read = await operations.readDocument({ id: summary.id, path: summary.path }).catch(() => undefined)
    const content = read?.content as Partial<VideoEditDocument> | undefined
    if (content?.sequences && links({ sequences: content.sequences } as VideoEditDocument, audioDocumentId).length) return await reveal(summary)
  }
  await flushAudioEditProject(audioDocumentId)
  const rendered = await renderAudioEdit(audioDocumentId)
  const name = audio.session.documentMeta.name
  const path = (await operations.importFile({ container, sourcePath: rendered.audioPath, folder: 'generated', link: true })).path
  const document = createVideoEditDocument(`${name} · 多轨`)
  const sequence = createVideoEditSequence('多轨混音')
  sequence.sampleRate = rendered.sampleRate === 44100 ? 44100 : 48000
  // Audition 新建多轨会话默认有多条音轨：这里给三条音频轨（第一条放这份作品），画面轨留一条备用。
  const audioTrack = sequence.tracks.find(track => track.kind === 'audio')!
  const videoTrack = sequence.tracks.find(track => track.kind === 'video')!
  sequence.tracks = [{ ...audioTrack, name: '音频 1', index: 0 }, { ...audioTrack, id: crypto.randomUUID(), name: '音频 2', index: 1 }, { ...audioTrack, id: crypto.randomUUID(), name: '音频 3', index: 2 }, { ...videoTrack, index: 3 }]
  const mediaId = crypto.randomUUID(), itemId = crypto.randomUUID()
  const durationSeconds = rendered.durationFrames / rendered.sampleRate
  document.media = [{ id: mediaId, name, kind: 'audio', path, durationSeconds, width: 0, height: 0, hasAudio: true, linkedTimeline: videoEditLinkedTimeline(buildProjectAudioEditTimeline(audio.document), audio.document.source.sampleRate) }]
  document.items = [{ id: itemId, name, kind: 'audio', mediaId }]
  sequence.clips = [{ id: crypto.randomUUID(), itemId, name, kind: 'audio', track: 0, start: 0, duration: Math.max(1, Math.round(durationSeconds * videoEditFps(sequence.frameRate))), sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 },
    x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', audioRole: audio.document.effectChain?.find(item => item.kind === 'essential')?.settings.type ?? 'dialogue',
    creativeSource: { type: 'document', docRef: { docId: audioDocumentId, path: audio.session.documentMeta.path }, revision: rendered.revision } }]
  sequence.captions = videoEditCaptionsFromAudioEdit(sequence.clips[0], videoEditFps(sequence.frameRate), buildProjectAudioEditSubtitleCues(audio.document), audio.document.source.sampleRate)
  document.sequences = [sequence]
  const { format: _format, version: _version, id: _id, name: _name, revision: _revision, ...content } = document
  const meta = await operations.createDocument({ kind: 'video_edit', container, name: document.name, content, onConflict: 'keepBoth' })
  const summary = await operations.findDocument(meta.id)
  if (!summary) throw new Error('多轨剪辑已建好，但没找到文件，请在项目里打开。')
  await operations.openDocument(summary)
  await applyVideoEditAudioLayout()
  logger.info('新建多轨', { event: 'video_edit.audio_link.multitrack.created', context: { projectId: meta.id, documentId: audioDocumentId } })
}

export function startVideoEditAudioDocumentLinks(): () => void {
  const stopOpener = registerAudioEditMultitrackOpener(openAudioDocumentInMultitrack)
  const observed = new Map<string, number>()
  const stopAudio = subscribeAudioEditInstances(instance => {
    if (instance.dirty || instance.error || observed.get(instance.document.id) === instance.persistedRevision) return
    observed.set(instance.document.id, instance.persistedRevision)
    for (const video of listVideoEditInstances()) if (links(video.document, instance.document.id).length) scheduleAudioLinkRefresh(video.document.id, instance.document.id)
  })
  const checked = new WeakSet<object>()
  let open = new Set<string>()
  const stopVideo = subscribeVideoEditDomain(() => {
    const instances = listVideoEditInstances()
    for (const video of instances) {
      if (checked.has(video)) continue
      checked.add(video)
      for (const id of new Set(links(video.document).flatMap(c => c.creativeSource?.type === 'document' ? [c.creativeSource.docRef.docId] : []))) void refreshAudioLinkNow(video.document.id, id)
    }
    // 剪辑关闭后它的撤销记录随之释放：这时清理它留下的旧版成品
    const current = new Set(instances.map(instance => instance.document.id))
    for (const projectId of open) if (!current.has(projectId)) {
      for (const [key, entry] of [...pending]) if (entry.projectId === projectId) { clearTimeout(entry.timer); pending.delete(key) }
        // 关闭的剪辑最后存盘的内容由磁盘扫描核对，撤销记录不再需要旧版
      for (const key of [...versions.keys()]) if (key.startsWith(`${projectId}:`)) void cleanupAudioLinkVersions(key).finally(() => versions.delete(key))
      notices.delete(projectId)
    }
    open = current
  })
  // 播放开关只发视图变化：开始播放（由停到播）时把等待中的口播改动开始更新
  const wasPlaying = new WeakMap<object, boolean>()
  const stopView = subscribeVideoEditView(() => {
    for (const video of listVideoEditInstances()) {
      if (video.playing && !wasPlaying.get(video) && [...pending.values()].some(entry => entry.projectId === video.document.id)) void flushVideoEditAudioLinks(video.document.id)
      wasPlaying.set(video, video.playing)
    }
  })
  const stopNavigation = useNavigationStore.subscribe((state, previous) => { if (state.activeWorkspace === 'videoEdit' && previous.activeWorkspace !== 'videoEdit') void flushVideoEditAudioLinks() })
  return () => {
    stopOpener(); stopAudio(); stopVideo(); stopView(); stopNavigation()
    for (const entry of pending.values()) clearTimeout(entry.timer)
    pending.clear()
  }
}
