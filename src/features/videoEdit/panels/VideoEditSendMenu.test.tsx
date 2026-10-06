// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VideoEditSendMenu } from './VideoEditSendMenu'
import { videoEditSendMenuItems } from './videoEditSendActions'

const send = vi.hoisted(() => ({ plan: vi.fn(), send: vi.fn(), run: vi.fn(), create: vi.fn(), list: vi.fn(), prepare: vi.fn() }))
vi.mock('../application/videoEditResultSend', () => ({ planVideoEditSend: send.plan, sendCreativeResultToVideoEdit: send.send, listVideoEditSendDestinations: send.list, prepareVideoEditSendDestination: send.prepare }))
vi.mock('../application/videoEditCreativeTransfer', () => ({ createVideoEditCreativeTransfer: send.create, runVideoEditCreativeTransfer: send.run }))
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }); send.list.mockResolvedValue([]); send.prepare.mockResolvedValue(undefined) })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('菜单列出实际落点与不可用原因；点击时才解析来源并交给同一发送服务', async () => {
  send.plan.mockImplementation(({ mode }: { mode: string }) => mode === 'add' ? { available: true, label: '加入 剪辑 · 序列 1 · 视频 1 · 00:00:01:00' } : { available: false, reason: '请先在剪辑时间线选择要替换的片段。' })
  send.send.mockResolvedValue({ clipId: 'c', verified: true })
  const notify = vi.fn(); const resolveSource = vi.fn(async () => ({ type: 'generation' as const, recordId: 'h', outputIndex: 0 }))
  const view = render(<VideoEditSendMenu mediaKind="video" notify={notify} resolveSource={resolveSource} />)
  expect(resolveSource).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: /加入剪辑/ }))
  expect(view.getByText('加入 剪辑 · 序列 1 · 视频 1 · 00:00:01:00')).toBeTruthy()
  expect((view.getByRole('menuitem', { name: /替换所选片段/ }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { fireEvent.click(view.getByRole('menuitem', { name: /加入播放头/ })) })
  expect(send.send).toHaveBeenCalledWith(resolveSource, { mediaKind: 'video', mode: 'add' }, expect.any(AbortSignal))
  expect(resolveSource).not.toHaveBeenCalled() // 服务负责先固定落点，再解析来源。
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('已加入剪辑'), 'success')
})

it('选择另一剪辑后在背景打开目标，发送方式与目标工程同时传给统一服务', async () => {
  send.list.mockResolvedValue([{ id: 'other', name: '另一个剪辑' }])
  send.plan.mockReturnValue({ available: true, label: '指定落点' })
  send.send.mockResolvedValue({ verified: true })
  const source = () => ({ type: 'asset' as const, assetId: 'a' })
  const view = render(<VideoEditSendMenu mediaKind="image" notify={vi.fn()} resolveSource={source} />)
  await act(async () => { fireEvent.click(view.getByRole('button', { name: /加入剪辑/ })) })
  fireEvent.click(view.getByRole('button', { name: /目标剪辑/ }))
  await act(async () => { fireEvent.click(view.getByRole('option', { name: '另一个剪辑' })) })
  expect(send.prepare).toHaveBeenCalledWith('other')
  await act(async () => { fireEvent.click(view.getByRole('menuitem', { name: /播放头处插入/ })) })
  expect(send.send).toHaveBeenCalledWith(source, { mediaKind: 'image', mode: 'insert', projectId: 'other' }, expect.any(AbortSignal))
})

it('原位置回填走固定目标；失败提示原因，取消不提示', async () => {
  send.plan.mockReturnValue({ available: false, reason: '请先在剪辑工作区打开一个剪辑。' })
  const target = { projectId: 'p', sequenceId: 's', id: 't' }; send.create.mockReturnValue('transfer')
  send.run.mockRejectedValueOnce(new Error('原剪辑已有修改'))
  const notify = vi.fn()
  const view = render(<VideoEditSendMenu mediaKind="image" notify={notify} boundTarget={{ target, label: '加入 剪辑 · 视频 2' }} resolveSource={() => ({ type: 'document', docRef: { docId: 'd', path: 'D:/作品/图片文档/d.henjiimg' }, revision: 3 })} />)
  fireEvent.click(view.getByRole('button', { name: /加入剪辑/ }))
  await act(async () => { fireEvent.click(view.getByRole('menuitem', { name: /替换回剪辑/ })) })
  expect(send.create).toHaveBeenCalledWith(target, { type: 'document', docRef: { docId: 'd', path: 'D:/作品/图片文档/d.henjiimg' }, revision: 3 })
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('原剪辑已有修改'), 'error')
  notify.mockClear(); send.run.mockRejectedValueOnce(new DOMException('取消', 'AbortError'))
  fireEvent.click(view.getByRole('button', { name: /加入剪辑/ }))
  await act(async () => { fireEvent.click(view.getByRole('menuitem', { name: /替换回剪辑/ })) })
  expect(notify).not.toHaveBeenCalled()
  const items = videoEditSendMenuItems('audio', () => ({ type: 'document', docRef: { docId: 'v', path: 'D:/作品/口播/v.henji-audio' } }), notify, null)
  expect(items.map(item => [item.label, item.disabled])).toEqual([['剪辑：加入素材面板', true], ['剪辑：播放头处覆盖', true], ['剪辑：播放头处插入', true], ['剪辑：加入播放头', true], ['剪辑：替换所选片段', true]])
})
