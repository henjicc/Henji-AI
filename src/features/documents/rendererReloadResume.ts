import { createLogger } from '@/core/logging'
import { isSafeRendererRecovery } from '@/core/applicationLifecycle/rendererRecovery'
import type { DocumentKindId } from '@/core/documents/types'
import { isStartupWorkspaceId } from '@/core/types/workspace'
import { useNavigationStore } from '@/stores/navigationStore'
import { currentDocumentContext } from './currentDocumentContext'
import { getDocumentOperations } from './documentOperations'
import { getDocumentSessionRegistry } from './documentSessionRegistry'

/*
 * 渲染层重新加载（开发运行改到业务模块、崩溃后自动重载、手动刷新）后回到原来的地方：
 * 所在工作区、各工作区打开着的文档、焦点文档，以及工具登记的文档内视图（剪辑的序列与播放头）。
 *
 * 记在 sessionStorage：它跟着窗口走，重新加载和渲染进程崩溃后重载都还在，关掉窗口、重启软件就没了，
 * 正好只覆盖“同一个窗口里页面重来了一遍”。崩溃后的安全恢复不回去：正是原来的文档可能把界面弄崩。
 */

const logger = createLogger('features.documents.reload_resume')
const STORAGE_KEY = 'henji.rendererReloadResume'
// 崩溃时来不及在卸载前补写，最多丢这么久的变化（播放头差半秒以内）
const RECORD_INTERVAL_MS = 500

interface ReloadResumeState {
  workspace: string
  /** 工作区 → 在那里打开着的文档。 */
  documents: Record<string, string>
  focusedDocumentId: string | null
  /** 文档 ID → 工具自己的视图记录。 */
  views: Record<string, unknown>
}

/** 工具登记的文档内视图：重新加载前记下、文档重新打开后切回。 */
export interface ReloadResumeView {
  /** 此刻打开着的这类文档各自的视图，按文档 ID。 */
  capture(): Record<string, unknown>
  /** 文档重新打开后调用；记下的内容对不上当前文档（序列已删）时跳过对不上的部分。 */
  restore(documentId: string, view: unknown): void
}

const viewHandlers = new Map<DocumentKindId, ReloadResumeView>()

export function registerReloadResumeView(kind: DocumentKindId, handler: ReloadResumeView): () => void {
  viewHandlers.set(kind, handler)
  return () => { if (viewHandlers.get(kind) === handler) viewHandlers.delete(kind) }
}

function readSaved(): ReloadResumeState | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<ReloadResumeState> | null
    if (!value || typeof value.workspace !== 'string' || !value.documents || typeof value.documents !== 'object') return null
    return { workspace: value.workspace, documents: value.documents, focusedDocumentId: typeof value.focusedDocumentId === 'string' ? value.focusedDocumentId : null, views: value.views && typeof value.views === 'object' ? value.views : {} }
  } catch { return null }
}

function capture(documents: Record<string, string>): ReloadResumeState {
  const workspace = useNavigationStore.getState().activeWorkspace
  const focusedDocumentId = currentDocumentContext().documentId ?? null
  if (focusedDocumentId) documents[workspace] = focusedDocumentId
  const registry = getDocumentSessionRegistry()
  for (const [key, id] of Object.entries(documents)) if (!registry.get(id)) delete documents[key]
  const open = new Set(Object.values(documents))
  const views: Record<string, unknown> = {}
  for (const handler of viewHandlers.values()) for (const [id, view] of Object.entries(handler.capture())) if (open.has(id)) views[id] = view
  return { workspace, documents: { ...documents }, focusedDocumentId, views }
}

/** 主窗口启动时调用一次：先恢复上次记下的位置，恢复做完后开始持续记录。 */
export function installRendererReloadResume(): void {
  const saved = readSaved()
  const documents: Record<string, string> = { ...saved?.documents }
  // 恢复做完之前不记：此时文档还没打开，记下来会把要恢复的位置盖掉；恢复途中再次重新加载时照样回到原处
  let recording = false
  let written = ''
  const record = (): void => {
    if (!recording) return
    const text = JSON.stringify(capture(documents))
    if (text === written) return
    try { sessionStorage.setItem(STORAGE_KEY, text); written = text } catch { /* 存不下就不恢复，不影响使用 */ }
  }
  window.setInterval(record, RECORD_INTERVAL_MS)
  window.addEventListener('pagehide', record)
  if (!saved) { recording = true; return }
  if (isSafeRendererRecovery()) {
    logger.info('安全恢复启动，不回到重新加载前的文档', { event: 'documents.reload_resume.skipped', context: { reason: 'safe_recovery' } })
    for (const key of Object.keys(documents)) delete documents[key]
    recording = true
    return
  }
  void resume(saved).finally(() => { recording = true })
}

/** 用户此刻所在的位置；恢复途中它变了（不是恢复自己改的），说明用户已经开始操作。 */
interface Position { navigation: string; documentId: string | null }
function position(): Position {
  const { activeWorkspace, activeToolId } = useNavigationStore.getState()
  return { navigation: `${activeWorkspace}/${activeToolId ?? ''}`, documentId: currentDocumentContext().documentId ?? null }
}

class UserTookOver extends Error {}
class OpenerTimeout extends Error {}

async function resume(saved: ReloadResumeState): Promise<void> {
  const workspace = isStartupWorkspaceId(saved.workspace) && saved.workspace !== 'assets' ? saved.workspace : null
  if (workspace) useNavigationStore.getState().setActiveWorkspace(workspace)
  const focused = saved.focusedDocumentId
  // 焦点文档最后打开：每份文档打开时都会切到自己的工作区，最后停在焦点文档上
  const ids = [...new Set(Object.values(saved.documents).filter(id => id !== focused)), ...(focused ? [focused] : [])]
  let expected = position()
  // 恢复要等工作区载入、文档打开，期间界面已经能点：用户换了地方就不再把他拉回去。
  // 工作区载入后自己显示出记下的文档（如画布记着当前工程）不算用户操作。
  const moved = (): boolean => {
    const now = position()
    return now.navigation !== expected.navigation || (now.documentId !== expected.documentId && !(now.documentId && ids.includes(now.documentId)))
  }
  const settle = async <T>(work: Promise<T>): Promise<T> => {
    const value = await work
    if (moved()) throw new UserTookOver()
    return value
  }
  const operations = getDocumentOperations()
  let reopened = 0
  try {
    for (const documentId of ids) {
      try {
        const document = await settle(operations.findDocument(documentId))
        await settle(openableWithin(document.kind))
        await operations.openDocument(document)
        // 打开方式自己会切到文档所在的工作区，此后的位置算恢复做的
        expected = position()
        const view = saved.views[documentId]
        if (view !== undefined) viewHandlers.get(document.kind)?.restore(documentId, view)
        reopened++
      } catch (error) {
        if (error instanceof UserTookOver || error instanceof OpenerTimeout) throw error
        logger.warn('重新加载后未能回到原来的文档', { event: 'documents.reload_resume.failed', context: { documentId }, error: String(error) })
      }
    }
  } catch (error) {
    if (error instanceof UserTookOver) {
      logger.info('用户已开始操作，不再回到重新加载前的位置', { event: 'documents.reload_resume.skipped', context: { reason: 'user_took_over', reopened } })
      return
    }
    logger.warn('应用宿主迟迟没有载入，未能回到重新加载前的文档', { event: 'documents.reload_resume.failed', context: { reason: 'opener_timeout', reopened } })
    return
  }
  if (!focused && workspace && !moved()) useNavigationStore.getState().setActiveWorkspace(workspace)
  logger.info('重新加载后已回到原来的位置', { event: 'documents.reload_resume.completed', context: { workspace: saved.workspace, documents: ids.length, reopened, focusedDocumentId: focused } })
}

// 打开方式随应用宿主一起登记；宿主载入失败时不会再登记，等到上限就放弃，照常开始记录
const OPENER_WAIT_MS = 30_000
async function openableWithin(kind: DocumentKindId): Promise<void> {
  let timer: number | undefined
  try {
    await Promise.race([
      getDocumentOperations().whenOpenable(kind),
      new Promise<never>((_, reject) => { timer = window.setTimeout(() => reject(new OpenerTimeout()), OPENER_WAIT_MS) }),
    ])
  } finally { window.clearTimeout(timer) }
}
