import { useSyncExternalStore } from 'react'

import type { DocumentSession } from './documentSession'
import type { DocumentSessionState } from './documentSessionTypes'

/** 页面订阅会话状态（保存中、失败、冲突、缺失素材）；会话本身由工具实例或登记表持有。 */
export function useDocumentSessionState(session: DocumentSession | null | undefined): DocumentSessionState | null {
  return useSyncExternalStore(
    (listener) => session?.subscribe(listener) ?? (() => undefined),
    () => session?.getState() ?? null,
  )
}
