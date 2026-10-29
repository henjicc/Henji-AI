import type { ApplicationDomainModule } from '@/features/application-control/domainModule'

import { DOCUMENTS_ENTITY_TYPES } from './documentsFields'
import { DocumentsMutationExecutor } from './documentsMutationExecutor'
import { createDocumentsReflectionRegistrations } from './documentsReflection'
import { registerDocumentsCapabilityHandlers } from './registerDocumentsCapabilityHandlers'
import { getDocumentOperations } from '../documentOperations'
import { RecyclableCollectionExecutor, captureRecycledRemoval } from '@/features/application-control'

/**
 * 通用文档与项目领域（存储底座 2.5）：文档 / 项目实体（名称可写）+ 列出、新建、打开、移动、副本、回收站、新建项目能力。
 * 全部委托 `getDocumentOperations()`，与项目页右键同一个领域服务。
 */
export const documentsApplicationDomain: ApplicationDomainModule = {
  id: 'documents',
  entities: () => createDocumentsReflectionRegistrations(),
  registerExecutors(engine) {
    engine.registerMutationExecutor(new DocumentsMutationExecutor(DOCUMENTS_ENTITY_TYPES.document))
    engine.registerMutationExecutor(new DocumentsMutationExecutor(DOCUMENTS_ENTITY_TYPES.project))
    for (const entityType of Object.values(DOCUMENTS_ENTITY_TYPES)) engine.registerCollectionExecutor(new RecyclableCollectionExecutor(entityType, {
      read: ref => entityType === DOCUMENTS_ENTITY_TYPES.document ? getDocumentOperations().findDocument(ref.id) : getDocumentOperations().findProject(ref.id),
      remove: async ref => {
        const operations = getDocumentOperations()
        if (entityType === DOCUMENTS_ENTITY_TYPES.document) {
          const document = await operations.findDocument(ref.id)
          return captureRecycledRemoval(() => operations.trashDocument(document), item => item.path === document.path)
        }
        const project = await operations.findProject(ref.id)
        return captureRecycledRemoval(() => operations.trashProject(project), item => item.path === project.path)
      },
      revisions: () => ({ documents: getDocumentOperations().revision() }),
    }))
  },
  registerCapabilities: (registrar) => registerDocumentsCapabilityHandlers(registrar),
}
