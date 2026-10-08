import { testCodeAssetSource } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import { createVideoEditTestDocument as createVideoEditDocument } from '../../../core/videoEdit/testFixtures'
/** @vitest-environment jsdom */
import React from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import type { VideoEditInstance } from '@/features/videoEdit/application/videoEditService'
import type { CodeAsset } from '@/core/videoEdit/codeAsset'

import { AssetPreviewOverlay } from './AssetPreviewOverlay'

const mocks = vi.hoisted(() => ({
  read: vi.fn(), import: vi.fn(), touch: vi.fn(),
  image: vi.fn((_props: Record<string, unknown>) => null), video: vi.fn((_props: Record<string, unknown>) => null), audio: vi.fn((_props: Record<string, unknown>) => null),
  owner: undefined as VideoEditInstance | undefined,
  listeners: new Set<() => void>(),
  t: (key: string) => key,
}))
vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: mocks.t }) }))
vi.mock('@/commands/assetLibrary', () => ({ touchAsset: mocks.touch }))
vi.mock('@/core/logging', () => ({ createLogger: () => ({ warn: vi.fn() }) }))
vi.mock('@/components/ui/useDialogTransition', () => ({ useDialogTransition: (open: boolean) => ({ shouldRender: open, isVisible: open }) }))
vi.mock('@/components/mediaViewer/ImageViewerModal', () => ({ ImageViewerModal: mocks.image }))
vi.mock('@/components/mediaViewer/VideoViewerModal', () => ({ VideoViewerModal: mocks.video }))
vi.mock('@/components/mediaViewer/AudioViewerModal', () => ({ AudioViewerModal: mocks.audio }))
vi.mock('@/features/videoEdit/application/videoEditCodeAssets', () => ({ readVideoEditCodeAsset: mocks.read, importVideoEditCodeAsset: mocks.import }))
vi.mock('@/features/videoEdit/application/videoEditService', () => ({
  activeVideoEditInstance: () => mocks.owner,
  subscribeVideoEditDomain: () => () => undefined,
  subscribeVideoEdit: (listener: () => void) => { mocks.listeners.add(listener); return () => mocks.listeners.delete(listener) },
}))

const asset: AssetRecord = {
  id: 'code-asset', mediaType: 'code', displayName: '代码卡片', filePath: 'C:/saved/source.henji-code', displayUrl: 'henji-media://local/source.henji-code', source: 'video-edit',
  mimeType: 'application/x-henji-code', sizeBytes: 100, width: null, height: null, durationSeconds: null, thumbnailPath: null, thumbnailUrl: null,
  inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1, contentIdentity: 'a'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [],
}
const manifest: CodeAsset = {
  format: 'henji-code-asset', version: 1, name: '可调图案', ...testCodeAssetSource('not-executed-in-preview', 1),
  parameters: { size: 100 }, images: [],
}
function owner(id = 'project-a'): VideoEditInstance {
  const document = { ...createVideoEditDocument('原工程'), id }
  return {
    document, session: {} as VideoEditInstance['session'], activeSequenceId: document.sequences[0].id,
    sequenceViews: new Map(), selectedItemIds: [], selectedBinId: 'bin-a', openSequenceIds: [],
    selectedClipIds: ['clip-a'], targetTrackIds: [], tool: 'select', snapping: true, zoom: 1, inFrame: null, outFrame: null,
    dirty: false, error: null, past: [], future: [], selection: 'clip-a', frame: 0, playing: false, playbackDirection: 1,
    busy: false, activePanel: 'timeline', version: 0,
  }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function ready(): Promise<HTMLButtonElement> {
  await screen.findByText('可调图案')
  return screen.getByRole('button', { name: 'assetLibrary.codeImport' }) as HTMLButtonElement
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.owner = owner(); mocks.listeners.clear()
  mocks.read.mockReset().mockResolvedValue({ asset, manifest })
  mocks.import.mockReset().mockResolvedValue({ definitionId: 'definition-a', itemId: 'item-a' })
  mocks.touch.mockResolvedValue(undefined)
})
afterEach(cleanup)

describe('可编辑代码资产预览与导入', () => {
  it('仅读正式清单，清单URI和源码不会进入媒体查看器或执行入口', async () => {
    render(<AssetPreviewOverlay asset={asset} onClose={vi.fn()} />)
    await ready()
    expect(mocks.read).toHaveBeenCalledWith(asset.id, expect.any(AbortSignal))
    expect(mocks.import).not.toHaveBeenCalled()
    expect(mocks.image).toHaveBeenLastCalledWith(expect.objectContaining({ open: false, imageUrl: '', filePaths: [], infoSource: undefined }), expect.anything())
    expect(mocks.video).toHaveBeenLastCalledWith(expect.objectContaining({ open: false, videoUrl: '', filePath: undefined }), expect.anything())
    expect(mocks.audio).toHaveBeenLastCalledWith(expect.objectContaining({ open: false, audioUrl: '', filePath: undefined }), expect.anything())
    expect(document.body.textContent).not.toContain(manifest.codeSources[0].source)
    expect(document.body.textContent).not.toContain(asset.contentIdentity)
  })

  it('没有当前剪辑工程时给出真实引导，不能启动导入', async () => {
    mocks.owner = undefined
    render(<AssetPreviewOverlay asset={asset} onClose={vi.fn()} />)
    const button = await ready()
    expect(button.disabled).toBe(true)
    expect(screen.getByText('assetLibrary.codeOpenProject')).toBeTruthy()
    fireEvent.click(button)
    expect(mocks.import).not.toHaveBeenCalled()
  })

  it('导入固定点击前工程、序列、选区和箱，等待期间双击只执行一次', async () => {
    const pending = deferred<{ definitionId: string; itemId: string }>()
    mocks.import.mockReturnValue(pending.promise)
    const original = mocks.owner!
    const sequenceId = original.activeSequenceId
    render(<AssetPreviewOverlay asset={asset} onClose={vi.fn()} />)
    fireEvent.click(await ready())
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.codeImporting' }))
    original.selection = 'clip-b'; original.activeSequenceId = 'sequence-b'
    expect(mocks.import).toHaveBeenCalledOnce()
    expect(mocks.import).toHaveBeenCalledWith(original.document.id, asset.id, { binId: 'bin-a', filterTarget: { sequenceId, clipId: 'clip-a' } }, expect.any(AbortSignal))
    await act(async () => pending.resolve({ definitionId: 'definition-a', itemId: 'item-a' }))
    expect(screen.getByText('assetLibrary.codeImportedItem')).toBeTruthy()
  })

  it('滤镜成功按真实结果反馈；没有选区时交正式服务拒绝，不猜源码种类', async () => {
    mocks.owner!.selection = null
    mocks.import.mockRejectedValueOnce(new Error('请选择要应用此代码效果的片段。'))
    render(<AssetPreviewOverlay asset={asset} onClose={vi.fn()} />)
    fireEvent.click(await ready())
    await screen.findByText('请选择要应用此代码效果的片段。')
    expect(mocks.import).toHaveBeenLastCalledWith(mocks.owner!.document.id, asset.id, { binId: 'bin-a' }, expect.any(AbortSignal))
    mocks.owner!.selection = 'clip-a'
    mocks.import.mockResolvedValueOnce({ definitionId: 'filter-a' })
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.codeImport' }))
    expect(await screen.findByText('assetLibrary.codeImportedEffect')).toBeTruthy()
  })

  it('关闭取消读取，晚到成功或失败不会重开或污染预览', async () => {
    const pending = deferred<{ asset: AssetRecord; manifest: CodeAsset }>()
    mocks.read.mockReturnValue(pending.promise)
    const view = render(<AssetPreviewOverlay asset={asset} onClose={vi.fn()} />)
    const signal = mocks.read.mock.calls[0][1] as AbortSignal
    view.rerender(<AssetPreviewOverlay asset={null} onClose={vi.fn()} />)
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve({ asset, manifest }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.queryByText('可调图案')).toBeNull()
  })

  it('切换资产撤销旧读取，旧失败不能替换新清单', async () => {
    const pending = deferred<{ asset: AssetRecord; manifest: CodeAsset }>()
    mocks.read.mockReturnValueOnce(pending.promise).mockResolvedValueOnce({ asset: { ...asset, id: 'asset-b' }, manifest: { ...manifest, name: '新图案' } })
    const view = render(<AssetPreviewOverlay asset={asset} onClose={vi.fn()} />)
    const signal = mocks.read.mock.calls[0][1] as AbortSignal
    view.rerender(<AssetPreviewOverlay asset={{ ...asset, id: 'asset-b' }} onClose={vi.fn()} />)
    await screen.findByText('新图案')
    expect(signal.aborted).toBe(true)
    await act(async () => pending.reject(new Error('旧清单失败')))
    expect(screen.getByText('新图案')).toBeTruthy()
    expect(screen.queryByText('旧清单失败')).toBeNull()
  })

  it('切工程取消在途导入，迟到提交回执不向新工程显示成功', async () => {
    const pending = deferred<{ definitionId: string; itemId: string }>()
    mocks.import.mockReturnValue(pending.promise)
    render(<AssetPreviewOverlay asset={asset} onClose={vi.fn()} />)
    fireEvent.click(await ready())
    const signal = mocks.import.mock.calls[0][3] as AbortSignal
    act(() => { mocks.owner = owner('project-b'); mocks.listeners.forEach(listener => listener()) })
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve({ definitionId: 'old-definition', itemId: 'old-item' }))
    expect(screen.queryByText('assetLibrary.codeImportedItem')).toBeNull()
    expect(mocks.import).toHaveBeenCalledOnce()
  })

  it('完成后关闭只结束预览，不取消或撤回已提交导入', async () => {
    const onClose = vi.fn()
    render(<AssetPreviewOverlay asset={asset} onClose={onClose} />)
    fireEvent.click(await ready())
    await screen.findByText('assetLibrary.codeImportedItem')
    const signal = mocks.import.mock.calls[0][3] as AbortSignal
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.code - 关闭' }))
    expect(signal.aborted).toBe(false)
    expect(onClose).toHaveBeenCalledOnce()
    expect(mocks.import).toHaveBeenCalledOnce()
  })

  it('关闭取消未提交导入，晚到回执不会在库中出现完成反馈', async () => {
    const pending = deferred<{ definitionId: string; itemId: string }>()
    mocks.import.mockReturnValue(pending.promise)
    const view = render(<AssetPreviewOverlay asset={asset} onClose={vi.fn()} />)
    fireEvent.click(await ready())
    const signal = mocks.import.mock.calls[0][3] as AbortSignal
    view.rerender(<AssetPreviewOverlay asset={null} onClose={vi.fn()} />)
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve({ definitionId: 'old-definition', itemId: 'old-item' }))
    expect(screen.queryByText('assetLibrary.codeImportedItem')).toBeNull()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('读取失败可正式重试，关闭时立即取消当前等待', async () => {
    mocks.read.mockRejectedValueOnce(new Error('文件不可读'))
    const pending = deferred<{ asset: AssetRecord; manifest: CodeAsset }>()
    mocks.read.mockReturnValueOnce(pending.promise)
    const onClose = vi.fn()
    render(<AssetPreviewOverlay asset={asset} onClose={onClose} />)
    await screen.findByText('文件不可读')
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.retry' }))
    await waitFor(() => expect(mocks.read).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'assetLibrary.code - 关闭' }))
    expect((mocks.read.mock.calls[1][1] as AbortSignal).aborted).toBe(true)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it.each(['image', 'video', 'audio'] as const)('%s继续使用唯一正式查看器和原媒体路径', mediaType => {
    const media = { ...asset, mediaType, filePath: `C:/source.${mediaType}`, displayUrl: `henji-media://local/source.${mediaType}` }
    render(<AssetPreviewOverlay asset={media} onClose={vi.fn()} />)
    const props = (mediaType === 'image' ? mocks.image : mediaType === 'video' ? mocks.video : mocks.audio).mock.lastCall?.[0]
    expect(props).toMatchObject({ open: true, [mediaType === 'image' ? 'imageUrl' : mediaType === 'video' ? 'videoUrl' : 'audioUrl']: media.displayUrl })
    expect(mocks.read).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
