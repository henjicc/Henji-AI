// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { createApplicationHarness } from '@/tests/applicationHarness'
import type { VideoEditAnnotation } from '@/core/videoEdit/annotations'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { closeVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances } from '../application/videoEditService'
import { createVideoEditAnnotation, selectVideoEditAnnotation } from '../application/videoEditAnnotations'
import { VideoEditAnnotationsPanel } from './VideoEditAnnotationsPanel'

vi.mock('react-virtuoso', () => ({ Virtuoso: ({ data, itemContent }: { data: unknown[]; itemContent: (index: number, entry: unknown) => React.ReactNode }) => <div>{data.map((entry, index) => <div key={index}>{itemContent(index, entry)}</div>)}</div> }))
beforeEach(() => { installHarnessNativeStorage(); vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/notes.hjvid'); vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined); vi.spyOn(getPlatform().clipboard, 'writeText').mockResolvedValue(undefined) })
afterEach(async () => { cleanup(); for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })
it('完整流转：草稿编辑→批量发送→open→Agent处理→待审查→通过/重开，筛选与跳转读取真实状态', async () => {
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
    expect(view.getByRole('button', { name: '通过' })).toBeTruthy(); expect(view.getByText('已缩小；撤销这次修改可恢复。')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '筛选批注' })); fireEvent.click(await view.findByRole('option', { name: '待审查' }))
    fireEvent.click(view.getByRole('button', { name: '通过' })); expect(getActiveVideoEditSequence(owner).annotations[0].status).toBe('resolved'); expect(view.getByText('暂无批注')).toBeTruthy()
    fireEvent.click(view.getByRole('button', { name: '筛选批注' })); fireEvent.click(await view.findByRole('option', { name: '已通过' }))
    fireEvent.click(view.getByRole('button', { name: '重开' })); expect(getActiveVideoEditSequence(owner).annotations[0].status).toBe('open')
    expect(errors).not.toHaveBeenCalled()
  } finally { app.dispose() }
})
it('审查重开附意见，补充讨论；删除草稿保留其它标注', async () => {
  const owner = await createVideoEditTestProject(); const id = owner.document.id
  createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 0, target: { kind: 'point', x: .1, y: .1 }, text: '一条草稿' })
  const markId = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 3, target: { kind: 'point', x: .3, y: .3 }, text: '继续处理', status: 'open' })
  const app = createApplicationHarness(); const view = render(<VideoEditAnnotationsPanel instance={owner} onError={vi.fn()} />)
  try {
    await act(async () => { await app.change({ kind: 'video_edit.annotation', id: `${id}:${markId}` }, { 'video_edit.annotation.thread': [{ id: 'r', author: { kind: 'assistant', name: '助手' }, createdAt: '2026-10-08T00:00:00.000Z', text: '已修改。' }], 'video_edit.annotation.status': 'addressed' }) })
    fireEvent.click(view.getByRole('button', { name: '跳到标注 2' })); expect(view.queryByLabelText('标注 1 说明')).toBeNull()
    fireEvent.change(view.getByLabelText('标注 2 审查意见'), { target: { value: '亮度再减一点' } }); fireEvent.click(view.getByRole('button', { name: '重开' }))
    const mark: VideoEditAnnotation = getActiveVideoEditSequence(owner).annotations[1]; expect(mark.status).toBe('open'); expect(mark.thread.at(-1)?.text).toBe('亮度再减一点')
    fireEvent.click(view.getByRole('button', { name: '删除标注 1' })); expect(getActiveVideoEditSequence(owner).annotations).toHaveLength(1)
    fireEvent.change(view.getByLabelText('标注 1 补充说明'), { target: { value: '也保留字幕' } }); fireEvent.click(view.getByRole('button', { name: '补充' })); expect(getActiveVideoEditSequence(owner).annotations[0].thread.at(-1)?.text).toBe('也保留字幕')
  } finally { app.dispose() }
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
