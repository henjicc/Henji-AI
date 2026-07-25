import { UiButton } from '@/components/ui'
import { compactId, getDomainHint, getEventDisplay, type DisplayLogEvent } from '../eventDisplay'

interface LogEventRowProps {
  event: DisplayLogEvent
  selected: boolean
  onSelect: (id: string) => void
}

export function LogEventRow({ event, selected, onSelect }: LogEventRowProps): JSX.Element {
  const display = getEventDisplay(event)
  const isError = event.level === 'error' || event.truncatedByLimit === true

  return (
    <UiButton
      type="button"
      variant="ghost"
      size="sm"
      className={`h-auto w-full flex-col items-stretch justify-start rounded-none border-x-0 border-t-0 border-b border-border-dark/40 bg-transparent px-3 py-2 text-left text-xs font-normal transition-colors ${
        selected ? 'bg-brand-600/30 text-text-dark' : 'hover:bg-white/5 text-text-muted'
      } ${isError && !selected ? 'border-l-2 border-l-red-500/60' : ''}`}
      onClick={() => onSelect(event.id)}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-text-dark">
          {display.emoji} {display.title}
        </span>
        <span className="shrink-0 text-2xs uppercase tracking-wide opacity-70">{event.level}</span>
      </div>
      <div className="mt-1 flex items-center gap-1 truncate text-2xs opacity-80">
        <span className="rounded bg-white/5 px-1 py-0.5">{event.source}</span>
        <span>{getDomainHint(event.domain)}</span>
      </div>
      <div className="mt-1 truncate text-text-dark">{display.summary}</div>
      <div className="mt-1 flex items-center justify-between gap-2">
        <span className="text-2xs opacity-70">{new Date(event.timestamp).toLocaleTimeString('zh-CN')}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1 text-2xs opacity-70">
        <span>类型:{event.event}</span>
        {event.requestId ? <span>req:{compactId(event.requestId)}</span> : null}
        {event.taskId ? <span>task:{compactId(event.taskId)}</span> : null}
        {event.modelId ? <span>model:{event.modelId}</span> : null}
        {event.providerId ? <span>provider:{event.providerId}</span> : null}
      </div>
    </UiButton>
  )
}
