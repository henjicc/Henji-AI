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
  /**
   * 历史模式专用：服务端是否还有更早的匹配事件（超出当前已加载的 `events`）、加载更早一页
   * 的回调、加载中状态。实时模式不传（本地内存缓冲已经是全量，不需要服务端翻页）。
   */
  remoteHasMore?: boolean
  onLoadMoreRemote?: () => void
  remoteLoading?: boolean
}

/**
 * 日志事件列表：只渲染最近 N 条 + "加载更早" 增量展开，避免数千条事件一次性渲染卡顿。
 * `events` 由调用方传入且已按需过滤/倒序（最新在前）。可见条数只在过滤条件变化时重置，
 * 不随新事件持续流入而重置——否则暂停/恢复或高频日志场景下"加载更多"的展开状态会被打断。
 *
 * 历史模式下"加载更早"分两层：先展开当前已加载页面里尚未可见的部分（本地 `visibleCount`），
 * 全部展开完、且服务端还有更早数据（`remoteHasMore`）时，再触发 `onLoadMoreRemote` 向主进程
 * 查询更早一页——调用方（`LogsPanel.tsx`）不需要关心这个两层细节，只要把历史 hook 的
 * `hasMore`/`loadMore`/`loading` 透传进来即可。
 */
export function LogEventList({
  events,
  selectedId,
  onSelect,
  paused,
  pausedCount,
  filterSignature,
  remoteHasMore = false,
  onLoadMoreRemote,
  remoteLoading = false,
}: LogEventListProps): JSX.Element {
  const { t } = useI18n('ui')
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE_COUNT)

  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE_COUNT)
  }, [filterSignature])

  const visibleEvents = events.slice(0, visibleCount)
  const hasMoreLocal = events.length > visibleCount
  const hasMore = hasMoreLocal || remoteHasMore

  function handleLoadMore(): void {
    if (hasMoreLocal) {
      setVisibleCount((count) => count + LOAD_MORE_STEP)
      return
    }
    onLoadMoreRemote?.()
  }

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-border-dark/50 bg-black/20">
      {paused && (
        <div className="shrink-0 border-b border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-2xs text-yellow-500/90">
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
                  disabled={remoteLoading && !hasMoreLocal}
                  onClick={handleLoadMore}
                >
                  {remoteLoading && !hasMoreLocal
                    ? t('logsWindow.list.loading')
                    : hasMoreLocal
                      ? `${t('logsWindow.list.loadMore')} (${events.length - visibleCount})`
                      : t('logsWindow.list.loadMore')}
                </UiButton>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
