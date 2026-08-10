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
 * 会话文档没有专属的自增修订号（imageEditSessionStore 只按 sessionId 分片，不额外维护
 * revision 字段）——内容哈希已经足够表达"变没变"，与 generationReflection.ts 的
 * taskRevision() 是同一个先例，不为此单独往 6.1 的 store 里加字段。
 */
export function documentRevision(document: ImageEditDocument): number {
  const seed = JSON.stringify(document)
  return [...seed].reduce((total, character) => (total * 33 + character.charCodeAt(0)) >>> 0, 5381)
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
