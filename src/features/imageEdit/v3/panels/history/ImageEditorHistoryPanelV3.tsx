import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { History, Image, Redo2, Undo2 } from 'lucide-react'
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso'
import { useTranslation } from 'react-i18next'
import { UiButton, UiEmpty, UiError, UiIconButton, UiLoading, UiOptionButton } from '@/components/ui'
import type { ImageEditHistoryRowV3 } from '@/core/imageEdit/v3/historyPaging/projection'
import type { ImageEditorPanelContextV3 } from '../../panelFramework/panelRegistry'
import type { ImageEditorV3Controller } from '../../editor/types'
import { ImageEditThumbnailsV3 } from '../thumbnails'
import { resolveImageDisplayUrl } from '@/services/imageSource'
import { useImageEditorDisposableV3 } from '../../execution/useImageEditorDisposableV3'
import { createLogger } from '@/core/logging'

type HistoryPort = NonNullable<ImageEditorV3Controller['historyPort']>
const logger = createLogger('features.imageEdit.history_panel')

const HistoryThumbnail = memo(function HistoryThumbnail({ thumbnails, row, generation }: {
  thumbnails: ImageEditThumbnailsV3; row: ImageEditHistoryRowV3; generation: number
}): JSX.Element {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const abort = new AbortController()
    setUrl(null)
    void thumbnails.read(row.position, `${generation}:${row.key}`, abort.signal).then(value => {
      if (!abort.signal.aborted) setUrl(value)
    }).catch(error => {
      if (!abort.signal.aborted) logger.warn('历史缩略图暂不可用', { event: 'image_edit.history.thumbnail.failed', error })
    })
    return () => abort.abort()
  }, [generation, row.key, row.position, thumbnails])
  return <span className="flex h-8 w-10 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-raised">
    {url ? <img className="h-full w-full object-contain" src={resolveImageDisplayUrl(url)} alt="" /> : <Image className="h-4 w-4 text-text3" aria-hidden="true" />}
  </span>
})

const HistoryList = memo(function HistoryList({ port, thumbnails, disabled, onJump }: {
  port: HistoryPort; thumbnails: ImageEditThumbnailsV3; disabled: boolean; onJump: (position: number) => void
}): JSX.Element {
  const { t } = useTranslation('ui')
  const [view, setView] = useState(() => port.getHistoryView())
  const list = useRef<VirtuosoHandle>(null)
  const pages = useRef(new Map<string, Promise<ImageEditHistoryRowV3[]>>())
  useEffect(() => {
    const read = (): void => {
      const next = port.getHistoryView()
      setView(previous => {
        if (previous.generation === next.generation) return previous
        pages.current.clear()
        return next
      })
    }
    read()
    return port.subscribe(read)
  }, [port])
  useEffect(() => { list.current?.scrollIntoView({ index: view.position, align: 'center', behavior: 'auto' }) }, [view.position])
  const pageAt = useCallback((index: number): Promise<ImageEditHistoryRowV3[]> => {
    const pageIndex = Math.floor(index / 64)
    const key = `${view.generation}:${pageIndex}`
    let page = pages.current.get(key)
    if (!page) {
      page = port.readHistoryPageAsync ? port.readHistoryPageAsync(pageIndex * 64, 64) : Promise.resolve(port.readHistoryPage(pageIndex * 64, 64))
      // 有界视图缓存；淘汰的页可随滚动重新读取，历史条目不被裁剪。
      if (pages.current.size >= 8) pages.current.delete(pages.current.keys().next().value as string)
      pages.current.set(key, page)
      void page.catch(() => { if (pages.current.get(key) === page) pages.current.delete(key) })
    }
    return page
  }, [port, view.generation])
  if (view.total === 0) return <UiEmpty size="sm" icon={<History className="h-5 w-5" />} title={t('imageEditor.v3.history.empty', { defaultValue: '还没有编辑记录' })} />
  return <Virtuoso ref={list} className="min-h-0 flex-1" totalCount={view.total + 1} initialTopMostItemIndex={view.position}
    computeItemKey={index => `${view.generation}:${index}`}
    itemContent={index => <HistoryRow index={index} pageAt={pageAt} thumbnails={thumbnails} view={view} disabled={disabled} onJump={onJump} />} />
})

const HistoryRow = memo(function HistoryRow({ index, pageAt, thumbnails, view, disabled, onJump }: {
  index: number; pageAt: (index: number) => Promise<ImageEditHistoryRowV3[]>; thumbnails: ImageEditThumbnailsV3;
  view: ReturnType<HistoryPort['getHistoryView']>; disabled: boolean; onJump: (position: number) => void
}): JSX.Element {
  const { t } = useTranslation('ui')
  const [row, setRow] = useState<ImageEditHistoryRowV3 | null>(null)
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setRow(null); setFailed(false)
    void pageAt(index).then(page => { if (active) setRow(page[index % 64]) }).catch(error => {
      if (!active) return
      setFailed(true)
      logger.warn('历史页读取失败', { event: 'image_edit.history.page.failed', error })
    })
    return () => { active = false }
  }, [index, pageAt, retry])
  if (failed) return <UiError size="sm" title={t('imageEditor.v3.history.pageFailed', { defaultValue: '未能读取历史记录' })}
    message={t('imageEditor.v3.history.pageFailedMessage', { defaultValue: '编辑内容已保留，请重试读取。' })}
    actions={<UiButton size="sm" onClick={() => setRetry(value => value + 1)}>{t('common.retry', { defaultValue: '重试' })}</UiButton>} />
  // 占位与含缩略图的正常行等高，冷页到达不改变 Virtuoso 的滚动锚点。
  if (!row) return <div className="h-11 px-2 py-0.5"><UiLoading size="xs"
    className="h-full !flex-row gap-2 !py-0 [&>p]:!mt-0"
    message={t('imageEditor.v3.history.loading', { defaultValue: '正在读取历史…' })} /></div>
  return <div className="px-2 py-0.5" data-image-history-row={index}>
        <UiOptionButton variant="menu" size="sm" className="w-full" active={index === view.position}
          aria-current={index === view.position ? 'step' : undefined} disabled={disabled}
          onClick={() => onJump(index)}>
          <HistoryThumbnail thumbnails={thumbnails} row={row} generation={view.generation} />
          <span className="min-w-0 flex-1 truncate text-left">{t(row.labelKey, { defaultValue: row.label })}{row.targetName ? ` · ${row.targetName}` : ''}</span>
          {index === view.position && <span className="shrink-0">{t('imageEditor.v3.history.current', { defaultValue: '当前位置' })}</span>}
        </UiOptionButton>
      </div>
})

export function ImageEditorHistoryPanelV3({ controller }: ImageEditorPanelContextV3): JSX.Element {
  const { t } = useTranslation('ui')
  const port = controller.historyPort
  const sessionId = controller.sessionId
  const historyResourceDescriptors = controller.historyResourceDescriptors
  const thumbnails = useMemo(() => new ImageEditThumbnailsV3({ sessionId, historyPort: port, historyResourceDescriptors }), [sessionId, port, historyResourceDescriptors])
  useImageEditorDisposableV3(thumbnails)
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => { abort.current?.abort() }, [port])
  const jump = useCallback(async (position: number): Promise<void> => {
    if (!port || abort.current) return
    const currentAbort = new AbortController()
    abort.current = currentAbort
    setFailed(false)
    try {
      await port.jumpToHistory(position, { signal: currentAbort.signal, onProgress: (completed, total) => setProgress({ completed, total }) })
    } catch { if (!currentAbort.signal.aborted) setFailed(true) }
    finally { if (abort.current === currentAbort) { abort.current = null; setProgress(null) } }
  }, [port])
  const onJump = useCallback((position: number): void => { void jump(position) }, [jump])
  if (!port) return <UiEmpty size="sm" title={t('imageEditor.v3.history.unavailable', { defaultValue: '当前内容没有可恢复的历史' })} />
  return <div data-image-history-panel className="flex h-full min-h-0 flex-col">
    <div className="flex shrink-0 items-center gap-1 px-2 py-1">
      <UiIconButton size="md" aria-label={t('imageEditor.v3.history.undo', { defaultValue: '撤销' })} disabled={!controller.canUndo || Boolean(progress)}
        onClick={() => { void jump(port.getHistoryView().position - 1) }}><Undo2 className="h-4 w-4" /></UiIconButton>
      <UiIconButton size="md" aria-label={t('imageEditor.v3.history.redo', { defaultValue: '重做' })} disabled={!controller.canRedo || Boolean(progress)}
        onClick={() => { void jump(port.getHistoryView().position + 1) }}><Redo2 className="h-4 w-4" /></UiIconButton>
      <UiButton size="sm" className="ml-auto" disabled={Boolean(progress)} onClick={() => { const view = port.getHistoryView(); void jump(view.total) }}>
        {t('imageEditor.v3.history.latest', { defaultValue: '回到最新' })}
      </UiButton>
    </div>
    {failed && <UiError size="sm" title={t('imageEditor.v3.history.failed', { defaultValue: '未能恢复所选历史' })}
      message={t('imageEditor.v3.history.failedMessage', { defaultValue: '当前编辑内容已保留。请重新选择历史记录后重试。' })}
      actions={<UiButton size="sm" onClick={() => setFailed(false)}>{t('imageEditor.v3.history.continue', { defaultValue: '继续编辑' })}</UiButton>} />}
    {progress && <UiLoading size="sm" message={t('imageEditor.v3.history.restoring', { defaultValue: '正在恢复编辑… {{percent}}%', percent: Math.round(progress.completed / progress.total * 100) })}>
      <UiButton size="sm" onClick={() => abort.current?.abort()}>{t('imageEditor.v3.history.cancel', { defaultValue: '取消恢复' })}</UiButton>
    </UiLoading>}
    <HistoryList port={port} thumbnails={thumbnails} disabled={Boolean(progress)} onJump={onJump} />
  </div>
}
