import { useEffect, useSyncExternalStore } from 'react'
import { getPlatform } from '@/platform/runtime'
import { emptyEmbeddedAgentSnapshot, type EmbeddedAgentSnapshot } from '@/core/assistant/embeddedAgent'
import { isUserCancellation } from '@/services/paidApproval'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.assistant.embedded')
let snapshot = emptyEmbeddedAgentSnapshot()
const listeners = new Set<() => void>()
let disconnect: (() => void) | undefined
function publish(value: EmbeddedAgentSnapshot): void { snapshot = value; listeners.forEach((listener) => listener()) }
export function reportEmbeddedAgentError(error: unknown): void {
  // 付费确认里点了取消：草稿已退回输入框，不是失败，不记错误、不显示报错
  if (isUserCancellation(error)) {
    logger.info('助手操作已取消', { event: 'embedded_agent.ui.cancelled' })
    return
  }
  logger.error('助手操作失败', error, { event: 'embedded_agent.ui.failed' })
  publish({ ...snapshot, error: error instanceof Error ? error.message : '操作失败，请重试。' })
}
function subscribe(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener) } }
export function useEmbeddedAgent(): EmbeddedAgentSnapshot {
  const state = useSyncExternalStore(subscribe, () => snapshot)
  useEffect(() => {
    if (!disconnect) {
      let received = false
      disconnect = getPlatform().embeddedAgent.onSnapshot((value) => { received = true; publish(value) })
      void getPlatform().embeddedAgent.snapshot().then((value) => { if (!received) publish(value) }, reportEmbeddedAgentError)
    }
  }, [])
  return state
}
export async function newEmbeddedConversation(): Promise<void> {
  try { await getPlatform().embeddedAgent.newSession() } catch (error) { reportEmbeddedAgentError(error) }
}
