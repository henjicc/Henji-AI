import { useCallback, useEffect, useRef, useState } from 'react'
import { listLogDates, queryLogEvents, type LogEventPushDto, type LogQueryParams } from '@/commands/logging'
import { createLogger } from '@/core/logging'
import type { DisplayLogEvent } from './eventDisplay'
import type { LevelFilter, SourceFilter } from './components/LogFilterToolbar'

const logger = createLogger('features.logs.useLogHistoryQuery')

const PAGE_SIZE = 200

/**
 * 历史模式数据源（2.3 历史日志回读）：拉取日期列表、按当前过滤条件流式查询选中日期的
 * 日志文件、支持"加载更早"翻页。与 `logStore.ts` 的实时内存缓冲职责不同（一个是订阅
 * 主进程推送的易失缓冲，一个是按需查询磁盘文件的分页数据源），拆成独立文件维护，
 * 避免 `logStore.ts` 同时承担"实时流"和"历史分页查询"两种不同生命周期的状态。
 *
 * 过滤下沉：level/source/domainPrefix/keyword 都作为查询参数传给主进程（`queryLogEvents`），
 * 不在前端对整页数据二次过滤——`errorOnly` 例外，它不在任务约定的服务端可下沉字段列表里
 * （"level / source / domain 前缀 / requestId / 关键词"未包含 errorOnly），调用方需要像实时
 * 模式一样在返回结果之上追加一层客户端 `.filter()`（保持与 `LogsPanel.tsx` 实时分支相同的
 * "独立布尔 + 追加 filter"模式，而不是把 errorOnly 强行映射成 `level=error` 服务端参数——
 * 那样会和用户同时选中的 levelFilter 冲突，无法表达"AND"语义）。
 */
export interface UseLogHistoryQueryParams {
  enabled: boolean
  sourceFilter: SourceFilter
  levelFilter: LevelFilter
  domainFilter: string
  keyword: string
}

export interface UseLogHistoryQueryResult {
  dates: string[]
  selectedDate: string
  setSelectedDate: (date: string) => void
  /** 已加载的历史事件，按时间降序（最新在前），与实时模式列表展示顺序一致。 */
  events: DisplayLogEvent[]
  loading: boolean
  /** 服务端是否还有更早的匹配事件（用于"加载更早"按钮）。 */
  hasMore: boolean
  /** 最近一次查询跳过的损坏行数（JSON 解析失败），用于工具栏提示。 */
  corruptedLines: number
  loadMore: () => void
}

let historySeq = 0

function withLocalId(events: LogEventPushDto[]): DisplayLogEvent[] {
  return events.map((event) => ({ ...event, id: `history-${historySeq++}` }))
}

export function useLogHistoryQuery({
  enabled,
  sourceFilter,
  levelFilter,
  domainFilter,
  keyword,
}: UseLogHistoryQueryParams): UseLogHistoryQueryResult {
  const [dates, setDates] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState('')
  const [events, setEvents] = useState<DisplayLogEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [corruptedLines, setCorruptedLines] = useState(0)
  const [nextBeforeLine, setNextBeforeLine] = useState<number | undefined>(undefined)
  const requestSeq = useRef(0)

  // 进入历史模式时（重复进入也一样）拉取一次日期列表，确保和实际文件保持一致
  // （比如窗口开着期间跨天导致旧文件过期、新文件出现）。
  useEffect(() => {
    if (!enabled) {
      return
    }
    let cancelled = false
    void listLogDates()
      .then((list) => {
        if (cancelled) {
          return
        }
        setDates(list)
        setSelectedDate((current) => (current && list.includes(current) ? current : list[0] || ''))
      })
      .catch((error) => {
        logger.error('[LogsWindow] 拉取历史日期列表失败', error)
      })
    return () => {
      cancelled = true
    }
  }, [enabled])

  const runQuery = useCallback(
    async (beforeLine: number | undefined, append: boolean): Promise<void> => {
      if (!selectedDate) {
        setEvents([])
        setHasMore(false)
        setCorruptedLines(0)
        setNextBeforeLine(undefined)
        return
      }

      const params: LogQueryParams = {
        date: selectedDate,
        level: levelFilter === 'all' ? undefined : levelFilter,
        source: sourceFilter === 'all' ? undefined : sourceFilter,
        domainPrefix: domainFilter === 'all' ? undefined : domainFilter,
        keyword: keyword || undefined,
        beforeLine,
        limit: PAGE_SIZE,
      }

      const seq = ++requestSeq.current
      setLoading(true)
      try {
        const result = await queryLogEvents(params)
        if (seq !== requestSeq.current) {
          // 查询期间过滤条件/日期已经变化，本次结果已过期，丢弃不落地。
          return
        }
        const withIds = withLocalId(result.events)
        setEvents((prev) => (append ? [...prev, ...withIds] : withIds))
        setHasMore(result.hasMore)
        // 每一页都流式扫描同一个文件；累加会把同一条损坏行重复计数。
        setCorruptedLines(result.corruptedLines)
        setNextBeforeLine(result.nextBeforeLine)
      } catch (error) {
        logger.error('[LogsWindow] 历史日志查询失败', error)
        if (seq === requestSeq.current) {
          if (!append) {
            setEvents([])
          }
          setHasMore(false)
          setNextBeforeLine(undefined)
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false)
        }
      }
    },
    [selectedDate, levelFilter, sourceFilter, domainFilter, keyword]
  )

  useEffect(() => {
    if (!enabled) {
      return
    }
    void runQuery(undefined, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, selectedDate, levelFilter, sourceFilter, domainFilter, keyword])

  const loadMore = useCallback(() => {
    if (!hasMore || loading || events.length === 0) {
      return
    }
    if (nextBeforeLine === undefined) {
      return
    }
    void runQuery(nextBeforeLine, true)
  }, [hasMore, loading, events.length, nextBeforeLine, runQuery])

  return {
    dates,
    selectedDate,
    setSelectedDate,
    events,
    loading,
    hasMore,
    corruptedLines,
    loadMore,
  }
}
