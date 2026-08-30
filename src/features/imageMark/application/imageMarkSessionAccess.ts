import type { ApplicationRef } from '@/core/application-control'
import type { ImageEditDocument, MarkItem } from '@/core/imageEdit'
import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore'

import { IMAGE_MARK_ENTITY_TYPES } from './imageMarkFields'

/*
 * 反射 provider 与三个执行器（文档写入、标注写入、标注集合写入）都要按同一套规则从
 * sessionId 找到会话文档、拼/拆标注引用、算修订号——收在这一处，避免四个文件各写一份
 * 拆分/校验逻辑，其中任何一处改了拼接格式而另一处没跟上。
 */

export function requireSessionDocument(sessionId: string): ImageEditDocument {
  const session = useImageEditSessionStore.getState().sessions[sessionId]
  if (!session) throw new Error('NOT_FOUND')
  return session.document
}

/**
 * image_mark 的领域级乐观并发基线。
 *
 * 宿主 expected-revision 信封按领域发布，不能携带每个 session 各自的内容哈希；provider、
 * 执行器和宿主必须共同读取会话 store 里的这一个权威计数，避免形成第二份 revision 镜像。
 */
export function imageMarkRevision(): number {
  return useImageEditSessionStore.getState().revision
}

/** 标注稳定引用形如 `sessionId:annotationId`——与 camera_stage 的 `projectId:shotId` 同一惯例。 */
export function annotationRef(sessionId: string, item: MarkItem): ApplicationRef {
  return { kind: IMAGE_MARK_ENTITY_TYPES.annotation, id: `${sessionId}:${item.id}` }
}

export function splitAnnotationRef(ref: ApplicationRef): { sessionId: string; annotationId: string } {
  const separator = ref.id.indexOf(':')
  if (separator < 1) throw new Error(`INVALID_INPUT：«${ref.id}» 不是合法标注引用，应为 会话:标注。`)
  return { sessionId: ref.id.slice(0, separator), annotationId: ref.id.slice(separator + 1) }
}
