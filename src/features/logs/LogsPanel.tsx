import { useEffect, useMemo, useState } from 'react'
import { useLogWindowStore } from './logStore'
import { matchesKeyword, type DisplayLogEvent } from './eventDisplay'
import { LogFilterToolbar, type LevelFilter, type SourceFilter } from './components/LogFilterToolbar'
import { LogEventList } from './components/LogEventList'
import { LogEventDetail } from './components/LogEventDetail'

/**
 * 日志窗口页面编排：接线数据源（logStore）、过滤状态、列表与详情面板。
 * 不承载具体渲染细节——过滤 UI 在 `LogFilterToolbar`，列表在 `LogEventList`，
 * 详情在 `LogEventDetail`，事件美化字典在 `eventDisplay.ts`。
 */
export function LogsPanel(): JSX.Element {
  const { events, paused, pausedCount, setPaused, clear } = useLogWindowStore()
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [domainFilter, setDomainFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [selectedId, setSelectedId] = useState('')

  const domainOptions = useMemo(() => {
    const unique = Array.from(new Set(events.map((event) => event.domain))).sort()
    return unique
  }, [events])

  const filteredEvents = useMemo(() => {
    return events
      .filter((event) => sourceFilter === 'all' || event.source === sourceFilter)
      .filter((event) => levelFilter === 'all' || event.level === levelFilter)
      .filter((event) => domainFilter === 'all' || event.domain === domainFilter)
      .filter((event) => matchesKeyword(event, keyword))
      .slice()
      .reverse()
  }, [events, sourceFilter, levelFilter, domainFilter, keyword])

  const filterSignature = `${sourceFilter}|${levelFilter}|${domainFilter}|${keyword}`

  useEffect(() => {
    if (filteredEvents.length === 0) {
      setSelectedId('')
      return
    }
    if (!selectedId || !filteredEvents.some((event) => event.id === selectedId)) {
      setSelectedId(filteredEvents[0].id)
    }
  }, [filteredEvents, selectedId])

  const selectedEvent: DisplayLogEvent | null = filteredEvents.find((event) => event.id === selectedId) || null

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <LogFilterToolbar
        sourceFilter={sourceFilter}
        onSourceFilterChange={setSourceFilter}
        levelFilter={levelFilter}
        onLevelFilterChange={setLevelFilter}
        domainFilter={domainFilter}
        onDomainFilterChange={setDomainFilter}
        domainOptions={domainOptions}
        keyword={keyword}
        onKeywordChange={setKeyword}
        paused={paused}
        onTogglePause={() => setPaused(!paused)}
        onClear={clear}
      />
      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-3 p-3">
        <LogEventList
          events={filteredEvents}
          selectedId={selectedId}
          onSelect={setSelectedId}
          paused={paused}
          pausedCount={pausedCount}
          filterSignature={filterSignature}
        />
        <LogEventDetail event={selectedEvent} />
      </div>
    </div>
  )
}
