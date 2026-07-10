import { useEffect, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiModal } from '@/components/ui'
import { compactId, getDomainHint, getEventDisplay, type DisplayLogEvent } from '../eventDisplay'
import { chainToJson, chainToMarkdown, copyTextToClipboard } from '../copyFormats'
import { JsonTree } from './JsonTree'

type CopyFormat = 'markdown' | 'json'

interface RequestChainViewProps {
  isOpen: boolean
  onClose: () => void
  requestId: string
  /** 已按时间升序排列的同 requestId 事件（`logStore.ts` 的 `selectEventsByRequestId` 产出）。 */
  events: DisplayLogEvent[]
}

/**
 * 请求链路时间线：把同一 requestId 下的请求/轮询/结果/失败事件按时间顺序纵向排列，
 * 点击某条可就地展开 JSON 折叠树查看完整内容，顶部支持整条链路一键复制 Markdown/JSON。
 */
export function RequestChainView({ isOpen, onClose, requestId, events }: RequestChainViewProps): JSX.Element {
  const { t } = useI18n('ui')
  const [expandedId, setExpandedId] = useState('')
  const [copiedFormat, setCopiedFormat] = useState<CopyFormat | null>(null)

  useEffect(() => {
    if (!copiedFormat) {
      return
    }
    const timer = window.setTimeout(() => setCopiedFormat(null), 1500)
    return () => window.clearTimeout(timer)
  }, [copiedFormat])

  useEffect(() => {
    // 每次切换到新的 requestId 都重置展开态，避免上一条链路的展开状态残留。
    setExpandedId('')
  }, [requestId])

  async function handleCopy(format: CopyFormat): Promise<void> {
    const text = format === 'markdown' ? chainToMarkdown(events) : chainToJson(events)
    await copyTextToClipboard(text)
    setCopiedFormat(format)
  }

  const firstTimestamp = events[0]?.timestamp

  return (
    <UiModal
      isOpen={isOpen}
      onClose={onClose}
      title={`${t('logsWindow.chain.title')} · ${compactId(requestId)}`}
      widthClassName="w-[720px]"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <span className="text-xs text-text-muted">{t('logsWindow.chain.count', { count: events.length })}</span>
        <div className="flex gap-2">
          <UiButton type="button" size="sm" variant="ghost" onClick={() => handleCopy('markdown')}>
            {copiedFormat === 'markdown' ? t('logsWindow.copy.copied') : t('logsWindow.copy.markdown')}
          </UiButton>
          <UiButton type="button" size="sm" variant="ghost" onClick={() => handleCopy('json')}>
            {copiedFormat === 'json' ? t('logsWindow.copy.copied') : t('logsWindow.copy.json')}
          </UiButton>
        </div>
      </div>

      <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
        {events.length === 0 ? (
          <div className="p-4 text-center text-xs text-text-muted">{t('logsWindow.chain.empty')}</div>
        ) : (
          events.map((event) => {
            const display = getEventDisplay(event)
            const deltaMs = firstTimestamp ? new Date(event.timestamp).getTime() - new Date(firstTimestamp).getTime() : 0
            const isExpanded = expandedId === event.id
            const isError = event.level === 'error' || event.truncatedByLimit === true

            return (
              <div key={event.id} className="relative border-l border-border-dark/40 pb-1 pl-4">
                <span
                  className={`absolute -left-[5px] top-2 h-2.5 w-2.5 rounded-full ${isError ? 'bg-red-500' : 'bg-brand-400'}`}
                />
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto w-full flex-col items-stretch justify-start rounded-md border border-border-dark/40 bg-white/5 px-2 py-1.5 text-left text-xs font-normal"
                  onClick={() => setExpandedId(isExpanded ? '' : event.id)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-text-dark">
                      {display.emoji} {display.title}
                    </span>
                    <span className="shrink-0 text-[11px] opacity-70">+{deltaMs}ms</span>
                  </div>
                  <div className="mt-0.5 truncate text-[11px] opacity-70">
                    {getDomainHint(event.domain)} · {event.source} · {new Date(event.timestamp).toLocaleTimeString('zh-CN')}
                  </div>
                </UiButton>
                {isExpanded && (
                  <div className="mt-1 rounded-md border border-border-dark/40 bg-black/20 p-2">
                    <JsonTree value={event} />
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </UiModal>
  )
}
