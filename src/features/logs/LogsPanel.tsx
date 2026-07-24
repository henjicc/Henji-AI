import { useEffect, useMemo, useState } from 'react'
import { BrainCircuit, ListTree } from 'lucide-react'
import { queryLogEvents } from '@/commands/logging'
import { createLogger } from '@/core/logging'
import { UiButton } from '@/components/ui'
import { selectEventsByRequestId, useLogWindowStore } from './logStore'
import { useLogHistoryQuery } from './useLogHistoryQuery'
import { matchesKeyword, type DisplayLogEvent } from './eventDisplay'
import { LogFilterToolbar, type LevelFilter, type LogViewMode, type SourceFilter } from './components/LogFilterToolbar'
import { LogEventList } from './components/LogEventList'
import { LogEventDetail } from './components/LogEventDetail'
import { RequestChainView } from './components/RequestChainView'
import { AssistantTracePanel } from './components/AssistantTracePanel'

const logger = createLogger('features.logs.LogsPanel')
/** 历史模式链路查询的单次上限：远大于实际单条请求链路的事件数量（通常几条到十几条）。 */
const CHAIN_QUERY_LIMIT = 500

/**
 * 日志窗口页面编排：接线数据源（实时 `logStore` / 历史 `useLogHistoryQuery`）、过滤状态、
 * 列表与详情面板、请求链路弹层。不承载具体渲染细节——过滤 UI 在 `LogFilterToolbar`，
 * 列表在 `LogEventList`，详情在 `LogEventDetail`，链路时间线在 `RequestChainView`，
 * 事件美化字典在 `eventDisplay.ts`。
 *
 * 实时/历史两种模式复用同一套过滤状态与下游 UI（`LogEventList`/`LogEventDetail`/
 * `RequestChainView`），差异只在数据源：实时模式过滤在前端对内存缓冲做（`matchesKeyword`
 * 等），历史模式过滤下沉到主进程查询参数（`useLogHistoryQuery` 内部调用 `queryLogEvents`），
 * 前端只对历史结果补一层 `errorOnly`（服务端不支持的字段，语义见 `useLogHistoryQuery.ts`）。
 */
export function LogsPanel(): JSX.Element {
  const { events: liveEvents, paused, pausedCount, setPaused, clear } = useLogWindowStore()
  const [surface, setSurface] = useState<'events' | 'assistant'>('events')
  const [mode, setMode] = useState<LogViewMode>('live')
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all')
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all')
  const [domainFilter, setDomainFilter] = useState('all')
  const [keyword, setKeyword] = useState('')
  const [errorOnly, setErrorOnly] = useState(false)
  const [selectedId, setSelectedId] = useState('')
  const [chainRequestId, setChainRequestId] = useState<string | null>(null)
  const [historyChainEvents, setHistoryChainEvents] = useState<DisplayLogEvent[]>([])

  const history = useLogHistoryQuery({
    enabled: mode === 'history',
    sourceFilter,
    levelFilter,
    domainFilter,
    keyword,
  })

  const events = mode === 'history' ? history.events : liveEvents

  const domainOptions = useMemo(() => {
    const unique = Array.from(new Set(events.map((event) => event.domain))).sort()
    return unique
  }, [events])

  const filteredEvents = useMemo(() => {
    if (mode === 'history') {
      // level/source/domain/keyword 已由 useLogHistoryQuery 下沉到主进程查询参数；
      // errorOnly 不在下沉字段范围内，这里补一层客户端过滤（与实时分支同款独立布尔模式）。
      return history.events.filter((event) => !errorOnly || event.level === 'error')
    }
    return liveEvents
      .filter((event) => sourceFilter === 'all' || event.source === sourceFilter)
      .filter((event) => levelFilter === 'all' || event.level === levelFilter)
      .filter((event) => domainFilter === 'all' || event.domain === domainFilter)
      .filter((event) => !errorOnly || event.level === 'error')
      .filter((event) => matchesKeyword(event, keyword))
      .slice()
      .reverse()
  }, [mode, history.events, liveEvents, sourceFilter, levelFilter, domainFilter, errorOnly, keyword])

  const filterSignature = `${mode}|${history.selectedDate}|${sourceFilter}|${levelFilter}|${domainFilter}|${errorOnly}|${keyword}`

  // 实时模式链路查询基于完整事件缓冲（不受当前过滤条件限制），确保开启"只看错误"或关键词
  // 过滤时仍能看到同一 requestId 下的全部事件。历史模式链路查询见下方 effect：直接问主进程要
  // 选中日期下该 requestId 的全部事件，不依赖已加载到前端的分页数据。
  const liveChainEvents = useMemo(() => {
    return mode === 'live' && chainRequestId ? selectEventsByRequestId(liveEvents, chainRequestId) : []
  }, [mode, liveEvents, chainRequestId])

  const chainEvents = mode === 'history' ? historyChainEvents : liveChainEvents

  useEffect(() => {
    if (mode !== 'history' || !chainRequestId || !history.selectedDate) {
      setHistoryChainEvents([])
      return
    }

    let cancelled = false
    void queryLogEvents({ date: history.selectedDate, requestId: chainRequestId, limit: CHAIN_QUERY_LIMIT })
      .then((result) => {
        if (cancelled) {
          return
        }
        const sorted = result.events
          .map((event, index) => ({ ...event, id: `chain-${chainRequestId}-${index}` }))
          .sort((a, b) => a.timestamp.localeCompare(b.timestamp))
        setHistoryChainEvents(sorted)
      })
      .catch((error) => {
        logger.error('[LogsWindow] 历史链路查询失败', error)
        if (!cancelled) {
          setHistoryChainEvents([])
        }
      })
    return () => {
      cancelled = true
    }
  }, [mode, chainRequestId, history.selectedDate])

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
  const traceRefreshToken = useMemo(
    () => liveEvents.filter((event) => event.event.startsWith('agent_trace.step.')).length,
    [liveEvents]
  )

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 items-center gap-1 border-b border-border-dark/50 bg-panel px-3 py-1.5">
        <UiButton type="button" size="sm" variant={surface === 'events' ? 'primary' : 'ghost'} onClick={() => setSurface('events')}>
          <ListTree className="mr-1.5 h-3.5 w-3.5" />事件日志
        </UiButton>
        <UiButton type="button" size="sm" variant={surface === 'assistant' ? 'primary' : 'ghost'} onClick={() => setSurface('assistant')}>
          <BrainCircuit className="mr-1.5 h-3.5 w-3.5" />助手追踪
        </UiButton>
      </div>
      {surface === 'assistant' ? (
        <div className="min-h-0 flex-1"><AssistantTracePanel refreshToken={traceRefreshToken} /></div>
      ) : (
        <>
          <LogFilterToolbar
            mode={mode}
            onModeChange={setMode}
            sourceFilter={sourceFilter}
            onSourceFilterChange={setSourceFilter}
            levelFilter={levelFilter}
            onLevelFilterChange={setLevelFilter}
            domainFilter={domainFilter}
            onDomainFilterChange={setDomainFilter}
            domainOptions={domainOptions}
            keyword={keyword}
            onKeywordChange={setKeyword}
            errorOnly={errorOnly}
            onErrorOnlyChange={setErrorOnly}
            paused={paused}
            onTogglePause={() => setPaused(!paused)}
            onClear={clear}
            onLookupRequestId={setChainRequestId}
            historyDates={history.dates}
            selectedHistoryDate={history.selectedDate}
            onSelectedHistoryDateChange={history.setSelectedDate}
            historyCorruptedLines={history.corruptedLines}
          />
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-3 p-3">
            <LogEventList
              events={filteredEvents}
              selectedId={selectedId}
              onSelect={setSelectedId}
              paused={paused}
              pausedCount={pausedCount}
              filterSignature={filterSignature}
              remoteHasMore={mode === 'history' ? history.hasMore : false}
              onLoadMoreRemote={mode === 'history' ? history.loadMore : undefined}
              remoteLoading={mode === 'history' ? history.loading : false}
            />
            <LogEventDetail event={selectedEvent} onViewChain={setChainRequestId} />
          </div>
          <RequestChainView
            isOpen={chainRequestId !== null}
            onClose={() => setChainRequestId(null)}
            requestId={chainRequestId ?? ''}
            events={chainEvents}
          />
        </>
      )}
    </div>
  )
}
