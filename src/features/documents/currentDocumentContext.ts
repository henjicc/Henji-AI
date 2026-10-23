import { useNavigationStore } from '@/stores/navigationStore'
import { getDocumentSessionRegistry } from './documentSessionRegistry'

type DocumentHost = Pick<ReturnType<typeof useNavigationStore.getState>, 'activeWorkspace' | 'activeToolId'>
type CurrentDocumentProvider = (host: DocumentHost) => string | undefined
const providers = new Map<string, CurrentDocumentProvider>()

/** 工作区拥有当前文档的判断；文档底座只负责组合上下文，不导入编辑器实现。 */
export function registerCurrentDocumentProvider(workspace: string, provider: CurrentDocumentProvider): () => void {
  providers.set(workspace, provider)
  return () => { if (providers.get(workspace) === provider) providers.delete(workspace) }
}

/** 后台打开的其他文档不参与默认值与记忆。 */
export function currentDocumentContext(): { documentId?: string; projectId?: string } {
  const host = useNavigationStore.getState()
  const ids = [...providers.values()].map(provider => provider(host)).filter((id): id is string => Boolean(id))
  const documentId = ids.length === 1 ? ids[0] : undefined
  const container = documentId ? getDocumentSessionRegistry().get(documentId)?.documentMeta.container : undefined
  return { documentId, ...(container?.kind === 'project' ? { projectId: container.projectId } : {}) }
}
