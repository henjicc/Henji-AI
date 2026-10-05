import type { Viewport } from '@xyflow/react'

import { createLogger } from '@/core/logging'
import type { DocumentSession } from '@/features/documents/documentSession'
import type { CanvasHistoryState, createCanvasStore } from '@/stores/canvasStore'

import {
  canvasHistoryForSessionState,
  canvasHistoryFromSessionState,
  parseCanvasViewport,
} from './canvasDocumentContent'
import { canvasDocumentCommands } from './canvasDocumentEnvironment'

/*
 * 画布的会话状态（3.4）：撤销记录与视口不写进文档，按文档 ID 存在程序目录（通用文档会话状态）。
 *
 * - 视口：平移缩放停下后低频写入（只在位置有实际变化时），离开、释放与退出时补写一次。
 * - 撤销记录：标记它对应的文档版本（revision）。只在文档已保存（不脏）时写，打开时版本对得上才恢复——
 *   文件被别处改过、被拷贝、或上次退出时最后的修改没来得及写进撤销记录，都不会恢复出对不上的撤销步骤。
 * 会话状态只是方便，读写失败只记日志，不影响编辑与保存。
 */

const HISTORY_KEY = 'canvas.history'
const VIEWPORT_KEY = 'canvas.viewport'
const VIEWPORT_WRITE_DELAY_MS = 600
const HISTORY_WRITE_DELAY_MS = 1_500
const VIEWPORT_EPSILON = 0.001

const logger = createLogger('features.canvas.sessionState')

interface StoredHistory {
  revision: number
  history: CanvasHistoryState
}

export interface CanvasSessionInitial {
  history: CanvasHistoryState | null
  viewport: Viewport | null
}

async function readKey(docId: string, key: string): Promise<unknown> {
  try {
    return await canvasDocumentCommands().readSessionState({ docId, key })
  } catch (error) {
    logger.warn('画布会话状态读取失败，按没有处理', { event: 'canvas.session_state.read.failed', error, context: { docId, key } })
    return null
  }
}

/** 打开画布时读回撤销记录与视口；撤销记录只有版本与文档一致时才恢复。 */
export async function readCanvasSessionState(session: DocumentSession, pool: readonly string[] = []): Promise<CanvasSessionInitial> {
  const [historyValue, viewportValue] = await Promise.all([readKey(session.id, HISTORY_KEY), readKey(session.id, VIEWPORT_KEY)])
  let history: CanvasHistoryState | null = null
  if (historyValue && typeof historyValue === 'object') {
    const stored = historyValue as Partial<StoredHistory>
    if (stored.revision === session.documentMeta.revision) history = canvasHistoryFromSessionState(stored.history, pool)
  }
  return { history, viewport: parseCanvasViewport(viewportValue) }
}

function viewportChanged(left: Viewport | null, right: Viewport): boolean {
  return !left
    || Math.abs(left.x - right.x) > VIEWPORT_EPSILON
    || Math.abs(left.y - right.y) > VIEWPORT_EPSILON
    || Math.abs(left.zoom - right.zoom) > VIEWPORT_EPSILON
}

function normalizeViewport(viewport: Viewport): Viewport {
  return { x: Number(viewport.x.toFixed(2)), y: Number(viewport.y.toFixed(2)), zoom: Number(viewport.zoom.toFixed(4)) }
}

export interface CanvasSessionStatePersister {
  /** 写完待写的视口；文档已保存时把撤销记录按当前版本写进去（会话已结束时用最后的版本）。 */
  flush(): Promise<void>
  dispose(): void
}

export function createCanvasSessionStatePersister(options: {
  id: string
  store: ReturnType<typeof createCanvasStore>
  session: DocumentSession
}): CanvasSessionStatePersister {
  const { id, store, session } = options
  let viewportTimer: ReturnType<typeof setTimeout> | null = null
  let historyTimer: ReturnType<typeof setTimeout> | null = null
  let writtenViewport: Viewport | null = store.getState().currentViewport
  let writtenHistory: CanvasHistoryState | null = store.getState().history
  let writtenRevision = session.documentMeta.revision
  let disposed = false

  const write = async (key: string, value: unknown): Promise<void> => {
    try {
      await canvasDocumentCommands().writeSessionState({ docId: id, key, value })
    } catch (error) {
      logger.warn('画布会话状态写入失败', { event: 'canvas.session_state.write.failed', error, context: { docId: id, key } })
    }
  }

  const writeViewport = async (): Promise<void> => {
    if (viewportTimer) clearTimeout(viewportTimer)
    viewportTimer = null
    const viewport = normalizeViewport(store.getState().currentViewport)
    if (!viewportChanged(writtenViewport, viewport)) return
    writtenViewport = viewport
    await write(VIEWPORT_KEY, viewport)
  }

  /** 只在文档不脏时写（撤销记录要和文件里的版本对应）。 */
  const writeHistory = async (): Promise<void> => {
    if (historyTimer) clearTimeout(historyTimer)
    historyTimer = null
    if (session.dirty) return
    const history = store.getState().history
    const revision = session.documentMeta.revision
    if (history === writtenHistory && revision === writtenRevision) return
    writtenHistory = history
    writtenRevision = revision
    await write(HISTORY_KEY, { revision, history: canvasHistoryForSessionState(history) } satisfies StoredHistory)
  }

  const scheduleViewport = (): void => {
    if (disposed) return
    if (viewportTimer) clearTimeout(viewportTimer)
    viewportTimer = setTimeout(() => { void writeViewport() }, VIEWPORT_WRITE_DELAY_MS)
  }
  const scheduleHistory = (): void => {
    if (disposed || session.dirty) return
    if (historyTimer) clearTimeout(historyTimer)
    historyTimer = setTimeout(() => { void writeHistory() }, HISTORY_WRITE_DELAY_MS)
  }

  const unsubscribeStore = store.subscribe((state, previous) => {
    if (state.currentViewport !== previous.currentViewport && viewportChanged(writtenViewport, state.currentViewport)) scheduleViewport()
  })
  // 每次保存确认后（状态回到“已保存”）再记撤销记录，版本号就是刚写进文件的那个。
  const unsubscribeSession = session.subscribe(() => {
    const state = session.getState()
    if (state.status === 'saved' && !state.dirty) scheduleHistory()
  })

  return {
    async flush() {
      if (viewportTimer || viewportChanged(writtenViewport, store.getState().currentViewport)) await writeViewport()
      if (!session.isEnded) await session.flush().catch(() => undefined)
      await writeHistory()
    },
    dispose() {
      disposed = true
      unsubscribeStore()
      unsubscribeSession()
      if (viewportTimer) clearTimeout(viewportTimer)
      if (historyTimer) clearTimeout(historyTimer)
      viewportTimer = null
      historyTimer = null
    },
  }
}
