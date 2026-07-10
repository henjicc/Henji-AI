import { useEffect, useState } from 'react'
import { useI18n } from '@/hooks/useI18n'
import { UiButton } from '@/components/ui'
import type { DisplayLogEvent } from '../eventDisplay'
import { LogEventRow } from './LogEventRow'

const INITIAL_VISIBLE_COUNT = 200
const LOAD_MORE_STEP = 200

interface LogEventListProps {
  events: DisplayLogEvent[]
  selectedId: string
  onSelect: (id: string) => void
  paused: boolean
  pausedCount: number
  /** 过滤条件的稳定签名（source|level|domain|keyword），变化时重置可见条数为最新 N 条。 */
  filterSignature: string
}

/**
 * 日志事件列表：只渲染最近 N 条 + "加载更早" 增量展开，避免数千条事件一次性渲染卡顿。
 * `events` 由调用方传入且已按需过滤/倒序（最新在前）。可见条数只在过滤条件变化时重置，
 * 不随新事件持续流入而重置——否则暂停/恢复或高频日志场景下"加载更多"的展开状态会被打断。
 */
export function LogEventList({ events, selectedId, onSelect, paused, pausedCount, filterSignature }: LogEventListProps): JSX.Element {
  const { t } = useI18n('ui')
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT)

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT)
  }, [filterSignature])

  const visibleEvents = events.slice(0, visibleCount)
  const hasMore = events.length > visibleCount

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border-dark/50 bg-black/20">
      {paused && (
        <div className="shrink-0 border-b border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-[11px] text-yellow-500/90">
          {t('logsWindow.list.paused')}{pausedCount > 0 ? ` (${pausedCount})` : ''}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {visibleEvents.length === 0 ? (
          <div className="px-3 py-6 text-center text-xs text-text-muted">{t('logsWindow.list.empty')}</div>
        ) : (
          <>
            {visibleEvents.map((event) => (
              <LogEventRow key={event.id} event={event} selected={selectedId === event.id} onSelect={onSelect} />
            ))}
            {hasMore && (
              <div className="p-2">
                <UiButton
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full"
                  onClick={() => setVisibleCount((count) => count + LOAD_MORE_STEP)}
                >
                  {t('logsWindow.list.loadMore')} ({events.length - visibleCount})
                </UiButton>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
