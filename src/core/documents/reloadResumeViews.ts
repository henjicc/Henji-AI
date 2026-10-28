import type { DocumentKindId } from './types'

/*
 * 页面重新加载后回到原位时，各工具自己的文档内视图（剪辑的序列与播放头）怎么记、怎么切回。
 * 工具在这里登记，文档底座的重载恢复（features/documents/rendererReloadResume）在这里取用，
 * 两边都只依赖这份契约，不互相导入实现。
 */

export interface ReloadResumeView {
  /** 此刻打开着的这类文档各自的视图，按文档 ID。 */
  capture(): Record<string, unknown>
  /** 文档重新打开后调用；记下的内容对不上当前文档（序列已删）时跳过对不上的部分。 */
  restore(documentId: string, view: unknown): void
}

const views = new Map<DocumentKindId, ReloadResumeView>()

export function registerReloadResumeView(kind: DocumentKindId, view: ReloadResumeView): () => void {
  views.set(kind, view)
  return () => { if (views.get(kind) === view) views.delete(kind) }
}

export function reloadResumeView(kind: DocumentKindId): ReloadResumeView | undefined {
  return views.get(kind)
}

export function listReloadResumeViews(): ReloadResumeView[] {
  return [...views.values()]
}
