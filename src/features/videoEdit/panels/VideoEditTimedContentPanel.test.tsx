// @vitest-environment jsdom
import { useSyncExternalStore } from 'react'
import { VirtuosoMockContext } from 'react-virtuoso'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { appendVideoEditSequence, closeVideoEditProject, createVideoEditProject, editVideoProject, listVideoEditInstances, openVideoEditProject, saveVideoEdit, setVideoEditView, subscribeVideoEdit, switchVideoEditSequence, undoVideoEdit, videoEditRevision, type VideoEditInstance } from '../application/videoEditService'
import { createVideoEditCaption, updateVideoEditTimedContent } from '../application/videoEditTimedContent'
import { VideoEditTimedContentPanel } from './VideoEditTimedContentPanel'

const files = new Map<string, string>()
let owner: VideoEditInstance
let onError: ReturnType<typeof vi.fn>
const sequence = () => owner.document.sequences[0]
function View({ visible = true, instance = owner }: { visible?: boolean; instance?: VideoEditInstance }): React.ReactElement {
  useSyncExternalStore(subscribeVideoEdit, videoEditRevision)
  return <VirtuosoMockContext.Provider value={{ viewportHeight: 280, itemHeight: 56 }}><VideoEditTimedContentPanel instance={instance} visible={visible} onError={onError} /></VirtuosoMockContext.Provider>
}
beforeEach(async () => {
  installHarnessNativeStorage(); files.clear(); onError = vi.fn()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/timed-panel.henji-video')
  vi.spyOn(getPlatform().system.dialog, 'open').mockResolvedValue(null)
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockImplementation(async (path, text) => { files.set(path, text) })
  vi.spyOn(getPlatform().system.fs, 'readTextFile').mockImplementation(async path => files.get(path)!)
  owner = (await createVideoEditProject())!
  editVideoProject(owner.document.id, document => {
    document.items = [{ id: 'text-item', kind: 'text', name: '真实文字项目项' }]
    document.sequences[0].clips = [{ ...makeVideoEditItemClip(document, 'text-item', document.sequences[0].id, { frame: 30, track: 1 }), id: 'clip', name: '片段一', duration: 90 }]
    return document
  })
  setVideoEditView(owner.document.id, { selection: 'clip', frame: 45 })
})
afterEach(async () => { cleanup(); for (const current of listVideoEditInstances()) await closeVideoEditProject(current.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('真实片段字幕创建、整笔编辑、定位和撤销使用同一工程历史', async () => {
  const view = render(<View />); const history = owner.past.length
  fireEvent.click(view.getByRole('button', { name: '新增字幕' }))
  expect((view.getByLabelText('开始帧') as HTMLInputElement).value).toBe('45')
  expect(view.getByRole('button', { name: '内容锚定' }).textContent).toContain('片段一')
  fireEvent.change(view.getByLabelText('字幕文字'), { target: { value: '真实字幕' } })
  fireEvent.change(view.getByLabelText('开始帧'), { target: { value: '50' } })
  fireEvent.change(view.getByLabelText('时长（帧）'), { target: { value: '20' } })
  expect(owner.past).toHaveLength(history)
  fireEvent.click(view.getByRole('button', { name: '添加' }))
  await waitFor(() => expect(sequence().captions).toMatchObject([{ clipId: 'clip', start: 50, duration: 20, text: '真实字幕' }]))
  expect(owner.past).toHaveLength(history + 1)
  const row = await view.findByRole('button', { name: '字幕：真实字幕' })
  fireEvent.click(row); fireEvent.change(view.getByLabelText('字幕文字'), { target: { value: '整笔修改' } })
  fireEvent.change(view.getByLabelText('时长（帧）'), { target: { value: '25' } })
  fireEvent.click(view.getByRole('button', { name: '保存修改' }))
  expect(sequence().captions![0]).toMatchObject({ text: '整笔修改', duration: 25 }); expect(owner.past).toHaveLength(history + 2)
  act(() => undoVideoEdit(owner.document.id))
  const restored = await view.findByRole('button', { name: '字幕：真实字幕' })
  fireEvent.doubleClick(restored); expect(owner.frame).toBe(50); expect(owner.playing).toBe(false)
  expect(onError).not.toHaveBeenCalled()
})

it('标记可改为序列锚定、编辑整数帧、定位和删除，一次操作一次历史', async () => {
  const view = render(<View />)
  fireEvent.click(view.getByRole('button', { name: '标记' })); fireEvent.click(view.getByRole('button', { name: '新增标记' }))
  fireEvent.click(view.getByRole('button', { name: '内容锚定' })); fireEvent.click(view.getByRole('button', { name: '序列时钟' }))
  fireEvent.change(view.getByLabelText('标记名称'), { target: { value: '段落开始' } })
  fireEvent.change(view.getByLabelText('标记帧'), { target: { value: '60' } })
  const history = owner.past.length; fireEvent.click(view.getByRole('button', { name: '添加' }))
  expect(sequence().markers![0]).toMatchObject({ frame: 60, name: '段落开始' }); expect(sequence().markers![0].clipId).toBeUndefined()
  const row = await view.findByRole('button', { name: '标记：段落开始' })
  fireEvent.click(row); fireEvent.click(view.getByRole('button', { name: '定位' })); expect(owner.frame).toBe(60)
  fireEvent.change(view.getByLabelText('标记帧'), { target: { value: '61' } }); fireEvent.click(view.getByRole('button', { name: '保存修改' }))
  fireEvent.click(await view.findByRole('button', { name: '标记：段落开始' })); fireEvent.click(view.getByRole('button', { name: '删除' }))
  expect(sequence().markers).toEqual([]); expect(owner.past).toHaveLength(history + 3); expect(onError).not.toHaveBeenCalled()
})

it('锁定片段拒绝字幕写入，失败保留草稿和原工程', async () => {
  const id = createVideoEditCaption(owner.document.id, sequence().id, { clipId: 'clip', start: 40, duration: 20, text: '原字幕' })
  editVideoProject(owner.document.id, document => { document.sequences[0].tracks[1].locked = true; return document })
  const view = render(<View />); const history = owner.past.length
  fireEvent.click(await view.findByRole('button', { name: '字幕：原字幕' }))
  fireEvent.change(view.getByLabelText('字幕文字'), { target: { value: '锁定修改' } }); fireEvent.click(view.getByRole('button', { name: '保存修改' }))
  expect(onError).toHaveBeenCalled(); expect(view.getByRole('alert').textContent).toContain('锁定')
  expect(sequence().captions![0]).toMatchObject({ id, text: '原字幕' }); expect(owner.past).toHaveLength(history)
})

it('外部已改字幕不会被旧草稿覆盖', async () => {
  const id = createVideoEditCaption(owner.document.id, sequence().id, { start: 10, duration: 20, text: '初始字幕' })
  const view = render(<View />); fireEvent.click(await view.findByRole('button', { name: '字幕：初始字幕' }))
  fireEvent.change(view.getByLabelText('字幕文字'), { target: { value: '旧草稿' } })
  act(() => updateVideoEditTimedContent(owner.document.id, sequence().id, 'caption', id, { text: '助手新修改' }))
  fireEvent.click(view.getByRole('button', { name: '保存修改' }))
  expect(sequence().captions![0].text).toBe('助手新修改'); expect(view.getByRole('alert').textContent).toContain('新修改')
})

it('隐藏、切序列和同工程重开清除原草稿，不提交到新目标', async () => {
  const original = sequence().id; const second = appendVideoEditSequence(owner.document.id)
  const view = render(<View />)
  fireEvent.click(view.getByRole('button', { name: '新增字幕' })); fireEvent.change(view.getByLabelText('字幕文字'), { target: { value: '未提交原草稿' } })
  act(() => switchVideoEditSequence(owner.document.id, second)); expect(view.queryByLabelText('字幕文字')).toBeNull()
  act(() => switchVideoEditSequence(owner.document.id, original)); fireEvent.click(view.getByRole('button', { name: '新增字幕' }))
  expect((view.getByLabelText('字幕文字') as HTMLTextAreaElement).value).toBe('')
  view.rerender(<View visible={false} />); view.rerender(<View />); expect(view.queryByLabelText('字幕文字')).toBeNull()
  fireEvent.click(view.getByRole('button', { name: '新增字幕' })); fireEvent.change(view.getByLabelText('字幕文字'), { target: { value: '旧owner草稿' } })
  await act(async () => { await saveVideoEdit(owner.document.id); await closeVideoEditProject(owner.document.id); owner = (await openVideoEditProject('D:/timed-panel.henji-video'))! })
  view.rerender(<View instance={owner} />); expect(view.queryByLabelText('字幕文字')).toBeNull(); expect(sequence().captions).toBeUndefined()
})

it('真实SRT导入按节目偏移并锚定片段，不猜源入点', async () => {
  files.set('D:/source.srt', '1\n00:00:02,000 --> 00:00:03,000\n文件字幕')
  vi.mocked(getPlatform().system.dialog.open).mockResolvedValue('D:/source.srt')
  const view = render(<View />); fireEvent.click(view.getByRole('button', { name: '导入字幕' }))
  fireEvent.change(view.getByLabelText('节目偏移（帧）'), { target: { value: '-15' } })
  fireEvent.click(view.getByRole('button', { name: '内容锚定' })); fireEvent.click(await view.findByRole('button', { name: '锚定片段：片段一' }))
  const history = owner.past.length; fireEvent.click(view.getByRole('button', { name: '选择字幕文件' }))
  await waitFor(() => expect(sequence().captions).toMatchObject([{ clipId: 'clip', start: 45, duration: 30, text: '文件字幕' }]))
  expect(owner.past).toHaveLength(history + 1); expect(onError).not.toHaveBeenCalled()
})

it.each(['hidden', 'sequence'] as const)('在途文件读取在%s时取消，不追加到原序列或新选区', async mode => {
  const second = appendVideoEditSequence(owner.document.id)
  vi.mocked(getPlatform().system.dialog.open).mockResolvedValue('D:/late.srt')
  let finish!: (value: string) => void
  vi.mocked(getPlatform().system.fs.readTextFile).mockImplementationOnce(() => new Promise<string>(resolve => { finish = resolve }))
  const view = render(<View />); fireEvent.click(view.getByRole('button', { name: '导入字幕' })); fireEvent.click(view.getByRole('button', { name: '选择字幕文件' }))
  await waitFor(() => expect(finish).toBeTypeOf('function'))
  if (mode === 'hidden') view.rerender(<View visible={false} />)
  else act(() => switchVideoEditSequence(owner.document.id, second))
  await act(async () => finish('1\n00:00:01,000 --> 00:00:02,000\n迟到字幕'))
  expect(owner.document.sequences.every(value => !value.captions?.length)).toBe(true); expect(onError).not.toHaveBeenCalled()
})

it('字幕导出走实际文件写入和回读，输出保持序列帧边界', async () => {
  createVideoEditCaption(owner.document.id, sequence().id, { start: 15, duration: 30, text: '导出字幕' })
  vi.mocked(getPlatform().system.dialog.save).mockResolvedValue('D:/output.srt')
  const view = render(<View />); fireEvent.click(view.getByRole('button', { name: '导出字幕格式' })); fireEvent.click(view.getByText('导出 SRT'))
  await waitFor(() => expect(files.get('D:/output.srt')).toContain('00:00:00,500 --> 00:00:01,500\n导出字幕'))
  await waitFor(() => expect(getPlatform().system.fs.readTextFile).toHaveBeenCalledWith('D:/output.srt')); expect(onError).not.toHaveBeenCalled()
})

it('500段真实字幕只挂载可见行，节目逐帧观察不重新映射列表', async () => {
  editVideoProject(owner.document.id, document => { document.sequences[0].captions = Array.from({ length: 500 }, (_, index) => ({ id: `cue-${index}`, start: index * 2, duration: 1, text: `字幕${index}` })); return document })
  const mapped = vi.spyOn(sequence().captions!, 'map')
  const view = render(<View />)
  await view.findByRole('button', { name: '字幕：字幕0' })
  const rows = view.container.querySelectorAll('[data-video-edit-timed-entry]')
  expect(rows.length).toBeGreaterThan(0); expect(rows.length).toBeLessThan(30)
  const calls = mapped.mock.calls.length
  act(() => { for (let frame = 100; frame < 160; frame++) setVideoEditView(owner.document.id, { frame, playing: true }, true) })
  expect(mapped).toHaveBeenCalledTimes(calls); expect(sequence().captions).toHaveLength(500)
  mapped.mockRestore()
})
