/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import { AssetLibrarySurface } from './AssetLibrarySurface'
import { useAssetLibraryStore } from './store/assetLibraryStore'
import { resolveUiOverlayTarget, UiOverlayLayerProvider, useUiOverlayLayer } from '@/components/ui/overlayOwnership'

const mocks = vi.hoisted(() => ({
  query: vi.fn(), inspect: vi.fn(), readCode: vi.fn(), touch: vi.fn(), libraries: vi.fn(), tags: vi.fn(), t: (key: string) => key,
  settings: { assetCardSize: 160, assetThumbnailFit: 'cover', setAssetCardSize: vi.fn(), setAssetThumbnailFit: vi.fn() },
}))
vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: mocks.t }) }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn() }) }))
vi.mock('@/stores/settingsStore', () => ({ useSettingsStore: (selector: (state: typeof mocks.settings) => unknown) => selector(mocks.settings) }))
vi.mock('@/hooks/useWaveformData', () => ({ useWaveformData: () => ({ status: 'idle' }) }))
vi.mock('./hooks/useAssetSidebarResize', () => ({ useAssetSidebarResize: () => ({ width: 208, startResize: vi.fn(), resizeByKeyboard: vi.fn() }) }))
vi.mock('@/components/mediaViewer/ImageViewerModal', () => ({ ImageViewerModal: () => null }))
vi.mock('@/components/mediaViewer/VideoViewerModal', () => ({ VideoViewerModal: () => null }))
vi.mock('@/components/mediaViewer/AudioViewerModal', () => ({ AudioViewerModal: () => null }))
vi.mock('@/components/ui/useDialogTransition', () => ({ useDialogTransition: (open: boolean) => ({ shouldRender: open, isVisible: open }) }))
vi.mock('@/features/videoEdit/application/videoEditService', () => ({ activeVideoEditInstance: () => undefined, subscribeVideoEdit: () => () => undefined, subscribeVideoEditDomain: () => () => undefined }))
vi.mock('@/features/videoEdit/application/videoEditCodeAssets', () => ({ readVideoEditCodeAsset: mocks.readCode, importVideoEditCodeAsset: vi.fn() }))
vi.mock('@/commands/assetLibrary', () => ({
  queryAssets: mocks.query, listAssetLibraries: mocks.libraries, listAssetTags: mocks.tags, touchAsset: mocks.touch,
  addAssetToLibrary: vi.fn(), createAssetLibrary: vi.fn(), deleteAsset: vi.fn(), deleteAssetLibrary: vi.fn(),
  removeAssetFromLibrary: vi.fn(), renameAssetLibrary: vi.fn(), setAssetTags: vi.fn(), updateAsset: vi.fn(),
  inspectAsset: vi.fn(), inspectAssets: mocks.inspect, inspectAssetLibrary: vi.fn(), restoreAssetLibrary: vi.fn(),
}))

const asset: AssetRecord = {
  id: 'library-code', mediaType: 'code', displayName: '库中代码', filePath: 'C:/library/code.henji-code', displayUrl: 'henji-media://local/code.henji-code', source: 'video-edit',
  mimeType: 'application/x-henji-code', sizeBytes: 100, width: null, height: null, durationSeconds: null, thumbnailPath: null, thumbnailUrl: null,
  inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1, contentIdentity: 'a'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [],
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.query.mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 48 })
  mocks.libraries.mockResolvedValue([]); mocks.tags.mockResolvedValue([])
  mocks.readCode.mockReset()
  mocks.touch.mockResolvedValue(undefined)
  useAssetLibraryStore.setState({ view: 'workspace', libraryId: null, keyword: '', mediaType: null, sort: 'created', batchMode: false, selectedAsset: null, batchSelectedIds: [] })
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  HTMLElement.prototype.scrollTo = (_optionsOrX?: ScrollToOptions | number, _y?: number): void => undefined
})
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('资产库代码类型入口', () => {
  it('侧栏代码筛选沿原store和查询，选择系统类型退出当前分类', async () => {
    useAssetLibraryStore.setState({ libraryId: 'library-a', keyword: '形状' })
    render(<AssetLibrarySurface mode="workspace" />)
    await waitFor(() => expect(mocks.query).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.code' }))
    await waitFor(() => expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ mediaType: 'code', libraryId: undefined, keyword: '形状' })))
    expect(useAssetLibraryStore.getState().mediaType).toBe('code')
  })

  it('类型下拉提供代码并保留原资产查询入口', async () => {
    render(<AssetLibrarySurface mode="floating" />)
    await waitFor(() => expect(mocks.query).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.allTypes' }))
    fireEvent.click(await screen.findByRole('option', { name: 'assetLibrary.code' }))
    await waitFor(() => expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ mediaType: 'code', pageSize: 30 })))
  })

  it('工作区隐藏立即卸载代码读取，迟到结果不能重新弹出', async () => {
    mocks.query.mockResolvedValue({ items: [asset], total: 1, page: 1, pageSize: 48 })
    let resolve!: (value: unknown) => void
    mocks.readCode.mockReturnValue(new Promise(yes => { resolve = yes }))
    const view = render(<AssetLibrarySurface mode="workspace" />)
    await screen.findByText('库中代码')
    fireEvent.doubleClick(document.querySelector('[data-asset-id="library-code"] .aspect-square')!)
    await waitFor(() => expect(mocks.readCode).toHaveBeenCalledOnce())
    const signal = mocks.readCode.mock.calls[0][1] as AbortSignal
    view.rerender(<AssetLibrarySurface mode="workspace" active={false} />)
    expect(signal.aborted).toBe(true)
    await act(async () => resolve({ asset, manifest: { name: '旧完成', parameters: {}, images: [] } }))
    expect(screen.queryByRole('dialog')).toBeNull()
    view.rerender(<AssetLibrarySurface mode="workspace" active />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(mocks.readCode).toHaveBeenCalledOnce()
  })
})

describe('资产库命令带（界面重设计 3.3）', () => {
  it('工作区只有页头一条命令带：返回、标题与数量、筛选、显示设置、批量管理，没有主按钮', async () => {
    mocks.query.mockResolvedValue({ items: [asset], total: 1, page: 1, pageSize: 48 })
    const onClose = vi.fn()
    render(<AssetLibrarySurface mode="workspace" onClose={onClose} />)
    await screen.findByText('库中代码')
    const header = document.querySelector('[data-ui-page-header]') as HTMLElement
    expect(header.querySelector('[data-ui-page-title]')?.textContent).toBe('assetLibrary.categories')
    expect(screen.getByRole('textbox', { name: 'assetLibrary.search' }).closest('[data-ui-page-header]')).toBe(header)
    expect(screen.getByRole('button', { name: 'assetLibrary.viewSettings' }).closest('[data-ui-page-header]')).toBe(header)
    expect(screen.getByRole('button', { name: 'assetLibrary.batchManage' }).getAttribute('data-variant')).toBe('quiet')
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.back' }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('显示设置收进浮层：缩略图显示方式是单选分段，浮层算作资产面板的子浮层', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    // 模拟资产浮动面板这一层：显示设置浮层应被识别为它的后代层（任务 4.3 浮层归属）
    let panelLayerId = ''
    function PanelLayer(): React.ReactElement {
      const layer = useUiOverlayLayer(true)
      panelLayerId = layer.id
      return <div {...layer.layerProps}><UiOverlayLayerProvider id={layer.id}><AssetLibrarySurface mode="floating" /></UiOverlayLayerProvider></div>
    }
    render(<PanelLayer />)
    await waitFor(() => expect(mocks.query).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.viewSettings' }))
    const group = await screen.findByRole('radiogroup', { name: 'assetLibrary.thumbnailFit' })
    expect(resolveUiOverlayTarget(group, panelLayerId)).toBe('descendant')
    fireEvent.click(screen.getByRole('radio', { name: 'assetLibrary.fitContain' }))
    expect(mocks.settings.setAssetThumbnailFit).toHaveBeenCalledWith('contain')
  })

  it('批量管理是模式：命令带换成已选数量与“完成”，不出现主按钮', async () => {
    useAssetLibraryStore.setState({ batchMode: true, batchSelectedIds: [] })
    render(<AssetLibrarySurface mode="workspace" />)
    await waitFor(() => expect(mocks.query).toHaveBeenCalled())
    expect(screen.getByText('assetLibrary.batchSelected')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'assetLibrary.batchManage' })).toBeNull()
    expect(screen.getByRole('complementary', { name: 'assetLibrary.batchManage' })).toBeTruthy()
    expect(document.querySelectorAll('[data-variant="primary"]')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.batchDone' }))
    expect(useAssetLibraryStore.getState().batchMode).toBe(false)
  })
})

describe('资产后台检查（3.7：视频封面）', () => {
  const pendingVideo: AssetRecord = {
    ...asset, id: 'video-1', mediaType: 'video', displayName: '测试彩条视频', filePath: 'C:/assets/bars.mp4',
    displayUrl: 'henji-media://local/bars.mp4', mimeType: null, width: null, height: null, inspectionStatus: 'pending', contentIdentity: null,
  }
  const readyVideo: AssetRecord = {
    ...pendingVideo, mimeType: 'video/mp4', width: 640, height: 360, durationSeconds: 2, inspectionStatus: 'ready',
    thumbnailPath: 'C:/data/Thumbnails/bars.webp', thumbnailUrl: 'henji-media://local/bars.webp',
  }

  it('查询时仍在检查的视频，检查完成后原位换上封面与尺寸，不必重开面板', async () => {
    mocks.query.mockResolvedValue({ items: [pendingVideo], total: 1, page: 1, pageSize: 30 })
    let finish!: (value: AssetRecord[]) => void
    mocks.inspect.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    render(<AssetLibrarySurface mode="floating" />)
    await screen.findByText('测试彩条视频')
    expect(mocks.inspect).toHaveBeenCalledWith(['video-1'])
    expect(document.querySelector('[data-asset-id="video-1"] img')).toBeNull()
    await act(async () => finish([readyVideo]))
    await waitFor(() => expect(document.querySelector('[data-asset-id="video-1"] img')?.getAttribute('src')).toBe('henji-media://local/bars.webp'))
    expect(screen.getByText('640×360')).toBeTruthy()
  })

  it('全部已就绪时不额外检查；检查完成前查询已换代则丢弃旧结果', async () => {
    mocks.query.mockResolvedValueOnce({ items: [asset], total: 1, page: 1, pageSize: 30 })
    const view = render(<AssetLibrarySurface mode="floating" />)
    await screen.findByText('库中代码')
    expect(mocks.inspect).not.toHaveBeenCalled()

    let finishStale!: (value: AssetRecord[]) => void
    mocks.inspect.mockReturnValueOnce(new Promise((resolve) => { finishStale = resolve }))
    mocks.inspect.mockReturnValueOnce(new Promise(() => undefined))
    mocks.query.mockResolvedValueOnce({ items: [pendingVideo], total: 1, page: 1, pageSize: 30 })
    act(() => useAssetLibraryStore.setState({ keyword: '彩条' }))
    await screen.findByText('测试彩条视频')
    mocks.query.mockResolvedValueOnce({ items: [pendingVideo], total: 1, page: 1, pageSize: 30 })
    act(() => useAssetLibraryStore.setState({ keyword: '彩条视频' }))
    await waitFor(() => expect(mocks.inspect).toHaveBeenCalledTimes(2))
    // 旧查询的检查结果迟到：当前查询的检查仍未完成，界面不能被旧结果改写
    await act(async () => finishStale([readyVideo]))
    expect(view.container.querySelector('[data-asset-id="video-1"] img')).toBeNull()
  })
})

describe('资产库空态与失败态（5.6 第二批）', () => {
  it('只按标签筛选且没有命中时显示“没有符合条件”，不是“资产库还是空的”', async () => {
    mocks.tags.mockResolvedValue(['猫'])
    render(<AssetLibrarySurface mode="workspace" />)
    await screen.findByText('assetLibrary.empty')
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.allTags' }))
    fireEvent.click(await screen.findByRole('option', { name: '猫' }))
    await waitFor(() => expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ tag: '猫' })))
    expect(await screen.findByText('assetLibrary.noResults')).toBeTruthy()
    expect(screen.queryByText('assetLibrary.empty')).toBeNull()
  })

  it('列表读取失败有危险色标题与原因，并可重试', async () => {
    mocks.query.mockRejectedValueOnce(new Error('磁盘不可读'))
    render(<AssetLibrarySurface mode="workspace" />)
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('assetLibrary.error')
    expect(alert.textContent).toContain('磁盘不可读')
    expect(alert.querySelector('.text-danger-text')?.textContent).toBe('assetLibrary.error')
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.retry' }))
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull())
  })
})
