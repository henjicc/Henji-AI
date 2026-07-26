import { useEffect, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiButton, UiEmpty } from '@/components/ui'
import { getDomainHint, getEventDisplay, type DisplayLogEvent } from '../eventDisplay'
import { copyTextToClipboard, eventToJson, eventToMarkdown } from '../copyFormats'
import { JsonTree } from './JsonTree'

interface LogEventDetailProps {
  event: DisplayLogEvent | null
  /** 打开该事件所属 requestId 的完整链路视图（无 requestId 的事件不显示入口）。 */
  onViewChain: (requestId: string) => void
}

interface TruncatedContext {
  truncatedByLimit: true
  originalBytes?: number
}

type CopyFormat = 'markdown' | 'json'

function isTruncatedContext(value: DynamicValue): value is TruncatedContext {
  return typeof value === 'object' && value !== null && (value as TruncatedContext).truncatedByLimit === true
}

/**
 * 事件详情面板：结构化 JSON 折叠树（`JsonTree.tsx`）展示完整事件，支持一键复制为
 * Markdown/JSON，有 requestId 时提供"查看完整链路"入口。`truncatedByLimit` 事件的
 * context 已被主进程保险丝替换成 `{ truncatedByLimit: true, originalBytes }` 固定结构
 * （见 sanitize.ts 的 `applyEventSizeFuse`），这里单独给出提示文案而不当作正常业务数据渲染。
 */
export function LogEventDetail({ event, onViewChain }: LogEventDetailProps): JSX.Element {
  const { t } = useI18n('ui')
  const [copiedFormat, setCopiedFormat] = useState<CopyFormat | null>(null)

  useEffect(() => {
    if (!copiedFormat) {
      return
    }
    const timer = window.setTimeout(() => setCopiedFormat(null), 1500)
    return () => window.clearTimeout(timer)
  }, [copiedFormat])

  if (!event) {
    return (
      <div className="h-full rounded-lg border border-border-dark/50 bg-black/20 p-3">
        <UiEmpty className="h-full" size="sm" title={t('logsWindow.detail.empty')} />
      </div>
    )
  }

  const display = getEventDisplay(event)
  const truncatedContext = isTruncatedContext(event.context) ? event.context : null
  const requestId = event.requestId

  async function handleCopy(format: CopyFormat): Promise<void> {
    if (!event) {
      return
    }
    const text = format === 'markdown' ? eventToMarkdown(event) : eventToJson(event)
    await copyTextToClipboard(text)
    setCopiedFormat(format)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border-dark/50 bg-black/20">
      <div className="shrink-0 border-b border-border-dark/40 bg-white/5 p-2">
        <div className="text-sm text-text-dark">
          {display.emoji} {display.title}
        </div>
        <div className="mt-1 text-2xs text-text-muted">
          {getDomainHint(event.domain)} · {event.source} · {new Date(event.timestamp).toLocaleString('zh-CN')}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <UiButton type="button" size="sm" variant="ghost" onClick={() => handleCopy('markdown')}>
            {copiedFormat === 'markdown' ? t('logsWindow.copy.copied') : t('logsWindow.copy.markdown')}
          </UiButton>
          <UiButton type="button" size="sm" variant="ghost" onClick={() => handleCopy('json')}>
            {copiedFormat === 'json' ? t('logsWindow.copy.copied') : t('logsWindow.copy.json')}
          </UiButton>
          {requestId && (
            <UiButton type="button" size="sm" variant="ghost" onClick={() => onViewChain(requestId)}>
              {t('logsWindow.chain.viewButton')}
            </UiButton>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs text-text-dark">
        {event.truncatedByLimit && (
          <div className="mb-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-2xs text-yellow-500/90">
            {t('logsWindow.detail.truncatedNotice', { bytes: truncatedContext?.originalBytes ?? '?' })}
          </div>
        )}

        <JsonTree value={event} />
      </div>
    </div>
  )
}
