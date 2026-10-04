import React, { useCallback, useEffect, useRef, useState } from 'react'
import { FolderPlus, GripVertical, LoaderCircle, Search, Settings2, X } from 'lucide-react'
import { Dropdown, PanelTrigger, UI_FIELD_LABEL_CLASS, UI_GLASS_ADAPTIVE_DIVIDER_CLASS, UI_GLASS_ADAPTIVE_REGION_CLASS, UI_SEGMENTED_TRACK_CLASS, UI_TEXT_META_CLASS, UiButton, UiEmpty, UiError, UiIconButton, UiInput, UiOptionButton, UiPageHeader, UiRangeInput, UiSharedGlassHost } from '@/components/ui'
import type { AssetLibraryRecord, AssetMediaType, AssetPage, AssetRecord } from '@/platform/contracts/assetLibrary'
import { addAssetToLibrary, createAssetLibrary, deleteAsset, deleteAssetLibrary, inspectAssets, listAssetLibraries, listAssetTags, queryAssets, removeAssetFromLibrary, renameAssetLibrary, setAssetTags, updateAsset } from '@/commands/assetLibrary'
import { ICON_MULTI_SELECT } from '@/core/theme/icons'
import { createLogger } from '@/core/logging'
import { useI18n } from '@/hooks/useI18n'
import { useSettingsStore } from '@/stores/settingsStore'
import { useAssetLibraryStore } from './store/assetLibraryStore'
import { AssetCard } from './components/AssetCard'
import type { AssetMenuAnchor } from './components/AssetCard'
import { AssetLibrarySidebar } from './components/AssetLibrarySidebar'
import { AssetCardMenu } from './components/AssetCardMenu'
import { AssetPreviewOverlay } from './components/AssetPreviewOverlay'
import { AssetBatchManager } from './components/AssetBatchManager'
import { deleteAssetsBatch, updateAssetLibraryBatch, updateAssetTagsBatch, type AssetBatchResult } from './application/assetBatchOperations'
import { useAssetSidebarResize } from './hooks/useAssetSidebarResize'
import ContextMenu from '@/components/ContextMenu'
import { useContextMenu } from '@/hooks/useContextMenu'

const logger = createLogger('features.assets')
const EMPTY_PAGE: AssetPage = { items: [], total: 0, page: 1, pageSize: 36 }

function isMissingAssetLibraryHandler(cause: unknown): boolean {
  return cause instanceof Error && cause.message.includes("No handler registered for 'assetLibrary:")
}

interface Props { mode: 'floating' | 'workspace'; active?: boolean; onClose?: () => void; onOpenWorkspace?: () => void }

/**
 * 资产库表面：工作区页面与浮动资产面板共用（界面重设计 3.3）。
 *
 * 骨架只有一条命令带：工作区是页头那一条（返回 · 标题 + 数量 ｜ 搜索、类型、排序、标签、显示设置、批量管理），
 * 浮动面板是网格上方那一条（同一组筛选 + 完整管理 + 关闭）。批量管理是一种模式，不用主按钮表达：
 * 进入后命令带换成“已选择 N 项 · 完成”，右侧出现批量操作侧栏。显示设置收进命令带的浮层，不再单占底部一条。
 */
export const AssetLibrarySurface: React.FC<Props> = ({ mode, active = true, onClose, onOpenWorkspace }) => {
  const { t } = useI18n('ui')
  const libraryId = useAssetLibraryStore((state) => state.libraryId)
  const keyword = useAssetLibraryStore((state) => state.keyword)
  const mediaType = useAssetLibraryStore((state) => state.mediaType)
  const sort = useAssetLibraryStore((state) => state.sort)
  const selected = useAssetLibraryStore((state) => state.selectedAsset)
  const setLibraryId = useAssetLibraryStore((state) => state.setLibraryId)
  const setKeyword = useAssetLibraryStore((state) => state.setKeyword)
  const setMediaType = useAssetLibraryStore((state) => state.setMediaType)
  const setSort = useAssetLibraryStore((state) => state.setSort)
  const setSelected = useAssetLibraryStore((state) => state.setSelectedAsset)
  const batchMode = useAssetLibraryStore((state) => state.batchMode)
  const batchSelectedIds = useAssetLibraryStore((state) => state.batchSelectedIds)
  const enterBatchMode = useAssetLibraryStore((state) => state.enterBatchMode)
  const toggleBatchAsset = useAssetLibraryStore((state) => state.toggleBatchAsset)
  const setBatchSelectedIds = useAssetLibraryStore((state) => state.setBatchSelectedIds)
  const exitBatchMode = useAssetLibraryStore((state) => state.exitBatchMode)
  const cardSize = useSettingsStore((state) => state.assetCardSize)
  const thumbnailFit = useSettingsStore((state) => state.assetThumbnailFit)
  const setCardSize = useSettingsStore((state) => state.setAssetCardSize)
  const setThumbnailFit = useSettingsStore((state) => state.setAssetThumbnailFit)

  const [libraries, setLibraries] = useState<AssetLibraryRecord[]>([])
  const [page, setPage] = useState<AssetPage>(EMPTY_PAGE)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuState, setMenuState] = useState<{ asset: AssetRecord; anchor: Element | AssetMenuAnchor } | null>(null)
  const [previewAsset, setPreviewAsset] = useState<AssetRecord | null>(null)
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const queryVersionRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const wasActiveRef = useRef(active)
  const { width: sidebarWidth, startResize: startSidebarResize, resizeByKeyboard: resizeSidebarByKeyboard } = useAssetSidebarResize()
  const { menuVisible: blankMenuVisible, menuPosition: blankMenuPosition, menuItems: blankMenuItems, showMenu: showBlankMenu, hideMenu: hideBlankMenu } = useContextMenu()
  const workspaceBatchMode = mode === 'workspace' && batchMode
  useEffect(() => { if (!active) setPreviewAsset(null) }, [active])
  const selectedBatchAssets = page.items.filter((asset) => batchSelectedIds.includes(asset.id))

  const refreshLibraries = useCallback(async (): Promise<void> => {
    const [nextLibraries, nextTags] = await Promise.all([listAssetLibraries(), listAssetTags()])
    setLibraries(nextLibraries)
    setAvailableTags(nextTags)
    setSelectedTag((current) => current && !nextTags.includes(current) ? null : current)
  }, [])

  /**
   * 新登记的资产在主进程后台检查（尺寸、时长、封面）；视频要跑探测与抽帧，查询时常仍是 pending。
   * 列表没有变更推送，只靠这一次查询会让视频卡一直没有封面，直到重开面板。这里经正式检查入口
   * 等这些条目（主进程会并入正在进行的检查，不重复执行）完成后原位替换；查询已换代就丢弃。
   */
  const settlePendingInspections = useCallback(async (items: readonly AssetRecord[], version: number): Promise<void> => {
    const pendingIds = items.filter((asset) => asset.inspectionStatus === 'pending').map((asset) => asset.id)
    if (pendingIds.length === 0) return
    try {
      const inspected = new Map((await inspectAssets(pendingIds)).map((asset) => [asset.id, asset]))
      if (version !== queryVersionRef.current) return
      setPage((current) => ({ ...current, items: current.items.map((asset) => inspected.get(asset.id) ?? asset) }))
    } catch (cause) {
      logger.warn('等待资产后台检查完成失败，列表保留检查前的状态', cause, { event: 'asset.ui.pending_inspection.failed', context: { count: pendingIds.length } })
    }
  }, [])

  const loadAssets = useCallback(async (pageNumber: number, replace: boolean): Promise<void> => {
    const version = replace ? ++queryVersionRef.current : queryVersionRef.current
    if (replace) {
      setLoading(true)
      setError(null)
    } else {
      if (loadingMoreRef.current) return
      loadingMoreRef.current = true
      setLoadingMore(true)
    }
    try {
      const result = await queryAssets({
        libraryId: libraryId ?? undefined,
        keyword: keyword.trim() || undefined,
        mediaType: mediaType ?? undefined,
        tag: selectedTag ?? undefined,
        sort,
        page: pageNumber,
        pageSize: mode === 'floating' ? 30 : 48,
      })
      if (version !== queryVersionRef.current) return
      setPage((current) => ({ ...result, items: replace ? result.items : [...current.items, ...result.items] }))
      void settlePendingInspections(result.items, version)
    } catch (cause) {
      logger.error('资产查询失败', cause, { event: 'asset.ui.query.failed' })
      if (version === queryVersionRef.current) setError(isMissingAssetLibraryHandler(cause) ? t('assetLibrary.restartRequired') : cause instanceof Error ? cause.message : t('assetLibrary.error'))
    } finally {
      if (replace && version === queryVersionRef.current) setLoading(false)
      if (!replace) {
        loadingMoreRef.current = false
        setLoadingMore(false)
      }
    }
  }, [keyword, libraryId, mediaType, mode, selectedTag, settlePendingInspections, sort, t])

  useEffect(() => {
    void refreshLibraries().catch((cause) => {
      logger.error('资产库查询失败', cause, { event: 'asset.ui.libraries.failed' })
      if (isMissingAssetLibraryHandler(cause)) setError(t('assetLibrary.restartRequired'))
    })
  }, [refreshLibraries, t])
  useEffect(() => {
    const becameActive = active && !wasActiveRef.current
    wasActiveRef.current = active
    if (!becameActive) return
    void refreshLibraries().catch((cause) => logger.error('资产库重新打开时刷新失败', cause, { event: 'asset.ui.reopen_refresh.failed' }))
    void loadAssets(1, true)
  }, [active, loadAssets, refreshLibraries])
  useEffect(() => {
    queryVersionRef.current += 1
    scrollRef.current?.scrollTo({ top: 0 })
    void loadAssets(1, true)
  }, [loadAssets])
  useEffect(() => {
    const root = scrollRef.current
    const target = loadMoreRef.current
    if (!root || !target || loading || error || page.items.length >= page.total) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadAssets(page.page + 1, false)
    }, { root, rootMargin: '280px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [error, loadAssets, loading, page.items.length, page.page, page.total])

  const mutate = async (operation: () => Promise<unknown>, refreshLibraryList = false): Promise<void> => {
    try {
      await operation()
      if (refreshLibraryList) await refreshLibraries()
      await loadAssets(1, true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('assetLibrary.error'))
    }
  }
  const rename = async (asset: AssetRecord, name: string): Promise<void> => { await mutate(() => updateAsset(asset.id, name)) }
  const selectSystemView = (nextMediaType: AssetMediaType | null, nextSort: 'created' | 'recent'): void => {
    setLibraryId(null)
    setMediaType(nextMediaType)
    setSort(nextSort)
  }
  const deleteLibrary = async (library: AssetLibraryRecord): Promise<void> => {
    if (libraryId === library.id) setLibraryId(null)
    await mutate(() => deleteAssetLibrary(library.id), true)
  }
  const startBatchManagement = (initialAssetIds: string[] = []): void => {
    setMenuState(null)
    hideBlankMenu()
    setBatchError(null)
    if (batchMode) setBatchSelectedIds([...batchSelectedIds, ...initialAssetIds])
    else enterBatchMode(initialAssetIds)
    if (mode === 'floating') onOpenWorkspace?.()
  }
  const handleBlankContextMenu = (event: React.MouseEvent): void => {
    const target = event.target as HTMLElement
    if (target.closest('[data-asset-card], [data-asset-card-menu]')) return
    showBlankMenu(event, [{
      id: 'batch-manage',
      label: t('assetLibrary.batchEmptyMenu'),
      icon: <ICON_MULTI_SELECT className="h-4 w-4" />,
      onClick: () => startBatchManagement(),
    }])
  }
  const applyBatchResult = async (result: AssetBatchResult, removeSucceeded: boolean): Promise<void> => {
    if (removeSucceeded) setBatchSelectedIds(useAssetLibraryStore.getState().batchSelectedIds.filter((id) => !result.succeededIds.includes(id)))
    setBatchError(result.failures.length > 0 ? t('assetLibrary.batchPartialFailure', { count: result.failures.length }) : null)
    await Promise.all([refreshLibraries(), loadAssets(1, true)])
  }
  const runBatchOperation = async (operation: () => Promise<AssetBatchResult>, removeSucceeded = false): Promise<void> => {
    if (selectedBatchAssets.length === 0 || batchBusy) {
      if (selectedBatchAssets.length === 0) setBatchError(t('assetLibrary.batchNoSelection'))
      return
    }
    setBatchBusy(true)
    setBatchError(null)
    try {
      await applyBatchResult(await operation(), removeSucceeded)
    } catch (cause) {
      logger.error('批量资产操作失败', cause, { event: 'asset.ui.batch.failed' })
      setBatchError(cause instanceof Error ? cause.message : t('assetLibrary.error'))
    } finally {
      setBatchBusy(false)
    }
  }

  // 视图控制（静默触发器）：工作区放在页头命令带，浮动面板放在网格上方那一条。
  const viewControls = (
    <>
      <div className={`relative ${mode === 'workspace' ? 'w-56 shrink' : 'min-w-[150px] flex-1'}`}>
        <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text3" />
        <UiInput className="pl-8" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t('assetLibrary.search')} aria-label={t('assetLibrary.search')} />
      </div>
      <Dropdown<'all' | AssetMediaType> appearance="text" value={mediaType ?? 'all'} options={[{ value: 'all', label: t('assetLibrary.allTypes') }, { value: 'image', label: t('assetLibrary.image') }, { value: 'video', label: t('assetLibrary.video') }, { value: 'audio', label: t('assetLibrary.audio') }, { value: 'code', label: t('assetLibrary.code') }]} onSelect={(value) => setMediaType(value === 'all' ? null : value)} className="shrink-0" buttonClassName="w-auto" minWidthStrategy="options" panelWidthStrategy="options" />
      <Dropdown<'created' | 'recent'> appearance="text" value={sort} options={[{ value: 'created', label: t('assetLibrary.newest') }, { value: 'recent', label: t('assetLibrary.recent') }]} onSelect={setSort} className="shrink-0" buttonClassName="w-auto" minWidthStrategy="options" panelWidthStrategy="options" />
      <Dropdown<string> appearance="text" value={selectedTag ?? ''} options={[{ value: '', label: t('assetLibrary.allTags') }, ...availableTags.map((tag) => ({ value: tag, label: tag }))]} onSelect={(value) => setSelectedTag(value || null)} className="shrink-0" buttonClassName="w-auto max-w-40" minWidthStrategy="options" panelWidthStrategy="options" />
      <PanelTrigger
        panelWidth={256}
        renderPanel={() => (
          <div data-asset-view-settings className="space-y-4 p-3">
            <div>
              <div className={UI_FIELD_LABEL_CLASS}>{t('assetLibrary.thumbnailSize')}</div>
              <UiRangeInput aria-label={t('assetLibrary.thumbnailSize')} min={112} max={280} step={8} value={cardSize} onChange={(event) => setCardSize(Number(event.target.value))} />
            </div>
            <div>
              <div className={UI_FIELD_LABEL_CLASS}>{t('assetLibrary.thumbnailFit')}</div>
              <div role="radiogroup" aria-label={t('assetLibrary.thumbnailFit')} className={`${UI_SEGMENTED_TRACK_CLASS} w-full`}>
                {(['cover', 'contain'] as const).map((fit) => (
                  <UiOptionButton
                    key={fit}
                    variant="segment"
                    role="radio"
                    aria-checked={thumbnailFit === fit}
                    active={thumbnailFit === fit}
                    title={t(fit === 'cover' ? 'assetLibrary.fitCoverHint' : 'assetLibrary.fitContainHint')}
                    className="flex-1"
                    onClick={() => setThumbnailFit(fit)}
                  >
                    {t(fit === 'cover' ? 'assetLibrary.fitCover' : 'assetLibrary.fitContain')}
                  </UiOptionButton>
                ))}
              </div>
            </div>
          </div>
        )}
      >
        {({ open, togglePanel }) => (
          <UiIconButton
            type="button"
            aria-haspopup="dialog"
            aria-expanded={open}
            on={open}
            title={t('assetLibrary.viewSettings')}
            aria-label={t('assetLibrary.viewSettings')}
            data-panel-trigger-button
            onClick={togglePanel}
          >
            <Settings2 className="h-4 w-4" />
          </UiIconButton>
        )}
      </PanelTrigger>
    </>
  )

  const workspaceActions = workspaceBatchMode ? (
    <>
      <span className={UI_TEXT_META_CLASS}>{t('assetLibrary.loadedCount', { loaded: page.items.length, count: page.total })}</span>
      <span className="text-13 font-medium text-text1">{t('assetLibrary.batchSelected', { count: selectedBatchAssets.length })}</span>
      <UiButton variant="secondary" disabled={batchBusy} onClick={exitBatchMode}>{t('assetLibrary.batchDone')}</UiButton>
    </>
  ) : (
    <>
      {viewControls}
      <UiButton onClick={() => startBatchManagement()}><ICON_MULTI_SELECT className="h-4 w-4" />{t('assetLibrary.batchManage')}</UiButton>
    </>
  )

  return (
    <div className={`relative flex h-full min-h-0 flex-col overflow-hidden text-text1 ${mode === 'floating' ? `z-raised ${UI_GLASS_ADAPTIVE_REGION_CLASS}` : 'bg-window'}`}>
      {mode === 'workspace' && (
        <UiPageHeader
          className={`h-14 shrink-0 border-b px-4 ${UI_GLASS_ADAPTIVE_DIVIDER_CLASS}`}
          title={t('assetLibrary.categories')}
          meta={t('assetLibrary.count', { count: page.total })}
          onBack={onClose}
          backLabel={t('assetLibrary.back')}
          actions={workspaceActions}
        />
      )}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AssetLibrarySidebar
          libraries={libraries}
          activeId={libraryId}
          activeMediaType={mediaType}
          activeSort={sort}
          labels={{
            all: t('assetLibrary.all'), recent: t('assetLibrary.recent'), image: t('assetLibrary.image'), video: t('assetLibrary.video'), audio: t('assetLibrary.audio'), code: t('assetLibrary.code'),
            categories: t('assetLibrary.categories'), create: t('assetLibrary.createLibrary'), placeholder: t('assetLibrary.libraryName'), confirmDelete: t('assetLibrary.confirmDeleteLibrary'),
            rename: t('assetLibrary.renameAsset'), delete: t('assetLibrary.deleteAsset'), confirm: t('assetLibrary.confirm'), cancel: t('cancel'),
          }}
          onShowAll={() => selectSystemView(null, 'created')}
          onShowRecent={() => selectSystemView(null, 'recent')}
          onShowMediaType={(type) => selectSystemView(type, 'created')}
          onSelect={(id) => setLibraryId(id)}
          onCreate={(name) => mutate(() => createAssetLibrary(name), true)}
          onRename={(library, name) => mutate(() => renameAssetLibrary(library.id, name), true)}
          onDelete={deleteLibrary}
          width={mode === 'workspace' ? sidebarWidth : undefined}
        />
        {mode === 'workspace' && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="调整资产库侧栏宽度"
            tabIndex={0}
            onPointerDown={startSidebarResize}
            onKeyDown={resizeSidebarByKeyboard}
            className="group relative z-raised -ml-1 flex w-2 shrink-0 cursor-col-resize items-center justify-center outline-none"
            style={{ touchAction: 'none' }}
          >
            <span className="h-full w-0.5 bg-transparent transition-colors duration-120 group-hover:bg-accent group-focus-visible:bg-accent" />
            <GripVertical className="absolute h-4 w-4 text-text3 opacity-0 transition-opacity duration-120 group-hover:opacity-100 group-focus-visible:opacity-100" />
          </div>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          {mode === 'floating' && (
            <header className="flex h-12 shrink-0 items-center gap-2 px-3">
              {viewControls}
              <UiButton className="shrink-0" onClick={onOpenWorkspace}>{t('assetLibrary.manage')}</UiButton>
              {onClose && <UiIconButton className="shrink-0" title={t('assetLibrary.close')} aria-label={t('assetLibrary.close')} onClick={onClose}><X className="h-4 w-4" /></UiIconButton>}
            </header>
          )}
          <UiSharedGlassHost ref={scrollRef} minTargets={4} onContextMenu={handleBlankContextMenu} className={`min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable] ${mode === 'workspace' ? 'p-4' : 'px-3 pb-3 pt-1'}`}>
            {loading && page.items.length === 0 ? (
              <div className={`absolute overflow-hidden ${mode === 'workspace' ? 'inset-4' : 'inset-3'}`} aria-busy="true">
                <div className="grid gap-x-3 gap-y-4" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${cardSize}px,1fr))` }}>{Array.from({ length: 12 }).map((_, index) => <div key={index} className="aspect-square animate-pulse rounded-lg bg-panel" />)}</div>
              </div>
            ) : error ? (
              <UiError
                className="h-full"
                message={error}
                onRetry={() => void loadAssets(1, true)}
                retryLabel={t('assetLibrary.retry')}
              />
            ) : page.items.length === 0 ? (
              <UiEmpty
                className="h-full"
                icon={<FolderPlus className="h-10 w-10" />}
                title={keyword || mediaType || libraryId ? t('assetLibrary.noResults') : t('assetLibrary.empty')}
              />
            ) : (
              <>
                <div className={`grid gap-x-3 gap-y-4 transition-opacity duration-120 ${loading ? 'pointer-events-none opacity-60' : 'opacity-100'}`} aria-busy={loading} style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${cardSize}px,1fr))` }}>
                  {page.items.map((asset) => (
                    <AssetCard
                      key={asset.id}
                      asset={asset}
                      selected={selected?.id === asset.id}
                      eager={mode === 'floating'}
                      thumbnailFit={thumbnailFit}
                      menuOpen={menuState?.asset.id === asset.id}
                      batchMode={workspaceBatchMode}
                      batchSelected={batchSelectedIds.includes(asset.id)}
                      batchDisabled={batchBusy}
                      onSelect={setSelected}
                      onToggleBatch={(nextAsset) => toggleBatchAsset(nextAsset.id)}
                      onMenu={(nextAsset, anchor, toggle) => setMenuState((current) => toggle && current?.asset.id === nextAsset.id ? null : { asset: nextAsset, anchor })}
                      onPreview={setPreviewAsset}
                      onRename={rename}
                    />
                  ))}
                </div>
                <div ref={loadMoreRef} className={`flex h-14 items-center justify-center ${UI_TEXT_META_CLASS}`}>{loadingMore ? <><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />{t('assetLibrary.loadingMore')}</> : page.items.length < page.total ? t('assetLibrary.scrollForMore') : t('assetLibrary.allLoaded')}</div>
              </>
            )}
          </UiSharedGlassHost>
        </main>
        {workspaceBatchMode && (
          <AssetBatchManager
            selectedCount={selectedBatchAssets.length}
            loadedCount={page.items.length}
            libraries={libraries}
            availableTags={availableTags}
            busy={batchBusy}
            error={batchError}
            onSelectAll={() => setBatchSelectedIds(page.items.map((asset) => asset.id))}
            onClear={() => { setBatchSelectedIds([]); setBatchError(null) }}
            onUpdateTags={(tags, operation) => runBatchOperation(() => updateAssetTagsBatch(selectedBatchAssets, tags, operation))}
            onUpdateLibrary={(nextLibraryId, operation) => runBatchOperation(() => updateAssetLibraryBatch(selectedBatchAssets, nextLibraryId, operation))}
            onDelete={() => runBatchOperation(() => deleteAssetsBatch(selectedBatchAssets), true)}
          />
        )}
      </div>
      <AssetPreviewOverlay asset={active ? previewAsset : null} onClose={() => setPreviewAsset(null)} />
      <ContextMenu items={blankMenuItems} position={blankMenuPosition} onClose={hideBlankMenu} visible={blankMenuVisible} />
      {menuState && <AssetCardMenu key={menuState.asset.id} asset={menuState.asset} anchor={menuState.anchor} libraries={libraries} availableTags={availableTags} onClose={() => setMenuState(null)} onToggleLibrary={async (nextLibraryId, included) => { await (included ? addAssetToLibrary(nextLibraryId, menuState.asset.id) : removeAssetFromLibrary(nextLibraryId, menuState.asset.id)); await loadAssets(1, true) }} onSetTags={async (tags) => { await setAssetTags(menuState.asset.id, tags); await refreshLibraries(); await loadAssets(1, true) }} onRename={async (name) => { await rename(menuState.asset, name) }} onDelete={async () => { const assetId = menuState.asset.id; await deleteAsset(assetId); if (selected?.id === assetId) setSelected(null); await loadAssets(1, true) }} onOpenBatchManagement={() => startBatchManagement([menuState.asset.id])} />}
    </div>
  )
}
