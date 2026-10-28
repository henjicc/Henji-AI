// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { createApplicationHarness } from '@/tests/applicationHarness'
import type { VideoEditAnnotation } from '@/core/videoEdit/annotations'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { appendVideoEditClip, closeVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, undoVideoEdit } from '../application/videoEditService'
import { createVideoEditAnnotation, selectVideoEditAnnotation, setVideoEditAnnotationListFilter } from '../application/videoEditAnnotations'
import { setVideoEditAnnotationsStatus, VIDEO_EDIT_ANNOTATION_USER } from '../application/videoEditAnnotationBatch'
import { captureVideoEditCommandContext, executeVideoEditCommand, videoEditCommandState } from '../application/videoEditCommands'
import { useAlertDialogStore } from '@/stores/alertDialogStore'
import { VideoEditAnnotationsPanel } from './VideoEditAnnotationsPanel'

vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (index: number, entry: unknown) => React.ReactNode }) => <div>{data.map((entry, index) => <div key={index}>{itemContent(index, entry)}</div>)}</div> }))
beforeEach(() => { installHarnessNativeStorage(); vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/notes.hjvid'); vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined); vi.spyOn(getPlatform().clipboard, 'writeText').mockResolvedValue(undefined) })
afterEach(async () => { cleanup(); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('完整流转：草稿编辑→批量发送→open→Agent处理→已改完→确认/重开，筛选与跳转读取真实状态', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  const markId = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 12, target: { kind: 'point', x: .2, y: .3 }, text: '标题移到这里' })
  const errors = vi.fn(); const view = render(<VideoEditAnnotationsPanel instance={owner} onError={errors} />); const app = createApplicationHarness()
  try {
    expect(view.getByText('1 条待发送')).toBeTruthy()
    // 选中不铺底色、展开即选中：刚画的那条已选中并展开；点一条就跳到它的画面
    expect(view.getByRole('button', { name: '跳到标注 1' }).getAttribute('aria-expanded')).toBe('true')
    fireEvent.click(view.getByRole('button', { name: '跳到标注 1' })); expect(owner.frame).toBe(12); expect(owner.activePanel).toBe('annotations')
    fireEvent.change(view.getByLabelText('标注 1 说明'), { target: { value: '标题缩小' } }); fireEvent.blur(view.getByLabelText('标注 1 说明'))
    expect(getActiveVideoEditSequence(owner).annotations[0].text).toBe('标题缩小')
    fireEvent.click(view.getByRole('button', { name: '复制给外部 Agent' })); await waitFor(() => expect(getActiveVideoEditSequence(owner).annotations[0].status).toBe('open'))
    expect(view.queryByText('1 条待发送')).toBeNull()
    await act(async () => {
      const result = await app.change({ kind: 'video_edit.annotation', id: `${id}:${markId}` }, { 'video_edit.annotation.thread': [{ id: 'r', author: { kind: 'external', name: 'Claude Code' }, createdAt: '2026-10-08T00:00:00.000Z', text: '已缩小；撤销这次修改可恢复。' }], 'video_edit.annotation.status': 'addressed' }); expect(result).toMatchObject({ ok: true })
    })
    expect(view.getByRole('button', { name: '确认' })).toBeTruthy(); expect(view.getByRole('button', { name: '驳回' })).toBeTruthy(); expect(view.getByText('已缩小；撤销这次修改可恢复。')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '筛选批注' })); fireEvent.click(await view.findByRole('option', { name: '已改完' }))
    fireEvent.click(view.getByRole('button', { name: '确认' })); expect(getActiveVideoEditSequence(owner).annotations[0].status).toBe('resolved'); expect(view.getByText('暂无批注')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '筛选批注' })); fireEvent.click(await view.findByRole('option', { name: '已确认' }))
    fireEvent.click(view.getByRole('button', { name: '重开' })); expect(getActiveVideoEditSequence(owner).annotations[0].status).toBe('open')
    expect(errors).not.toHaveBeenCalled()
  } finally { app.dispose() }
})
it('驳回附理由，补充讨论；删除草稿保留其它标注', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 0, target: { kind: 'point', x: .1, y: .1 }, text: '一条草稿' })
  const markId = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 3, target: { kind: 'point', x: .3, y: .3 }, text: '继续处理', status: 'open' })
  const app = createApplicationHarness(); const view = render(<VideoEditAnnotationsPanel instance={owner} onError={vi.fn()} />)
  try {
    await act(async () => { await app.change({ kind: 'video_edit.annotation', id: `${id}:${markId}` }, { 'video_edit.annotation.thread': [{ id: 'r', author: { kind: 'assistant', name: '助手' }, createdAt: '2026-10-08T00:00:00.000Z', text: '已修改。' }], 'video_edit.annotation.status': 'addressed' }) })
    fireEvent.click(view.getByRole('button', { name: '跳到标注 2' })); expect(view.queryByLabelText('标注 1 说明')).toBeNull()
    fireEvent.change(view.getByLabelText('标注 2 驳回理由'), { target: { value: '亮度再减一点' } }); fireEvent.click(view.getByRole('button', { name: '驳回' }))
    const mark: VideoEditAnnotation = getActiveVideoEditSequence(owner).annotations[1]; expect(mark.status).toBe('open'); expect(mark.thread.at(-1)?.text).toBe('亮度再减一点')
    fireEvent.click(view.getByRole('button', { name: '删除标注 1' })); expect(getActiveVideoEditSequence(owner).annotations).toHaveLength(1)
    fireEvent.change(view.getByLabelText('标注 1 补充说明'), { target: { value: '也保留字幕' } }); fireEvent.click(view.getByRole('button', { name: '补充' })); expect(getActiveVideoEditSequence(owner).annotations[0].thread.at(-1)?.text).toBe('也保留字幕')
  } finally { app.dispose() }
})
const statuses = (owner: Awaited<ReturnType<typeof createVideoEditTestProject>>) => getActiveVideoEditSequence(owner).annotations.map(mark => mark.status)
const footer = (view: ReturnType<typeof render>) => view.getByRole('toolbar', { name: '批注工具' }).textContent
async function menuItem(view: ReturnType<typeof render>, trigger: string, item: string): Promise<void> {
  // 只派发 click 时浮层不会自己收起：已经开着就直接点菜单项
  if (!view.queryByRole('button', { name: item })) fireEvent.click(view.getByRole('button', { name: trigger }))
  fireEvent.click(await view.findByRole('button', { name: item }))
}
it('多选（单击、Shift 连选、Ctrl 加选、全选当前筛选）后批量标为已改完、确认、驳回，每个批量操作一步撤销', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  for (const frame of [0, 10, 20, 30]) createVideoEditAnnotation(id, owner.activeSequenceId, { frame, target: { kind: 'point', x: .5, y: .5 }, text: `第 ${frame} 帧`, status: 'open' })
  const view = render(<VideoEditAnnotationsPanel instance={owner} onError={vi.fn()} />)
  fireEvent.click(view.getByRole('button', { name: '跳到标注 1' })); fireEvent.click(view.getByRole('button', { name: '跳到标注 3' }), { shiftKey: true })
  expect(footer(view)).toContain('已选 3'); expect(view.getByRole('button', { name: '跳到标注 2' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(view.getByRole('button', { name: '跳到标注 2' }), { ctrlKey: true }); expect(footer(view)).toContain('已选 2')
  expect(view.getByRole('button', { name: '跳到标注 2' }).getAttribute('aria-pressed')).toBeNull()
  // 全选与 Ctrl+A 是同一条命令：只选当前筛选下的
  await act(async () => { await executeVideoEditCommand(captureVideoEditCommandContext(id, 'annotations'), 'select_all') })
  expect(footer(view)).toContain('已选 4')
  const past = owner.past.length
  await menuItem(view, '改状态', '标为已改完'); await waitFor(() => expect(statuses(owner)).toEqual(['addressed', 'addressed', 'addressed', 'addressed']))
  fireEvent.click(view.getByRole('button', { name: '确认选中批注' })); await waitFor(() => expect(statuses(owner)).toEqual(['resolved', 'resolved', 'resolved', 'resolved']))
  expect(owner.past.length).toBe(past + 2)
  // 已确认的不在“未确认”筛选里，也就不再算选中
  expect(footer(view)).not.toContain('已选')
  act(() => undoVideoEdit(id)); expect(statuses(owner)).toEqual(['addressed', 'addressed', 'addressed', 'addressed'])
  fireEvent.click(view.getByRole('button', { name: '驳回选中批注' })); await waitFor(() => expect(statuses(owner)).toEqual(['open', 'open', 'open', 'open']))
  expect(getActiveVideoEditSequence(owner).annotations[0].thread.at(-1)?.text).toBe('请重新处理。')
  act(() => undoVideoEdit(id)); expect(statuses(owner)).toEqual(['addressed', 'addressed', 'addressed', 'addressed'])
})
it('按入出点、按选中片段选出一批；删除与清除先确认，取消不动，确认后一步撤销；清除已处理不动待发送与待处理', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id; appendVideoEditClip(id)
  const clip = getActiveVideoEditSequence(owner).clips[0]
  const make = (frame: number, status: 'draft' | 'open', clipId?: string) => createVideoEditAnnotation(id, owner.activeSequenceId, { frame, target: { kind: 'point', x: .5, y: .5 }, text: `第 ${frame} 帧`, status, ...(clipId ? { clipId } : {}) })
  const [draft, open, done, closed] = [make(0, 'draft'), make(10, 'open'), make(20, 'open', clip.id), make(30, 'open', clip.id)]
  setVideoEditAnnotationsStatus(id, { ids: [done, closed] }, 'addressed', VIDEO_EDIT_ANNOTATION_USER, '改好了'); setVideoEditAnnotationsStatus(id, { ids: [closed] }, 'resolved', VIDEO_EDIT_ANNOTATION_USER)
  setVideoEditAnnotationListFilter(id, 'all')
  const view = render(<VideoEditAnnotationsPanel instance={owner} onError={vi.fn()} />)
  act(() => setVideoEditTimelineView(id, { inFrame: 5, outFrame: 21 }))
  await menuItem(view, '更多批注操作', '按入出点选'); expect(footer(view)).toContain('已选 2')
  act(() => setVideoEditTimelineView(id, { selectedClipIds: [clip.id] }))
  await menuItem(view, '更多批注操作', '按选中片段选'); expect(footer(view)).toContain('已选 2')
  // 删除：取消就不动，确认才删，一步撤销
  fireEvent.click(view.getByRole('button', { name: '删除选中批注' })); await waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  act(() => useAlertDialogStore.getState().dismissCurrent()); await waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(0)); expect(statuses(owner)).toHaveLength(4)
  fireEvent.click(view.getByRole('button', { name: '删除选中批注' })); await waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  act(() => useAlertDialogStore.getState().confirmCurrent()); await waitFor(() => expect(getActiveVideoEditSequence(owner).annotations.map(mark => mark.id)).toEqual([draft, open]))
  act(() => undoVideoEdit(id)); expect(statuses(owner)).toEqual(['draft', 'open', 'addressed', 'resolved'])
  await menuItem(view, '更多批注操作', '清除已处理'); await waitFor(() => expect(useAlertDialogStore.getState().queue).toHaveLength(1))
  expect(statuses(owner)).toHaveLength(4)
  act(() => useAlertDialogStore.getState().confirmCurrent()); await waitFor(() => expect(statuses(owner)).toEqual(['draft', 'open']))
  act(() => undoVideoEdit(id)); expect(statuses(owner)).toHaveLength(4)
})
it('手动标为已改完：只选待发送时说明先发送；标完写明是手动标的、不关联修改，不出现“撤销这次修改”', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 0, target: { kind: 'point', x: .5, y: .5 }, text: '草稿' })
  const view = render(<VideoEditAnnotationsPanel instance={owner} onError={vi.fn()} />)
  expect(videoEditCommandState(captureVideoEditCommandContext(id, 'annotations'), 'annotations_mark_addressed')).toEqual({ enabled: false, reason: '选中的都是待发送批注，先发送后才能标为已改完。' })
  const open = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 5, target: { kind: 'point', x: .5, y: .5 }, text: '待处理', status: 'open' })
  await menuItem(view, '改状态', '标为已改完'); await waitFor(() => expect(statuses(owner)).toEqual(['draft', 'addressed']))
  const mark = getActiveVideoEditSequence(owner).annotations.find(item => item.id === open)!
  expect(mark.thread.at(-1)).toMatchObject({ author: { kind: 'user' }, text: '手动标为已改完。' }); expect(mark.addressedBy?.transactionId).toBeUndefined()
  expect(view.getByRole('button', { name: '确认' })).toBeTruthy(); expect(view.queryByRole('button', { name: '撤销这次修改' })).toBeNull()
})
it('同一帧上的两条批注：点另一条就展开它（选中变化本身要刷新面板，不靠播放头移动）', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 0, target: { kind: 'point', x: .1, y: .1 }, text: '第一条' })
  createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 0, target: { kind: 'point', x: .3, y: .3 }, text: '第二条' })
  const view = render(<VideoEditAnnotationsPanel instance={owner} onError={vi.fn()} />)
  expect(view.getByRole('button', { name: '跳到标注 2' }).getAttribute('aria-expanded')).toBe('true')
  fireEvent.click(view.getByRole('button', { name: '跳到标注 1' }))
  expect(view.getByRole('button', { name: '跳到标注 1' }).getAttribute('aria-expanded')).toBe('true')
  expect(view.getByRole('button', { name: '跳到标注 2' }).getAttribute('aria-expanded')).toBe('false')
  act(() => selectVideoEditAnnotation(id, getActiveVideoEditSequence(owner).annotations[1].id))
  expect(view.getByRole('button', { name: '跳到标注 2' }).getAttribute('aria-expanded')).toBe('true')
})
