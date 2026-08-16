import type {
  ApplicationCollectionExecutor,
  ApplicationCompletedStepResult,
  ApplicationEvidence,
  ApplicationPlannedStep,
} from '@/core/application-control'
import { createLogger } from '@/core/logging'
import {
  createMarkId,
  imageEditDocumentToMarkDoc,
  replaceMarkDocInImageEditDocument,
  sanitizeMarkItem,
  type ImageEditDocument,
} from '@/core/imageEdit'
import { useImageEditSessionStore } from '@/features/imageEdit/store/imageEditSessionStore'

import { IMAGE_MARK_ENTITY_TYPES } from './imageMarkFields'
import { annotationRef, documentRevision, requireSessionDocument, splitAnnotationRef } from './imageMarkSessionAccess'

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>

const logger = createLogger('features.imageMark.annotation_collection')

const UNDO_PREFIX = 'image-mark-annotation-collection-undo:'

interface UndoPayload {
  sessionId: string
  previousDocument: ImageEditDocument
}

function property(properties: Record<string, unknown>, suffix: string): unknown {
  return properties[`${IMAGE_MARK_ENTITY_TYPES.annotation}.${suffix}`]
}

/**
 * image_mark.annotation 集合写入执行器（6.2）：此前 imageMark 是全域失明领域——助手连
 * "打开编辑器之后画一笔"都做不到。创建/删除都落在同一条 commitDocument 原语上，校验
 * 复用既有的 sanitizeMarkItem（@/core/imageEdit/markCodec.ts），不新写一套逐字段校验。
 */
export class ImageMarkAnnotationCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = IMAGE_MARK_ENTITY_TYPES.annotation
  readonly effectContract = { direct: [], cascades: [] }

  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    const sessionId = step.parent.id
    const previousDocument = requireSessionDocument(sessionId)
    const markDoc = imageEditDocumentToMarkDoc(previousDocument)

    if (step.operation.kind === 'create') {
      const created = step.operation.items.map((item) => {
        const type = property(item.properties, 'type')
        const data = property(item.properties, 'data')
        if (typeof type !== 'string') throw new Error('INVALID_INPUT：创建标注必须提供 type。')
        if (typeof data !== 'object' || data === null || Array.isArray(data)) {
          throw new Error('INVALID_INPUT：创建标注必须提供 data 对象。')
        }
        const sanitized = sanitizeMarkItem({ ...data, id: createMarkId(), type })
        if (!sanitized) throw new Error(`INVALID_INPUT：type=${type} 与 data 不匹配或缺少必填字段。`)
        return sanitized
      })
      const nextDocument = replaceMarkDocInImageEditDocument(previousDocument, {
        ...markDoc,
        items: [...markDoc.items, ...created],
      })
      useImageEditSessionStore.getState().commitDocument(sessionId, nextDocument)
      return this.completed(sessionId, previousDocument, nextDocument, created.map((item) => annotationRef(sessionId, item)), `已新建 ${created.length} 条标注。`)
    }

    const targetIds = step.operation.targets.map((target) => splitAnnotationRef(target))
    for (const target of targetIds) {
      if (target.sessionId !== sessionId) throw new Error('NOT_FOUND：标注不属于该会话。')
    }
    const removeIds = new Set(targetIds.map((target) => target.annotationId))
    const nextItems = markDoc.items.filter((item) => !removeIds.has(item.id))
    if (nextItems.length === markDoc.items.length) throw new Error('NOT_FOUND：目标标注不存在。')
    const nextDocument = replaceMarkDocInImageEditDocument(previousDocument, { ...markDoc, items: nextItems })
    useImageEditSessionStore.getState().commitDocument(sessionId, nextDocument)
    return this.completed(sessionId, previousDocument, nextDocument, step.operation.targets, `已删除 ${markDoc.items.length - nextItems.length} 条标注。`)
  }

  async compensate(_step: CollectionStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    if (!result.undoToken) return []
    return (await this.undo(result.undoToken)).evidence
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    if (!undoToken.startsWith(UNDO_PREFIX)) throw new Error('IMAGE_MARK_ANNOTATION_COLLECTION_UNDO_INVALID')
    const { sessionId, previousDocument } = JSON.parse(undoToken.slice(UNDO_PREFIX.length)) as UndoPayload
    useImageEditSessionStore.getState().commitDocument(sessionId, previousDocument)
    const revision = documentRevision(previousDocument)
    return {
      status: 'completed',
      resultingRevisions: { image_mark: revision },
      directRefs: [],
      evidence: [{
        kind: 'entity_state',
        target: { kind: IMAGE_MARK_ENTITY_TYPES.document, id: sessionId, revision },
        fact: '标注集合写入已撤销。',
        capturedAt: new Date().toISOString(),
      }],
    }
  }

  private completed(
    sessionId: string,
    previousDocument: ImageEditDocument,
    nextDocument: ImageEditDocument,
    refs: Array<{ kind: string; id: string }>,
    fact: string,
  ): ApplicationCompletedStepResult {
    const revision = documentRevision(nextDocument)
    logger.info('标注集合写入完成', { event: 'image_mark.annotation_collection.apply.completed', sessionId, fact })
    return {
      status: 'completed',
      resultingRevisions: { image_mark: revision },
      directRefs: refs.map((ref) => ({ ...ref, revision })).slice(0, 64),
      evidence: [{
        kind: 'operation_result',
        target: { kind: IMAGE_MARK_ENTITY_TYPES.document, id: sessionId, revision },
        fact,
        capturedAt: new Date().toISOString(),
      }],
      undoToken: `${UNDO_PREFIX}${JSON.stringify({ sessionId, previousDocument } satisfies UndoPayload)}`,
    }
  }
}
