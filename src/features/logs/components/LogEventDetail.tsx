import { useI18n } from '@/hooks/useI18n'
import { getDomainHint, getEventDisplay, type DisplayLogEvent } from '../eventDisplay'

interface LogEventDetailProps {
  event: DisplayLogEvent | null
}

interface TruncatedContext {
  truncatedByLimit: true
  originalBytes?: number
}

function isTruncatedContext(value: DynamicValue): value is TruncatedContext {
  return typeof value === 'object' && value !== null && (value as TruncatedContext).truncatedByLimit === true
}

/**
 * 事件详情面板：普通事件按 JSON 直接展开；`truncatedByLimit` 事件的 context 已被主进程
 * 保险丝替换成 `{ truncatedByLimit: true, originalBytes }` 固定结构（见 sanitize.ts 的
 * `applyEventSizeFuse`），这里单独给出提示文案而不是当作正常业务数据渲染。
 * JSON 折叠树是 2.2 的范围，这里先用简单 `<pre>` 展示，保持与旧 UnifiedLogViewer 一致的复杂度。
 */
export function LogEventDetail({ event }: LogEventDetailProps): JSX.Element {
  const { t } = useI18n('ui')

  if (!event) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-border-dark/50 bg-black/20 p-3 text-xs text-text-muted">
        {t('logsWindow.detail.empty')}
      </div>
    )
  }

  const display = getEventDisplay(event)
  const truncatedContext = isTruncatedContext(event.context) ? event.context : null

  return (
    <div className="h-full overflow-y-auto rounded-lg border border-border-dark/50 bg-black/20 p-3 text-xs text-text-dark">
      <div className="mb-3 rounded-md border border-border-dark/40 bg-white/5 p-2">
        <div className="text-sm text-text-dark">
          {display.emoji} {display.title}
        </div>
        <div className="mt-1 text-[11px] text-text-muted">
          {getDomainHint(event.domain)} · {event.source} · {new Date(event.timestamp).toLocaleString('zh-CN')}
        </div>
      </div>

      {event.truncatedByLimit && (
        <div className="mb-3 rounded-md border border-yellow-500/40 bg-yellow-500/10 p-2 text-[11px] text-yellow-500/90">
          {t('logsWindow.detail.truncatedNotice', { bytes: truncatedContext?.originalBytes ?? '?' })}
        </div>
      )}

      <pre className="whitespace-pre-wrap break-all">{JSON.stringify(event, null, 2)}</pre>
    </div>
  )
}
