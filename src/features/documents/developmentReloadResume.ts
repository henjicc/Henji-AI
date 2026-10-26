import { createLogger } from '@/core/logging'
import { isStartupWorkspaceId } from '@/core/types/workspace'
import { useNavigationStore } from '@/stores/navigationStore'
import { currentDocumentContext } from './currentDocumentContext'
import { getDocumentOperations } from './documentOperations'

const logger = createLogger('features.documents.dev_reload_resume')
const STORAGE_KEY = 'henji.development.reloadResume'
const OPEN_ATTEMPTS = 40
const OPEN_RETRY_MS = 250

interface ReloadResumeState { workspace: string; documentId: string | null }

/**
 * 开发运行改到业务模块时，开发服务器会整页重新加载（不原地替换，免得新旧两份服务各持一份状态）。
 * 重新加载前记下所在工作区和正在看的文档，加载后切回工作区、重新打开那份文档，人不用从工程列表重新找。
 * 只听开发服务器发起的重新加载；用户手动刷新、正式版都不走这里。
 */
export function installDevelopmentReloadResume(): void {
  const hot = import.meta.hot
  if (!hot) return
  let saved: ReloadResumeState | null = null
  try {
    saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? 'null') as ReloadResumeState | null
    sessionStorage.removeItem(STORAGE_KEY)
  } catch { saved = null }
  // 连着改几个文件会连着重新加载：上一次的恢复还没做完时，留着原来记下的，不拿半途的空状态覆盖
  let resuming = saved
  hot.on('vite:beforeFullReload', () => {
    const state: ReloadResumeState = resuming ?? { workspace: useNavigationStore.getState().activeWorkspace, documentId: currentDocumentContext().documentId ?? null }
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state)) } catch { /* 存不下就不恢复，不影响重新加载 */ }
  })
  if (!saved) return
  if (isStartupWorkspaceId(saved.workspace) && saved.workspace !== 'assets') useNavigationStore.getState().setActiveWorkspace(saved.workspace)
  if (saved.documentId) void reopen(saved.documentId).finally(() => { resuming = null })
  else resuming = null
}

// 工作区是懒加载的，打开方式在它载入后才登记（此前打开会被写入预检拒绝）：稍后再试，文档已不存在时不再试
async function reopen(documentId: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const operations = getDocumentOperations()
      await operations.openDocument(await operations.findDocument(documentId))
      return
    } catch (error) {
      if (attempt >= OPEN_ATTEMPTS || (error instanceof Error && error.name === 'DocumentNotFoundError')) {
        logger.warn('开发运行重新加载后未能重新打开文档', { event: 'documents.dev_reload_resume.failed', context: { documentId, attempt }, error: String(error) })
        return
      }
      await new Promise(resolve => setTimeout(resolve, OPEN_RETRY_MS))
    }
  }
}
