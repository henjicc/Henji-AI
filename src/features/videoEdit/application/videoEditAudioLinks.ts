import { finalizeDocument } from '@/commands/documents'
import { createLogger } from '@/core/logging'
import { videoEditClipMedia, type VideoEditDocument, type VideoEditMedia } from '@/core/videoEdit/document'
import type { DocumentSummary } from '@/core/documents/types'
import { videoEditClipSourceRange } from '@/core/videoEdit/clipSpeed'
import { videoEditFps, videoEditSourceSeconds } from '@/core/videoEdit/time'
import { applyVideoEditTimelineEdit } from '@/core/videoEdit/timelineEdits'
import { updateVideoEditAudioLinks, type AudioLinkNotice } from '@/core/videoEdit/audioLink'
import { getPlatform } from '@/platform/runtime'
import { createAudioEditDraft, editAudioEditProject, flushAudioEditProject, getAudioEditProjectInstance, registerAudioEditMultitrackOpener, subscribeAudioEditInstances, renderAudioEdit } from '@/features/audioEdit'
import { createVideoEditDocument, createVideoEditSequence } from '@/core/videoEdit/document'
import { videoEditLayoutPresets, VIDEO_EDIT_AUDIO_LAYOUT_PRESET } from '../layout/videoEditDockLayout'
import { setVideoEditView, switchVideoEditSequence } from './videoEditService'
import { editVideoProject, listVideoEditInstances, requireVideoEditInstance, subscribeVideoEditDomain, videoEditDocumentOperations, saveVideoEdit } from './videoEditService'
import { openDocumentFromVideoEdit } from './videoEditComposition'
import { matchHenjiExtension } from '@/core/fileExtensions'

const logger = createLogger('features.videoEdit.audioLinks')
const notices = new Map<string, AudioLinkNotice[]>()
export function getVideoEditAudioLinkNotices(projectId: string): readonly AudioLinkNotice[] { return notices.get(projectId) ?? [] }
function links(document: VideoEditDocument, id?: string) {
  return document.sequences.flatMap(s => s.clips).filter(c => c.kind === 'audio' && c.creativeSource?.type === 'document' && matchHenjiExtension('audio_edit', c.creativeSource.docRef.path) && (!id || c.creativeSource.docRef.docId === id))
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
  if (linked?.creativeSource?.type === 'document' && matchHenjiExtension('audio_edit', linked.creativeSource.docRef.path)) {
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
    const output = await durableAudio(projectId, rendered, `${(clip.name || media.name).trim()} · 音频编辑`)
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
/** 切到“音频”布局：剪辑工作区的布局配置读完之后再切，否则读到的旧配置会把它覆盖。 */
async function applyVideoEditAudioLayout(): Promise<void> {
  await videoEditLayoutPresets.load().catch(() => undefined)
  await videoEditLayoutPresets.apply(VIDEO_EDIT_AUDIO_LAYOUT_PRESET).catch(error => logger.warn('切换音频布局失败', { event: 'video_edit.audio_link.multitrack.layout_failed', error }))
}

/**
 * 音频编辑的“多轨”（参照 Audition 的“波形 | 多轨”）：多轨就是剪辑的序列，用“音频”布局打开（时间线 + 音轨混合器）。
 * 已打开的剪辑里有片段链接着这份音频作品时回到那里；否则新建一份多轨剪辑，把这份作品渲染的声音以动态链接放在第一条音频轨上。
 */
export async function openAudioDocumentInMultitrack(audioDocumentId: string): Promise<void> {
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
  if (container.kind !== 'project') throw new Error('多轨剪辑只能放在项目里：请先把这份音频作品移到一个项目中再打开多轨。')
  // 多轨剪辑没打开（例如重启之后）：在同一项目里找链接着这份作品的剪辑，找到就打开它，不重复新建。
  for (const summary of await operations.listDocuments({ kind: 'video_edit', container, includeDrafts: false, includeMissing: false })) {
    const read = await operations.readDocument({ id: summary.id, path: summary.path }).catch(() => undefined)
    const content = read?.content as Partial<VideoEditDocument> | undefined
    if (content?.sequences && links({ sequences: content.sequences } as VideoEditDocument, audioDocumentId).length) return await reveal(summary)
  }
  await flushAudioEditProject(audioDocumentId)
  const rendered = await renderAudioEdit(audioDocumentId)
  const name = audio.session.documentMeta.name
  const path = (await operations.importFile({ container, sourcePath: rendered.audioPath, folder: 'generated' })).path
  const document = createVideoEditDocument(`${name} · 多轨`)
  const sequence = createVideoEditSequence('多轨混音')
  sequence.sampleRate = rendered.sampleRate === 44100 ? 44100 : 48000
  // Audition 新建多轨会话默认有多条音轨：这里给三条音频轨（第一条放这份作品），画面轨留一条备用。
  const audioTrack = sequence.tracks.find(track => track.kind === 'audio')!
  const videoTrack = sequence.tracks.find(track => track.kind === 'video')!
  sequence.tracks = [{ ...audioTrack, name: '音频 1', index: 0 }, { ...audioTrack, id: crypto.randomUUID(), name: '音频 2', index: 1 }, { ...audioTrack, id: crypto.randomUUID(), name: '音频 3', index: 2 }, { ...videoTrack, index: 3 }]
  const mediaId = crypto.randomUUID(), itemId = crypto.randomUUID()
  const durationSeconds = rendered.durationFrames / rendered.sampleRate
  document.media = [{ id: mediaId, name, kind: 'audio', path, durationSeconds, width: 0, height: 0, hasAudio: true }]
  document.items = [{ id: itemId, name, kind: 'audio', mediaId }]
  sequence.clips = [{ id: crypto.randomUUID(), itemId, name, kind: 'audio', track: 0, start: 0, duration: Math.max(1, Math.round(durationSeconds * videoEditFps(sequence.frameRate))), sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 },
    x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1, text: '', audioRole: audio.document.effectChain?.find(item => item.kind === 'essential')?.settings.type ?? 'dialogue',
    creativeSource: { type: 'document', docRef: { docId: audioDocumentId, path: audio.session.documentMeta.path }, revision: rendered.revision } }]
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
  return () => { stopOpener(); stopAudio(); stopVideo() }
}
