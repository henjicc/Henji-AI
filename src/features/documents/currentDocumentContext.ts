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

const embeddedEditors = new Map<string, CurrentDocumentProvider>()

/**
 * 嵌在另一份文档里的编辑器（如画布节点里的镜头参考全屏编辑器）正在前台编辑的文档。
 * 只参与“正在编辑”判断，不参与当前文档：当前文档仍是外面那份（画布），默认值与记忆跟着它走。
 */
export function registerEmbeddedDocumentEditor(name: string, provider: CurrentDocumentProvider): () => void {
  embeddedEditors.set(name, provider)
  return () => { if (embeddedEditors.get(name) === provider) embeddedEditors.delete(name) }
}

/**
 * 这份文档此刻是否在前台编辑（它所在的工作区、工具页或嵌入编辑器正显示着它）。
 * 编辑器切走后仍留在工具状态里的文档不算：用户看不到它，助手也没有页面可以关。
 */
export function isForegroundDocument(documentId: string): boolean {
  const host = useNavigationStore.getState()
  return [...providers.values(), ...embeddedEditors.values()].some(provider => provider(host) === documentId)
}

/** 后台打开的其他文档不参与默认值与记忆。 */
export function currentDocumentContext(): { documentId?: string; projectId?: string } {
  const host = useNavigationStore.getState()
  const ids = [...providers.values()].map(provider => provider(host)).filter((id): id is string => Boolean(id))
  const documentId = ids.length === 1 ? ids[0] : undefined
  const container = documentId ? getDocumentSessionRegistry().get(documentId)?.documentMeta.container : undefined
  return { documentId, ...(container?.kind === 'project' ? { projectId: container.projectId } : {}) }
}
