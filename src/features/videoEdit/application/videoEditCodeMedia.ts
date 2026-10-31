import type { CodeMediaDependency } from '@/core/videoEdit/codeMediaDependency'
import type { VideoEditDocument, VideoEditMedia } from '@/core/videoEdit/document'
import { getPlatform } from '@/platform/runtime'
import { verifyVideoEditMediaContent } from '../videoEditMediaContent'
import { inspectVideoEditMedia, sameVideoEditMediaPath } from './videoEditMedia'
import { jsonEqual } from '@/core/jsonEqual'

export async function verifyVideoEditCodeMedia(dependency: CodeMediaDependency, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted()
  const actual = await getPlatform().assetLibrary.inspectFileContent(dependency.path, dependency.kind)
  signal?.throwIfAborted()
  if (!jsonEqual(actual, dependency.content)) throw new Error('代码素材引用的原媒体已改变，请恢复原媒体后重新导入。')
}
export async function snapshotVideoEditCodeMedia(document: VideoEditDocument, ids: Iterable<string>, signal?: AbortSignal): Promise<CodeMediaDependency[]> {
  const dependencies: CodeMediaDependency[] = []
  for (const id of new Set(ids)) {
    const media = document.media.find(media => media.id === id)
    if (!media) throw new Error('代码素材的媒体引用已失效，请恢复原媒体。')
    await verifyVideoEditMediaContent(media, signal)
    const content = await getPlatform().assetLibrary.inspectFileContent(media.path, media.kind)
    signal?.throwIfAborted()
    dependencies.push({ id, kind: media.kind, path: media.path, content, ...(media.assetId ? { assetId: media.assetId } : {}) })
  }
  return dependencies
}
/** 代码资产与风格件共用媒体身份核验；候选内容不写入正式文档。 */
export async function prepareVideoEditCodeMedia(document: VideoEditDocument, dependencies: readonly CodeMediaDependency[], signal?: AbortSignal): Promise<{ media: VideoEditMedia[]; mediaIds: Map<string, string> }> {
  const media: VideoEditMedia[] = [], mediaIds = new Map<string, string>()
  for (const dependency of dependencies) {
    // 内容身份核验必须先于媒体检查，后者可能授权媒体路径。
    await verifyVideoEditCodeMedia(dependency, signal)
    let inspected = document.media.find(media => sameVideoEditMediaPath(media.path, dependency.path)) ?? media.find(media => sameVideoEditMediaPath(media.path, dependency.path))
    if (inspected?.assetContent?.contentIdentity) await verifyVideoEditMediaContent(inspected, signal)
    else if (inspected) {
      const current = await inspectVideoEditMedia(dependency.path, signal)
      if (current.kind !== inspected.kind || current.width !== inspected.width || current.height !== inspected.height) throw new Error('原剪辑中的媒体信息已改变，请先重新定位源素材。')
      inspected = { ...current, id: inspected.id, name: inspected.name, ...(inspected.assetId ? { assetId: inspected.assetId } : {}), sourceRevision: crypto.randomUUID() }
    } else inspected = await inspectVideoEditMedia(dependency.path, signal)
    if (inspected.kind !== dependency.kind) throw new Error('代码素材媒体依赖与声明种类不符。')
    await verifyVideoEditCodeMedia(dependency, signal)
    const fixed = { ...inspected, path: dependency.path, assetContent: { ...dependency.content }, sourceRevision: inspected.sourceRevision ?? crypto.randomUUID() }
    if (!media.some(media => media.id === fixed.id)) media.push(fixed)
    mediaIds.set(dependency.id, fixed.id)
  }
  return { media, mediaIds }
}
