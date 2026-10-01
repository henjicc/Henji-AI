// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VideoEditSendMenu } from './VideoEditSendMenu'
import { videoEditSendMenuItems } from './videoEditSendActions'

const send = vi.hoisted(() => ({ plan: vi.fn(), send: vi.fn(), run: vi.fn(), create: vi.fn() }))
vi.mock('../application/videoEditResultSend', () => ({ planVideoEditSend: send.plan, sendCreativeResultToVideoEdit: send.send }))
vi.mock('../application/videoEditCreativeTransfer', () => ({ createVideoEditCreativeTransfer: send.create, runVideoEditCreativeTransfer: send.run }))
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }) })
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('菜单列出实际落点与不可用原因；点击时才解析来源并交给同一发送服务', async () => {
  send.plan.mockImplementation(({ mode }: { mode: string }) => mode === 'add' ? { available: true, label: '加入 工程 · 序列 1 · 视频 1 · 00:00:01:00' } : { available: false, reason: '请先在剪辑时间线选择要替换的片段。' })
  send.send.mockResolvedValue({ clipId: 'c', verified: true })
  const notify = vi.fn(); const resolveSource = vi.fn(async () => ({ kind: 'generation.result' as const, id: 'h', outputIndex: 0 }))
  const view = render(<VideoEditSendMenu mediaKind="video" notify={notify} resolveSource={resolveSource} />)
  expect(resolveSource).not.toHaveBeenCalled()
  fireEvent.click(view.getByRole('button', { name: /加入剪辑/ }))
  expect(view.getByText('加入 工程 · 序列 1 · 视频 1 · 00:00:01:00')).toBeTruthy()
  expect((view.getByRole('menuitem', { name: /替换所选片段/ }) as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { fireEvent.click(view.getByRole('menuitem', { name: /加入播放头/ })) })
  expect(send.send).toHaveBeenCalledWith({ kind: 'generation.result', id: 'h', outputIndex: 0 }, { mediaKind: 'video', mode: 'add' }, expect.any(AbortSignal))
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('已加入剪辑'), 'success')
})

it('原位置回填走固定目标；失败提示原因，取消不提示', async () => {
  send.plan.mockReturnValue({ available: false, reason: '请先在剪辑工作区打开一个工程。' })
  const target = { projectId: 'p', sequenceId: 's', id: 't' }; send.create.mockReturnValue('transfer')
  send.run.mockRejectedValueOnce(new Error('原剪辑工程已有修改'))
  const notify = vi.fn()
  const view = render(<VideoEditSendMenu mediaKind="image" notify={notify} boundTarget={{ target, label: '加入 工程 · 视频 2' }} resolveSource={() => ({ kind: 'image_edit.document', documentRef: 'image-edit-v3:d', revision: 3 })} />)
  fireEvent.click(view.getByRole('button', { name: /加入剪辑/ }))
  await act(async () => { fireEvent.click(view.getByRole('menuitem', { name: /回填到原剪辑位置/ })) })
  expect(send.create).toHaveBeenCalledWith(target, { kind: 'image_edit.document', documentRef: 'image-edit-v3:d', revision: 3 })
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('原剪辑工程已有修改'), 'error')
  notify.mockClear(); send.run.mockRejectedValueOnce(new DOMException('取消', 'AbortError'))
  fireEvent.click(view.getByRole('button', { name: /加入剪辑/ }))
  await act(async () => { fireEvent.click(view.getByRole('menuitem', { name: /回填到原剪辑位置/ })) })
  expect(notify).not.toHaveBeenCalled()
  const items = videoEditSendMenuItems('audio', () => ({ kind: 'audio_edit.project', projectId: 'v' }), notify, null)
  expect(items.map(item => [item.label, item.disabled])).toEqual([['剪辑：加入播放头', true], ['剪辑：替换所选片段', true]])
})
