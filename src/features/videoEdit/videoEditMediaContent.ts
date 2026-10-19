import { audibleVideoEditClips, videoEditClipMedia, videoEditNestedComposition, type VideoEditClip, type VideoEditComposition, type VideoEditMedia } from '@/core/videoEdit/document'
import { codeMaterialMediaIds } from '@/core/videoEdit/codeMaterialResources'
import { getPlatform } from '@/platform/runtime'

export function videoEditMediaContentKey(media: VideoEditMedia): string {
  return JSON.stringify([media.id, media.path, media.sourceRevision, media.assetContent])
}
export async function verifyVideoEditMediaContent(media: VideoEditMedia, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const expected = media.assetContent
  if (!expected?.contentIdentity) return
  try {
    const operation = getPlatform().assetLibrary.inspectFileContent(media.path, media.kind)
    let abort: (() => void) | undefined
    const current = await (signal ? Promise.race([operation, new Promise<never>((_resolve, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
    })]).finally(() => { if (abort) signal.removeEventListener('abort', abort) }) : operation)
    signal?.throwIfAborted()
    if (current.contentIdentity !== expected.contentIdentity || current.sizeBytes !== expected.sizeBytes || current.fileModifiedAt !== expected.fileModifiedAt) throw new Error('源文件内容已改变')
  } catch (error) {
    signal?.throwIfAborted()
    throw new Error(`素材“${media.name}”的源文件已改变或丢失，请重新定位源素材。`, { cause: error })
  }
}

/** Text decisions verify the actual sound files, including a nested sequence's master audio.
 * The caller checks its document snapshot again after this asynchronous boundary. */
async function verifyClipSources(composition: VideoEditComposition, clips: readonly VideoEditClip[], soundOnly: boolean, signal?: AbortSignal): Promise<void> {
  const sources = new Map<string, VideoEditMedia>()
  const visited = new Set<string>()
  const collect = (value: VideoEditComposition, selected?: ReadonlySet<string>): void => {
    if (!selected && visited.has(value.id)) return
    if (!selected) visited.add(value.id)
    const mediaById = new Map(value.media.map(media => [media.id, media]))
    for (const clip of soundOnly ? audibleVideoEditClips(value) : value.clips) {
      if (selected && !selected.has(clip.id) || soundOnly && clip.sourceComponent === 'video') continue
      const nested = videoEditNestedComposition(value, clip)
      if (nested) collect(nested)
      else {
        const media = videoEditClipMedia(value, clip)
        if (media && (!soundOnly || media.kind !== 'image')) sources.set(media.id, media)
      }
      if (!soundOnly) for (const id of [clip.code, ...(clip.effects ?? []).map(effect => effect.code)].flatMap(code => [...codeMaterialMediaIds(code)])) {
        const media = mediaById.get(id)
        if (media) sources.set(media.id, media)
      }
    }
  }
  collect(composition, new Set(clips.map(clip => clip.id)))
  for (const media of sources.values()) {
    signal?.throwIfAborted()
    if (!media.assetContent?.contentIdentity) throw new Error(`素材“${media.name}”尚未绑定原文件身份，请先重新定位源素材再使用来源内容。`)
    await verifyVideoEditMediaContent(media, signal)
  }
  signal?.throwIfAborted()
}

export async function verifyVideoEditSpeechMediaContent(composition: VideoEditComposition, clips: readonly VideoEditClip[], signal?: AbortSignal): Promise<void> {
  return verifyClipSources(composition, clips, true, signal)
}

/** Content ranges may refer to visual-only or muted sources as well as speech. */
export async function verifyVideoEditClipMediaContent(composition: VideoEditComposition, clips: readonly VideoEditClip[], signal?: AbortSignal): Promise<void> {
  return verifyClipSources(composition, clips, false, signal)
}

/** Checks belong to one display/export session, never to a global file cache. */
export class VideoEditMediaContentVerifier {
  private readonly checks = new Map<string, Promise<void>>()
  private disposed = false
  private readonly controller = new AbortController()
  async check(document: VideoEditComposition, clips: readonly VideoEditClip[] = document.clips): Promise<void> {
    if (this.disposed) throw new Error('素材检查会话已关闭。')
    const ids = new Set(clips.flatMap(clip => [videoEditClipMedia(document, clip)?.id, ...codeMaterialMediaIds(clip.code), ...(clip.effects ?? []).flatMap(effect => [...codeMaterialMediaIds(effect.code)])]))
    const media = document.media.filter(media => ids.has(media.id) && media.assetContent?.contentIdentity)
    const keys = new Set(media.map(videoEditMediaContentKey))
    for (const key of this.checks.keys()) if (!keys.has(key)) this.checks.delete(key)
    // Small fixed batches bound native stat work even for a large referenced bin.
    for (let index = 0; index < media.length; index += 2) {
      if (this.disposed) throw new Error('素材检查会话已关闭。')
      await Promise.all(media.slice(index, index + 2).map(source => {
        const key = videoEditMediaContentKey(source)
        let check = this.checks.get(key)
        if (!check) {
          check = verifyVideoEditMediaContent(source, this.controller.signal)
          this.checks.set(key, check)
          const owned = check
          void check.catch(() => { if (this.checks.get(key) === owned) this.checks.delete(key) })
        }
        return check
      }))
      if (this.disposed) throw new Error('素材检查会话已关闭。')
    }
    if (this.disposed) throw new Error('素材检查会话已关闭。')
  }
  dispose(): void { this.disposed = true; this.controller.abort(new Error('素材检查会话已关闭。')); this.checks.clear() }
}
