import { useCallback, useEffect, useState } from 'react'

import { getAgentTranscript } from '@/commands/assistant'
import type { AgentSessionEntry } from '@/core/assistant/session'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.assistant.transcript')
const PAGE_SIZE = 200
const MAX_PAGES = 20

interface AgentTranscriptView {
  entries: AgentSessionEntry[]
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useAgentTranscript(threadId: string, refreshKey: string): AgentTranscriptView {
  const [entries, setEntries] = useState<AgentSessionEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    logger.debug('开始读取智能助手会话记录', {
      event: 'assistant_transcript.load.start',
      context: { threadId },
    })
    try {
      const collected: AgentSessionEntry[] = []
      let afterSequence = 0
      for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
        const page = await getAgentTranscript(threadId, afterSequence, PAGE_SIZE)
        collected.push(...page.entries)
        afterSequence = page.coveredThroughSequence
        if (!page.hasMore) break
      }
      setEntries(collected)
      logger.debug('智能助手会话记录读取完成', {
        event: 'assistant_transcript.load.completed',
        context: { threadId, entryCount: collected.length },
      })
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '读取会话记录失败'
      setError(message)
      logger.error('智能助手会话记录读取失败', cause, {
        event: 'assistant_transcript.load.failed',
        context: { threadId },
      })
    } finally {
      setLoading(false)
    }
  }, [threadId])

  useEffect(() => {
    void refresh()
  }, [refresh, refreshKey])

  return { entries, loading, error, refresh }
}
