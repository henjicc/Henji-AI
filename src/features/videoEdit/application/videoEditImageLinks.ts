import { createLogger } from '@/core/logging'
import type { VideoEditDocument, VideoEditClip } from '@/core/videoEdit/document'
import type { VideoEditDocumentSource } from '@/core/videoEdit/creativeResult'
import { createImageEditorV3RequestId, loadImageEditorV3Document } from '@/commands/imageEditorV3'
import { onImageDocumentCommitted } from '@/features/imageEdit/documents/imageDocumentPersistence'
import { ensureImageDocumentOpenInBackground } from '@/features/imageEdit/documents/imageDocumentRuntime'
import type { ImageEditorV3DocumentRef } from '@/platform/contracts/imageEditorV3'
import { prepareVideoEditCreativeResult } from './videoEditCreativeSources'
import { importVideoEditSources } from './videoEditMedia'
import { listVideoEditInstances, requireVideoEditInstance, subscribeVideoEditDomain, videoEditDocumentOperations, type VideoEditInstance } from './videoEditService'

/*
 * 图片文档放进剪辑保持链接（4.1）：片段的来源是图片文档本身（不是一张导出的图），画面是它的受管渲染
 * （复制进项目“生成结果”）。图片文档每次写回（保存、空闲、关闭），打开着的剪辑里链接它的片段自动重新渲染：
 * 片段换用新渲染、记下新版本，位置、时长、变换与效果不变；不再被引用的旧素材项与旧媒体一并移出剪辑（文件留在磁盘）。
 * 这是一次普通的剪辑修改（会自动保存，也能撤销回上一张渲染）。剪辑没打开时保存的图片文档，在剪辑下次打开时
 * 逐份核对：文档版本已比片段记录的新，就照样重新渲染。
 */

const logger = createLogger('features.videoEdit.imageLinks')
const DEBOUNCE_MS = 300
const timers = new Map<string, ReturnType<typeof setTimeout>>()
const queues = new Map<string, Promise<unknown>>()

type LinkedClip = VideoEditClip & { creativeSource: VideoEditDocumentSource }

function linkedClips(document: VideoEditDocument, documentId: string): LinkedClip[] {
  return document.sequences.flatMap((sequence) => sequence.clips)
    .filter((clip): clip is LinkedClip => clip.kind === 'image' && clip.creativeSource?.type === 'document' && clip.creativeSource.docRef.docId === documentId)
}

/** 工作副本当前版本（图片文档已关闭、工作副本已回收时为 null：照样重新渲染）。 */
async function workingRevision(documentId: string): Promise<number | null> {
  try {
    const snapshot = await loadImageEditorV3Document({ requestId: createImageEditorV3RequestId('video-edit-image-link'), documentRef: `image-edit-v3:${documentId}` as ImageEditorV3DocumentRef })
    return snapshot?.revision ?? null
  } catch {
    return null
  }
}

/**
 * 重新渲染剪辑里链接某份图片文档的片段；返回换了画面的片段数（版本没变时为 0）。
 * 界面与写回通知共用；同一剪辑同一文档的请求排队执行。
 */
export async function refreshVideoEditImageDocumentClips(projectId: string, documentId: string): Promise<number> {
  const key = `${projectId}:${documentId}`
  const previous = queues.get(key) ?? Promise.resolve()
  const run = previous.catch(() => undefined).then(() => refreshOnce(projectId, documentId))
  queues.set(key, run)
  try { return await run } finally { if (queues.get(key) === run) queues.delete(key) }
}

async function refreshOnce(projectId: string, documentId: string): Promise<number> {
  const owner = requireVideoEditInstance(projectId)
  const clips = linkedClips(owner.document, documentId)
  if (!clips.length) return 0
  const current = await workingRevision(documentId)
  if (current !== null && clips.every((clip) => clip.creativeSource.revision === current)) return 0
  const container = owner.session.documentMeta.container
  const assertOwner = (): void => { if (requireVideoEditInstance(projectId) !== owner) throw new Error('原剪辑已关闭，不再更新图片文档片段。') }
  logger.info('图片文档已更新，重新渲染剪辑里的片段', { event: 'video_edit.image_link.refresh.start', context: { projectId, documentId, clips: clips.length } })
  const prepared = await prepareVideoEditCreativeResult({ type: 'document', docRef: clips[0].creativeSource.docRef }, {
    assertTarget: assertOwner,
    place: async (path) => container.kind === 'project'
      ? (await videoEditDocumentOperations().importFile({ container, sourcePath: path, folder: 'generated' })).path
      : path,
  })
  const origin = prepared.origin
  if (origin?.type !== 'document') return 0
  let changed = 0
  await importVideoEditSources(projectId, [{ assetId: prepared.asset.id }], undefined, undefined, (document, itemIds) => {
    assertOwner()
    const item = document.items.find((candidate) => itemIds.includes(candidate.id) && candidate.kind === 'image')
    if (!item) throw new Error('图片文档的新渲染没有成为剪辑里的图片素材。')
    const previousItems = new Set(linkedClips(document, documentId).map((clip) => clip.itemId))
    const sequences = document.sequences.map((sequence) => ({
      ...sequence,
      clips: sequence.clips.map((clip) => {
        if (clip.kind !== 'image' || clip.creativeSource?.type !== 'document' || clip.creativeSource.docRef.docId !== documentId) return clip
        changed += 1
        return { ...clip, itemId: item.id, creativeSource: origin }
      }),
    }))
    const usedItems = new Set(sequences.flatMap((sequence) => sequence.clips.map((clip) => clip.itemId)))
    const items = document.items.filter((candidate) => !previousItems.has(candidate.id) || candidate.id === item.id || usedItems.has(candidate.id))
    const usedMedia = new Set(items.map((candidate) => candidate.mediaId).filter((id): id is string => Boolean(id)))
    return { ...document, sequences, items, media: document.media.filter((media) => usedMedia.has(media.id)) }
  })
  logger.info('剪辑里的图片文档片段已更新', { event: 'video_edit.image_link.refresh.completed', context: { projectId, documentId, clips: changed, revision: origin.revision } })
  return changed
}

function schedule(instance: VideoEditInstance, documentId: string): void {
  const projectId = instance.document.id
  const key = `${projectId}:${documentId}`
  clearTimeout(timers.get(key))
  timers.set(key, setTimeout(() => {
    timers.delete(key)
    void refreshVideoEditImageDocumentClips(projectId, documentId).catch((error: unknown) => {
      logger.warn('图片文档片段没能重新渲染，片段保留上一张画面', { event: 'video_edit.image_link.refresh.failed', error, context: { projectId, documentId } })
    })
  }, DEBOUNCE_MS))
}

/** 剪辑里引用的全部图片文档 ID（去重）。 */
function linkedDocumentIds(document: VideoEditDocument): string[] {
  return [...new Set(document.sequences.flatMap((sequence) => sequence.clips)
    .flatMap((clip) => clip.kind === 'image' && clip.creativeSource?.type === 'document' ? [clip.creativeSource.docRef.docId] : []))]
}

/**
 * 剪辑刚打开时核对引用的图片文档：剪辑没打开期间文档被保存过（工作副本版本比片段记录的新）就重新渲染。
 * 工作副本已回收时先在后台打开文档再核对；版本相同的不动，不让剪辑无故变脏。
 */
export async function refreshStaleVideoEditImageDocumentClips(projectId: string): Promise<number> {
  let changed = 0
  for (const documentId of linkedDocumentIds(requireVideoEditInstance(projectId).document)) {
    try {
      let current = await workingRevision(documentId)
      if (current === null) {
        await ensureImageDocumentOpenInBackground(documentId)
        current = await workingRevision(documentId)
      }
      // 文档找不到（被删、移走）：片段保留上一张画面
      if (current === null) continue
      const clips = linkedClips(requireVideoEditInstance(projectId).document, documentId)
      if (clips.every((clip) => clip.creativeSource.revision === current)) continue
      changed += await refreshVideoEditImageDocumentClips(projectId, documentId)
    } catch (error) {
      logger.warn('打开剪辑时图片文档片段没能重新渲染，片段保留上一张画面', { event: 'video_edit.image_link.open_refresh.failed', error, context: { projectId, documentId } })
    }
  }
  return changed
}

/** 应用启动时接上图片文档写回通知与剪辑打开时的核对（剪辑领域登记时调用一次）；返回取消订阅函数。 */
export function startVideoEditImageDocumentLinks(): () => void {
  const stopCommits = onImageDocumentCommitted(({ documentId }) => {
    for (const instance of listVideoEditInstances()) {
      if (linkedClips(instance.document, documentId).length) schedule(instance, documentId)
    }
  })
  // 新出现的剪辑实例（刚打开）各核对一次
  const checked = new WeakSet<VideoEditInstance>()
  const stopOpens = subscribeVideoEditDomain(() => {
    for (const instance of listVideoEditInstances()) {
      if (checked.has(instance)) continue
      checked.add(instance)
      if (!linkedDocumentIds(instance.document).length) continue
      const projectId = instance.document.id
      void refreshStaleVideoEditImageDocumentClips(projectId).catch((error: unknown) => {
        logger.warn('打开剪辑时核对图片文档片段失败', { event: 'video_edit.image_link.open_check.failed', error, context: { projectId } })
      })
    }
  })
  return () => { stopCommits(); stopOpens() }
}
