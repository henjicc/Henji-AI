// @vitest-environment jsdom
import React, { useSyncExternalStore } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { HENJI_DRAG_DATA_MIME } from '@/contexts/dragDataTransfer'
import { appendVideoEditMedia, closeVideoEditProject, createVideoEditProject, listVideoEditInstances, setVideoEditProjectView, subscribeVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { createVideoEditBin, updateVideoEditItems } from '../application/videoEditProjectItems'
import { readVideoEditSource, registerVideoEditSourcePresenter } from '../application/videoEditSource'
import { VideoEditProjectPanel } from './VideoEditProjectPanel'

// This component test covers UI-to-domain commands; the real viewport is covered by Electron acceptance.
vi.mock('react-virtuoso', () => {
  const List = ({ data, itemContent }: { data: unknown[]; itemContent: (index: number, value: unknown) => React.ReactNode }): React.ReactElement => <div>{data.map((value, index) => <React.Fragment key={index}>{itemContent(index, value)}</React.Fragment>)}</div>
  return { Virtuoso: List, VirtuosoGrid: List }
})
vi.mock('./VideoEditProjectThumbnail', () => ({ VideoEditProjectThumbnail: () => <span /> }))
vi.mock('@/stores/navigationStore', () => ({ openAssetLibrary: vi.fn() }))
vi.mock('@/hooks/useI18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
const files = new Map<string, string>()
let instance: VideoEditInstance
let onError: ReturnType<typeof vi.fn>
function View(): React.ReactElement { useSyncExternalStore(subscribeVideoEdit, videoEditRevision); return <VideoEditProjectPanel instance={instance} onError={onError} /> }
beforeEach(async () => {
  installHarnessNativeStorage(); files.clear(); onError = vi.fn()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/project-ui.henji-video')
  vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue(null)
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, value) => { files.set(path, value) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
  instance = (await createVideoEditProject())!
  appendVideoEditMedia(instance.document.id, { id: 'sourceA', name: 'A原视频', kind: 'video', path: 'D:/sourceA.mp4', width: 3840, height: 2160, durationSeconds: 3, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' })
  appendVideoEditMedia(instance.document.id, { id: 'sourceB', name: 'B原视频', kind: 'video', path: 'D:/sourceB.mp4', width: 1920, height: 1080, durationSeconds: 2, frameRateMode: 'variable' })
})
afterEach(async () => { cleanup(); for (const current of listVideoEditInstances()) await closeVideoEditProject(current.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('多选批改委托同一工程历史，移动保留各自标签且不改源文件路径', async () => {
  const ids = instance.document.items.map(item => item.id)
  updateVideoEditItems(instance.document.id, [ids[0]], { tags: ['片头'] }); updateVideoEditItems(instance.document.id, [ids[1]], { tags: ['片尾'] })
  const bin = createVideoEditBin(instance.document.id, '镜头')
  const view = render(<View />)
  await act(async () => fireEvent.click(view.getByRole('button', { name: 'A原视频' })))
  await act(async () => fireEvent.click(view.getByRole('button', { name: 'B原视频' }), { ctrlKey: true }))
  expect(instance.selectedItemIds).toEqual(ids)
  fireEvent.contextMenu(view.getByRole('button', { name: 'A原视频' }))
  fireEvent.click(view.getByText('重命名、标签与移动'))
  await waitFor(() => expect(view.getByRole('dialog')).toBeTruthy())
  fireEvent.change(view.getByLabelText('移动到素材箱'), { target: { value: bin } })
  const history = instance.past.length
  fireEvent.click(view.getByRole('button', { name: '保存' }))
  expect(instance.document.items.map(item => [item.binId, item.tags])).toEqual([[bin, ['片头']], [bin, ['片尾']]])
  expect(instance.past).toHaveLength(history + 1)
  expect(instance.document.media.map(media => media.path)).toEqual(['D:/sourceA.mp4', 'D:/sourceB.mp4'])
  expect(onError).not.toHaveBeenCalled()
})

it('双击素材请求正式源会话，双击空白使用当前箱导入，资产拖入保留来源身份', async () => {
  const bin = createVideoEditBin(instance.document.id, '素材箱')
  const off = registerVideoEditSourcePresenter(instance.document.id, async request => ({ timeUs: request.timeUs, presentedTimeUs: request.timeUs, playing: request.playing, volume: request.volume }))
  const view = render(<View />)
  try {
    await act(async () => fireEvent.doubleClick(view.getByRole('button', { name: 'A原视频' })))
    expect(readVideoEditSource(instance.document.id)).toMatchObject({ itemId: instance.document.items[0].id, status: 'ready' })
    await act(async () => fireEvent.click(view.getByRole('button', { name: '素材箱' })))
    await act(async () => fireEvent.doubleClick(view.getByLabelText('项目项列表')))
    expect(getPlatform().system.dialog.open).toHaveBeenCalledTimes(1)
    // Asset identity checks live in videoEditMedia.test.ts; this only proves the panel drop targets the current bin.
    vi.spyOn(getPlatform().system.paths, 'dirname').mockResolvedValue('D:/'); vi.spyOn(getPlatform().media, 'allowRoot').mockResolvedValue(undefined)
    vi.spyOn(getPlatform().assetLibrary, 'inspectAsset').mockResolvedValue({ id: 'assetA', mediaType: 'image', displayName: '资产图片', filePath: 'D:/asset.png', displayUrl: 'henji-media://local/asset', source: 'imported', mimeType: 'image/png', sizeBytes: 4096, width: 3840, height: 2160, durationSeconds: 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1000, contentIdentity: 'a'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 2, tags: [], libraryIds: [] })
    const payload = JSON.stringify({ type: 'image', imageUrl: 'henji-media://local/asset', filePath: 'E:/forged.png', displayName: '资产图片', sourceType: 'asset', assetId: 'assetA' })
    const transfer = { types: [HENJI_DRAG_DATA_MIME], getData: (type: string) => type === HENJI_DRAG_DATA_MIME ? payload : '', files: [] } as unknown as DataTransfer
    fireEvent.drop(view.getByLabelText('项目项列表'), { dataTransfer: transfer })
    await waitFor(() => expect(instance.document.media.find(media => media.path === 'D:/asset.png')?.assetId).toBe('assetA'))
    const media = instance.document.media.find(media => media.path === 'D:/asset.png')!
    expect(instance.document.items.some(item => item.binId === bin && item.mediaId === media.id)).toBe(true)
    expect(onError).not.toHaveBeenCalled()
  } finally { off() }
})

it('可变帧率素材通过真实序列服务创建，缺少帧率选择不会写入', async () => {
  const view = render(<View />)
  fireEvent.contextMenu(view.getByRole('button', { name: 'B原视频' }))
  fireEvent.click(view.getByText('按此素材新建序列'))
  await waitFor(() => expect(view.getByRole('dialog')).toBeTruthy())
  const history = instance.past.length
  await act(async () => fireEvent.click(view.getByRole('button', { name: '确定' })))
  expect(instance.document.sequences).toHaveLength(1); expect(instance.past).toHaveLength(history)
  fireEvent.change(view.getByLabelText('帧率'), { target: { value: '30000/1001' } })
  await act(async () => fireEvent.click(view.getByRole('button', { name: '确定' })))
  const sequence = instance.document.sequences[1]
  expect(sequence.frameRate).toEqual({ numerator: 30000, denominator: 1001 })
  expect(sequence.clips[0].itemId).toBe(instance.document.items[1].id)
  expect(instance.activeSequenceId).toBe(sequence.id); expect(instance.past).toHaveLength(history + 1)
  setVideoEditProjectView(instance.document.id, { selectedItemIds: [] })
  expect(onError).not.toHaveBeenCalled()
})
