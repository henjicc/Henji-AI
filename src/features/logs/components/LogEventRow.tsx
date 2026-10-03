import { UiNavButton } from '@/components/ui'
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
    <UiNavButton
      type="button"
      active={selected}
      size="auto"
      className="flex-col items-stretch justify-start font-normal"
      onClick={() => onSelect(event.id)}
    >
      {/* 错误行：左侧一道危险色标记（列表行本身不改外观） */}
      {isError && !selected ? <span aria-hidden="true" className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-danger-solid" /> : null}
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="truncate">
          <display.icon aria-hidden="true" className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />{display.title}
        </span>
        <span className="shrink-0 text-2xs uppercase tracking-wide opacity-70">{event.level}</span>
      </div>
      <div className="mt-1 flex items-center gap-1 truncate text-2xs opacity-80">
        <span className="rounded bg-hover px-1 py-0.5">{event.source}</span>
        <span>{getDomainHint(event.domain)}</span>
      </div>
      <div className="mt-1 truncate text-xs">{display.summary}</div>
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
    </UiNavButton>
  )
}
