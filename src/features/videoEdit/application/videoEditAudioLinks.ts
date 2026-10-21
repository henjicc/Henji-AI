import { finalizeDocument } from '@/commands/documents'
import { createLogger } from '@/core/logging'
import { videoEditClipMedia, type VideoEditDocument, type VideoEditMedia } from '@/core/videoEdit/document'
import { videoEditClipSourceRange } from '@/core/videoEdit/clipSpeed'
import { videoEditFps, videoEditSourceSeconds } from '@/core/videoEdit/time'
import { applyVideoEditTimelineEdit } from '@/core/videoEdit/timelineEdits'
import { updateVideoEditAudioLinks, type AudioLinkNotice } from '@/core/videoEdit/audioLink'
import { getPlatform } from '@/platform/runtime'
import { createAudioEditDraft, editAudioEditProject, flushAudioEditProject, subscribeAudioEditInstances, renderAudioEdit } from '@/features/audioEdit'
import { editVideoProject, listVideoEditInstances, requireVideoEditInstance, subscribeVideoEditDomain, videoEditDocumentOperations, saveVideoEdit } from './videoEditService'
import { openDocumentFromVideoEdit } from './videoEditComposition'

const logger = createLogger('features.videoEdit.audioLinks')
const notices = new Map<string, AudioLinkNotice[]>()
export function getVideoEditAudioLinkNotices(projectId: string): readonly AudioLinkNotice[] { return notices.get(projectId) ?? [] }
function links(document: VideoEditDocument, id?: string) {
  return document.sequences.flatMap(s => s.clips).filter(c => c.kind === 'audio' && c.creativeSource?.type === 'document' && c.creativeSource.docRef.path.toLowerCase().endsWith('.henji-audio') && (!id || c.creativeSource.docRef.docId === id))
}
async function durableAudio(projectId: string, rendered: Awaited<ReturnType<typeof renderAudioEdit>>, name: string): Promise<VideoEditMedia> {
  const container = requireVideoEditInstance(projectId).session.documentMeta.container
  const path = container.kind === 'project' ? (await videoEditDocumentOperations().importFile({ container, sourcePath: rendered.audioPath, folder: 'generated' })).path : rendered.audioPath
  return { id: crypto.randomUUID(), name, kind: 'audio', path, durationSeconds: rendered.durationFrames / rendered.sampleRate, width: 0, height: 0, hasAudio: true }
}
export async function sendVideoEditClipToAudioEdit(projectId: string, clipId: string, open = true): Promise<{ documentId: string; clipId: string; created: boolean }> {
  const owner = requireVideoEditInstance(projectId), baseline = owner.document
  const sequence = baseline.sequences.find(s => s.clips.some(c => c.id === clipId))
  const clip = sequence?.clips.find(c => c.id === clipId)
  if (!sequence || !clip || !['audio', 'video'].includes(clip.kind)) throw new Error('请选择音频片段或带声音的视频片段')
  const linked = clip.kind === 'audio' ? clip : sequence.clips.find(c => c.kind === 'audio' && c.linkId && c.linkId === clip.linkId)
  if (linked?.creativeSource?.type === 'document' && linked.creativeSource.docRef.path.toLowerCase().endsWith('.henji-audio')) {
    const resolved = await videoEditDocumentOperations().resolveDocumentLink(linked.creativeSource.docRef)
    if (resolved.status !== 'found') throw new Error('链接的音频作品找不到，请重新定位')
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
    await audio.session.withTransfer(async () => {
      const result = await finalizeDocument({ target: audio.session.target, name: audio.session.documentMeta.name })
      await audio.session.applyTransfer(result)
    })
    const rendered = await renderAudioEdit(audio.document.id)
    const output = await durableAudio(projectId, rendered, `${media.name} · 音频编辑`)
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
    const rendered = await getPlatform().audioEdit.render({ projectId: resolved.meta.id })
    if (rendered.revision !== revision) throw new Error('音频正在更新，将在保存后重试')
    const media = await durableAudio(projectId, rendered, resolved.meta.name)
    const latest = await videoEditDocumentOperations().resolveDocumentLink(origin.docRef)
    if (requireVideoEditInstance(projectId) !== owner || latest.status !== 'found' || latest.meta.revision !== revision) throw new Error('链接来源已变化，未应用过期声音')
    const itemId = crypto.randomUUID()
    let changed = 0
    editVideoProject(projectId, document => {
      const result = updateVideoEditAudioLinks(document, documentId, itemId, { ...origin, revision }, media.durationSeconds)
      changed = result.changed; notices.set(projectId, result.notices)
      if (!changed) return document
      return { ...result.document, media: [...document.media, media], items: [...document.items, { id: itemId, name: media.name, kind: 'audio', mediaId: media.id }] }
    })
    await saveVideoEdit(projectId)
    return changed
  })
  queues.set(key, run)
  try { return await run } finally { if (queues.get(key) === run) queues.delete(key) }
}
export function startVideoEditAudioDocumentLinks(): () => void {
  const observed = new Map<string, number>()
  const refresh = (projectId: string, id: string): void => { void refreshVideoEditAudioDocumentClips(projectId, id).catch(error => {
    const owner = listVideoEditInstances().find(instance => instance.document.id === projectId)
    if (owner) notices.set(projectId, links(owner.document, id).map(clip => ({ clipId: clip.id, message: '音频更新未完成，仍使用上次声音。请检查音频作品后重试更新。' })))
    logger.warn('音频链接未更新，保留上次声音', { event: 'video_edit.audio_link.refresh.failed', error, context: { projectId, documentId: id } })
  }) }
  const stopAudio = subscribeAudioEditInstances(instance => {
    if (instance.dirty || instance.error || observed.get(instance.document.id) === instance.persistedRevision) return
    observed.set(instance.document.id, instance.persistedRevision)
    for (const video of listVideoEditInstances()) if (links(video.document, instance.document.id).length) refresh(video.document.id, instance.document.id)
  })
  const checked = new WeakSet<object>()
  const stopVideo = subscribeVideoEditDomain(() => {
    for (const video of listVideoEditInstances()) {
      if (checked.has(video)) continue
      checked.add(video)
      for (const id of new Set(links(video.document).flatMap(c => c.creativeSource?.type === 'document' ? [c.creativeSource.docRef.docId] : []))) refresh(video.document.id, id)
    }
  })
  return () => { stopAudio(); stopVideo() }
}
