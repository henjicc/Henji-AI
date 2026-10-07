// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { VideoEditSequenceDialog } from './VideoEditSequenceDialog'
import { VideoEditProjectEditDialog } from './VideoEditProjectEditDialog'
afterEach(cleanup)
it('未知或可变源帧率预选 60 帧，改选后保留有理帧率和清根设置', async () => {
  const submit = vi.fn(); const close = vi.fn()
  const view = render(<VideoEditSequenceDialog title="按素材新建序列" initial={{ name: '素材序列' }} bins={[]} requireFrameRate onClose={close} onSubmit={submit} />)
  expect((view.getByLabelText('帧率') as HTMLSelectElement).value).toBe('60/1')
  fireEvent.change(view.getByLabelText('帧率'), { target: { value: '60000/1001' } })
  await act(async () => fireEvent.click(view.getByRole('button', { name: '确定' })))
  expect(submit).toHaveBeenCalledWith(expect.objectContaining({ frameRate: { numerator: 60000, denominator: 1001 }, binId: null }))
  expect(close).toHaveBeenCalledTimes(1)
})
it('序列提交失败保留可编辑值，不关闭对话框或重复业务调用', async () => {
  const submit = vi.fn().mockRejectedValue(new Error('请先调整片段长度')); const close = vi.fn()
  const view = render(<VideoEditSequenceDialog title="序列设置" initial={{ name: '已有序列' }} bins={[]} onClose={close} onSubmit={submit} />)
  fireEvent.change(view.getByLabelText('宽度'), { target: { value: '3840' } })
  await act(async () => fireEvent.click(view.getByRole('button', { name: '确定' })))
  expect(submit).toHaveBeenCalledTimes(1); expect(close).not.toHaveBeenCalled()
  expect(view.getByText('请先调整片段长度')).toBeTruthy()
  expect((view.getByLabelText('宽度') as HTMLInputElement).value).toBe('3840')
})
it('批量移动不覆盖各自原标签，只有主动编辑标签时才统一写入', () => {
  const items = [{ id: 'a', name: 'A', kind: 'text' as const, tags: ['片头'] }, { id: 'b', name: 'B', kind: 'text' as const, tags: ['片尾'] }]
  const submit = vi.fn()
  const view = render(<VideoEditProjectEditDialog value={{ kind: 'items', items }} bins={[{ id: 'bin', name: '箱' }]} onClose={vi.fn()} onSubmit={submit} />)
  fireEvent.change(view.getByLabelText('移动到素材箱'), { target: { value: 'bin' } })
  fireEvent.click(view.getByRole('button', { name: '保存' }))
  expect(submit).toHaveBeenLastCalledWith({ binId: 'bin' })
  fireEvent.change(view.getByLabelText('素材项标签'), { target: { value: '共用，片头,共用' } })
  fireEvent.click(view.getByRole('button', { name: '保存' }))
  expect(submit).toHaveBeenLastCalledWith({ binId: 'bin', tags: ['共用', '片头'] })
})
