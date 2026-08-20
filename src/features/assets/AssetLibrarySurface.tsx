import React, { useCallback, useEffect, useRef, useState } from 'react'
import { CheckSquare2, ChevronLeft, ChevronRight, FolderPlus, GripVertical, LoaderCircle, Search, X } from 'lucide-react'
import { Dropdown, UI_GLASS_ADAPTIVE_REGION_CLASS, UI_TEXT_META_CLASS, UiButton, UiChipButton, UiEmpty, UiError, UiIconButton, UiInput, UiRangeInput, UiSharedGlassHost } from '@/components/ui'
import type { AssetLibraryRecord, AssetMediaType, AssetPage, AssetRecord } from '@/platform/contracts/assetLibrary'
import { addAssetToLibrary, createAssetLibrary, deleteAsset, deleteAssetLibrary, listAssetLibraries, listAssetTags, queryAssets, removeAssetFromLibrary, renameAssetLibrary, setAssetTags, updateAsset } from '@/commands/assetLibrary'
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
  const [menuState, setMenuState] = useState<{ asset: AssetRecord; anchor: AssetMenuAnchor } | null>(null)
  const [previewAsset, setPreviewAsset] = useState<AssetRecord | null>(null)
  const [availableTags, setAvailableTags] = useState<string[]>([])
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [thumbnailControlsOpen, setThumbnailControlsOpen] = useState(false)
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchError, setBatchError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const thumbnailControlsRef = useRef<HTMLDivElement>(null)
  const queryVersionRef = useRef(0)
  const loadingMoreRef = useRef(false)
  const wasActiveRef = useRef(active)
  const { width: sidebarWidth, startResize: startSidebarResize, resizeByKeyboard: resizeSidebarByKeyboard } = useAssetSidebarResize()
  const { menuVisible: blankMenuVisible, menuPosition: blankMenuPosition, menuItems: blankMenuItems, showMenu: showBlankMenu, hideMenu: hideBlankMenu } = useContextMenu()
  const workspaceBatchMode = mode === 'workspace' && batchMode
  const selectedBatchAssets = page.items.filter((asset) => batchSelectedIds.includes(asset.id))

  const refreshLibraries = useCallback(async (): Promise<void> => {
    const [nextLibraries, nextTags] = await Promise.all([listAssetLibraries(), listAssetTags()])
    setLibraries(nextLibraries)
    setAvailableTags(nextTags)
    setSelectedTag((current) => current && !nextTags.includes(current) ? null : current)
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
  }, [keyword, libraryId, mediaType, mode, selectedTag, sort, t])

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
  useEffect(() => {
    if (!thumbnailControlsOpen) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (!thumbnailControlsRef.current?.contains(event.target as Node)) setThumbnailControlsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [thumbnailControlsOpen])

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
      icon: <CheckSquare2 className="h-4 w-4" />,
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

  return (
    <div className={`relative flex h-full min-h-0 flex-col overflow-hidden text-text-dark ${mode === 'floating' ? `z-raised ${UI_GLASS_ADAPTIVE_REGION_CLASS}` : 'bg-app'}`}>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AssetLibrarySidebar
          libraries={libraries}
          activeId={libraryId}
          activeMediaType={mediaType}
          activeSort={sort}
          labels={{
            all: t('assetLibrary.all'), recent: t('assetLibrary.recent'), image: t('assetLibrary.image'), video: t('assetLibrary.video'), audio: t('assetLibrary.audio'),
            categories: t('assetLibrary.categories'), create: t('assetLibrary.createLibrary'), placeholder: t('assetLibrary.libraryName'), confirmDelete: t('assetLibrary.confirmDeleteLibrary'),
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
            className="group relative z-raised flex w-2 shrink-0 cursor-col-resize items-center justify-center outline-none"
            style={{ touchAction: 'none' }}
          >
            <span className="h-full w-px bg-border-dark transition-colors group-hover:bg-accent group-focus-visible:bg-accent" />
            <GripVertical className="absolute h-4 w-4 text-text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </div>
        )}
        <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 px-3">
          {workspaceBatchMode ? (
            <>
              <span className="font-medium text-text-dark">{t('assetLibrary.batchSelected', { count: selectedBatchAssets.length })}</span>
              <span className={UI_TEXT_META_CLASS}>{t('assetLibrary.loadedCount', { loaded: page.items.length, count: page.total })}</span>
              <div className="flex-1" />
              <UiButton variant="primary" disabled={batchBusy} className="!h-10 shrink-0 px-4" onClick={exitBatchMode}>{t('assetLibrary.batchDone')}</UiButton>
            </>
          ) : (
            <>
              {mode === 'workspace' && <span className={`hidden shrink-0 min-[1200px]:inline ${UI_TEXT_META_CLASS}`}>{t('assetLibrary.count', { count: page.total })}</span>}
              <div className="relative min-w-[150px] flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" /><UiInput className="!h-10 pl-9" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder={t('assetLibrary.search')} /></div>
              <Dropdown<'all' | AssetMediaType> value={mediaType ?? 'all'} options={[{ value: 'all', label: t('assetLibrary.allTypes') }, { value: 'image', label: t('assetLibrary.image') }, { value: 'video', label: t('assetLibrary.video') }, { value: 'audio', label: t('assetLibrary.audio') }]} onSelect={(value) => setMediaType(value === 'all' ? null : value)} className="shrink-0" buttonClassName="!h-10 !px-3" minWidthStrategy="options" panelWidthStrategy="button" />
              <Dropdown<'created' | 'recent'> value={sort} options={[{ value: 'created', label: t('assetLibrary.newest') }, { value: 'recent', label: t('assetLibrary.recent') }]} onSelect={setSort} className="shrink-0" buttonClassName="!h-10 !px-3" minWidthStrategy="options" panelWidthStrategy="button" />
              <Dropdown<string> value={selectedTag ?? ''} options={[{ value: '', label: t('assetLibrary.allTags') }, ...availableTags.map((tag) => ({ value: tag, label: tag }))]} onSelect={(value) => setSelectedTag(value || null)} className="shrink-0" buttonClassName="!h-10 !px-3" minWidthStrategy="options" panelWidthStrategy="button" />
              {mode === 'floating' && <UiButton variant="primary" className="!h-10 shrink-0 px-4" onClick={onOpenWorkspace}>{t('assetLibrary.manage')}</UiButton>}
              {mode === 'workspace' && <UiButton variant="primary" className="!h-10 shrink-0 px-4" onClick={() => startBatchManagement()}>{t('assetLibrary.batchManage')}</UiButton>}
              {onClose && <UiIconButton appearance="hover-only" className="!h-10 !w-10 shrink-0" onClick={onClose}><X className="h-4 w-4" /></UiIconButton>}
            </>
          )}
        </header>
        <UiSharedGlassHost ref={scrollRef} minTargets={4} onContextMenu={handleBlankContextMenu} className="min-h-0 flex-1 overflow-y-auto p-3 [scrollbar-gutter:stable]">
          {loading && page.items.length === 0 ? (
            <div className="absolute inset-3 overflow-hidden" aria-busy="true">
              <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${cardSize}px,1fr))` }}>{Array.from({ length: 12 }).map((_, index) => <div key={index} className="aspect-square animate-pulse rounded-xl bg-layer" />)}</div>
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
              <div className={`grid gap-3 transition-opacity duration-150 ${loading ? 'pointer-events-none opacity-60' : 'opacity-100'}`} aria-busy={loading} style={{ gridTemplateColumns: `repeat(auto-fill,minmax(${cardSize}px,1fr))` }}>
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
        <footer className="flex h-12 shrink-0 items-center justify-end px-3 text-text-muted">
          <div ref={thumbnailControlsRef} className="flex items-center justify-end gap-1.5 overflow-hidden">
            <div className={`relative z-0 overflow-hidden transition-[width,transform] duration-200 ease-out ${thumbnailControlsOpen ? 'w-[300px] translate-x-0' : 'pointer-events-none w-0 translate-x-3'}`} aria-hidden={!thumbnailControlsOpen}>
              <div className={`flex w-[300px] items-center gap-1.5 transition-opacity ${thumbnailControlsOpen ? 'delay-150 duration-150 opacity-100' : 'delay-0 duration-150 opacity-0'}`}>
                <div className="mr-1 w-32 shrink-0">
                  <UiRangeInput aria-label={t('assetLibrary.thumbnailSize')} title={t('assetLibrary.thumbnailSize')} tabIndex={thumbnailControlsOpen ? 0 : -1} min={112} max={280} step={8} value={cardSize} onChange={(event) => setCardSize(Number(event.target.value))} />
                </div>
                <UiChipButton tabIndex={thumbnailControlsOpen ? 0 : -1} className="!h-8 shrink-0 !px-2.5 text-xs" active={thumbnailFit === 'cover'} onClick={() => setThumbnailFit('cover')}>{t('assetLibrary.fitCover')}</UiChipButton>
                <UiChipButton tabIndex={thumbnailControlsOpen ? 0 : -1} className="!h-8 shrink-0 !px-2.5 text-xs" active={thumbnailFit === 'contain'} onClick={() => setThumbnailFit('contain')}>{t('assetLibrary.fitContain')}</UiChipButton>
              </div>
            </div>
            <UiIconButton className="relative z-10 !h-8 !w-8 shrink-0 bg-surface-dark" onClick={() => setThumbnailControlsOpen((open) => !open)} title={t('assetLibrary.viewSettings')}>
              {thumbnailControlsOpen ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
            </UiIconButton>
          </div>
        </footer>
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
            onDone={exitBatchMode}
          />
        )}
      </div>
      <AssetPreviewOverlay asset={previewAsset} onClose={() => setPreviewAsset(null)} />
      <ContextMenu owner="assets" items={blankMenuItems} position={blankMenuPosition} onClose={hideBlankMenu} visible={blankMenuVisible} />
      {menuState && <AssetCardMenu key={menuState.asset.id} asset={menuState.asset} anchor={menuState.anchor} libraries={libraries} availableTags={availableTags} onClose={() => setMenuState(null)} onToggleLibrary={async (nextLibraryId, included) => { await (included ? addAssetToLibrary(nextLibraryId, menuState.asset.id) : removeAssetFromLibrary(nextLibraryId, menuState.asset.id)); await loadAssets(1, true) }} onSetTags={async (tags) => { await setAssetTags(menuState.asset.id, tags); await refreshLibraries(); await loadAssets(1, true) }} onRename={async (name) => { await rename(menuState.asset, name) }} onDelete={async () => { const assetId = menuState.asset.id; await deleteAsset(assetId); if (selected?.id === assetId) setSelected(null); await loadAssets(1, true) }} onOpenBatchManagement={() => startBatchManagement([menuState.asset.id])} />}
    </div>
  )
}
