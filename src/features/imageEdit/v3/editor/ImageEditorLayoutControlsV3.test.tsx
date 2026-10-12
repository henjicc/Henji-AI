// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createImageEditDocumentV3 } from '@/core/imageEdit/v3/documentFactory'
import { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import type { ImageLayoutState } from '../application/imageEditLayoutDraft'
import type { ImageEditorV3Controller } from './types'
import { useImageEditorSessionStoreV3 } from '../store'
import { ImageEditorLayoutControlsV3 } from './ImageEditorLayoutControlsV3'
import i18n from '@/i18n/config'

type ControlsState = Omit<ImageLayoutState, 'draft' | 'entries' | 'candidates'> & {
  draft?: Pick<NonNullable<ImageLayoutState['draft']>, 'id' | 'fidelity' | 'pins'>
  entries: { layerId: string; sample: { sampleId: string } }[]
  candidates: { id: string; label: string }[]
}

const fake = vi.hoisted(() => {
  const initial = (): ControlsState => ({
    status: 'reviewing', draft: { id: 'draft', fidelity: 0, pins: [] },
    entries: ['a', 'b', 'c'].map(layerId => ({ layerId, sample: { sampleId: layerId } })),
    candidates: [{ id: 'align', label: '对齐边缘，贴近摆放' }, { id: 'distribute', label: '对齐并按边缘等距' }],
    selected: 'distribute', needsSave: false, revision: 0, baseDigest: '',
  })
  const listeners = new Set<() => void>()
  const model = {
    state: initial(), initial,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    update: (patch: Partial<ControlsState>) => { model.state = { ...model.state, ...patch }; listeners.forEach(listener => listener()) },
    organize: vi.fn(async () => undefined), apply: vi.fn(async (): Promise<void> => undefined),
    configure: vi.fn(async () => undefined), preview: vi.fn(), cancel: vi.fn(), reopen: vi.fn(async () => undefined),
  }
  return model
})
vi.mock('../application/imageEditLayoutDraft', () => ({ imageEditLayoutDraft: () => ({ ...fake, snapshot: () => fake.state }) }))

beforeEach(async () => { await i18n.changeLanguage('zh-CN'); fake.state = fake.initial(); fake.preview.mockImplementation((id: string) => fake.update({ selected: id })) })
afterEach(() => { cleanup(); vi.clearAllMocks(); useImageEditorSessionStoreV3.getState().disposeSession('layout-ui') })
function mount(profile: 'full' | 'canvas-edit' | 'quick' | 'mask'): void {
  const document = createImageEditDocumentV3({ width: 1000, height: 600, documentId: 'layout-ui' })
  const store = useImageEditorSessionStoreV3.getState()
  store.ensureSession('layout-ui', ['move']); store.setSelectedLayerIds('layout-ui', ['a', 'b', 'c'])
  const controller = { sessionId: 'layout-ui', profile: { id: profile }, document } as ImageEditorV3Controller
  render(<ImageEditorLayoutControlsV3 bus={new ImageEditCommandBusV3(document)} controller={controller} />)
}
async function open(): Promise<void> {
  fireEvent.click(screen.getByRole('button', { name: '随手摆' }))
  await waitFor(() => expect(document.querySelector('[data-image-layout-controls]')).toBeTruthy())
}
it.each(['full', 'canvas-edit'] as const)('%s 共用候选、原稿钉点与一次应用', async profile => {
  mount(profile); await open()
  fireEvent.click(screen.getByRole('radio', { name: '原稿' }))
  expect(screen.getByRole('radio', { name: '原稿' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '应用' }).disabled).toBe(true)
  fireEvent.click(screen.getByRole('radio', { name: '等距排列' }))
  fireEvent.click(screen.getByRole('button', { name: '钉住所选图层的原稿位置' }))
  await waitFor(() => expect(fake.configure).toHaveBeenCalledWith({ pinIds: ['a', 'b', 'c'] }))
  await waitFor(() => expect(screen.getByRole<HTMLButtonElement>('button', { name: '应用' }).disabled).toBe(false))
  fireEvent.click(screen.getByRole('button', { name: '应用' }))
  await waitFor(() => expect(fake.apply).toHaveBeenCalledOnce())
  expect(fake.preview.mock.calls.map(call => call[0])).toEqual(['original', 'distribute'])
  expect(screen.queryByRole('button', { name: '开始示范' })).toBeNull()
})
it.each(['quick', 'mask'] as const)('%s 不提供布局写入口', profile => {
  mount(profile); expect(screen.queryByRole('button', { name: '随手摆' })).toBeNull()
})
it('候选用方向键循环、Home/End 选择并保留键盘焦点', async () => {
  mount('full'); await open()
  const last = screen.getByRole('radio', { name: '等距排列' })
  last.focus(); fireEvent.keyDown(last, { key: 'ArrowRight' })
  const original = screen.getByRole('radio', { name: '原稿' })
  expect(document.activeElement).toBe(original)
  expect(original.tabIndex).toBe(0)
  fireEvent.keyDown(original, { key: 'End' })
  expect(document.activeElement).toBe(last)
  expect(last.getAttribute('aria-checked')).toBe('true')
})
it('原稿对照时选单独主图后整理仍沿用原稿目标集合', async () => {
  fake.state.selected = 'original'; mount('full'); await open()
  act(() => useImageEditorSessionStoreV3.getState().setSelectedLayerIds('layout-ui', ['a']))
  fireEvent.click(screen.getByRole('button', { name: '整理' }))
  await waitFor(() => expect(fake.organize).toHaveBeenCalledWith([]))
})
it('无草稿且不足三层时给出条件提示并禁止整理', async () => {
  fake.state = { ...fake.state, status: 'idle', draft: undefined, entries: [], candidates: [] }
  mount('full')
  act(() => useImageEditorSessionStoreV3.getState().setSelectedLayerIds('layout-ui', ['a']))
  await open()
  expect(screen.getByText('至少选择三个独立图层')).toBeTruthy()
  expect(screen.queryByRole('button', { name: '整理' })).toBeNull()
  expect(screen.queryByRole('button', { name: '应用' })).toBeNull()
  act(() => useImageEditorSessionStoreV3.getState().setSelectedLayerIds('layout-ui', ['a', 'b', 'c']))
  expect(screen.queryByText('至少选择三个独立图层')).toBeNull()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: '整理' }).disabled).toBe(false)
})
it('滑杆停手只提交一次，Escape 放弃数值并沿浮层规则关闭', async () => {
  mount('full'); await open()
  let slider = screen.getByRole('slider', { name: '保留原稿位置' })
  expect(slider.getAttribute('aria-valuetext')).toBe('完全整理')
  fireEvent.change(slider, { target: { value: '.3' } })
  fireEvent.keyDown(slider, { key: 'Escape' }); fireEvent.blur(slider)
  expect(fake.configure).not.toHaveBeenCalled()
  await waitFor(() => expect(screen.queryByRole('slider')).toBeNull())
  await waitFor(() => expect(screen.getByRole('button', { name: '随手摆' }).getAttribute('aria-expanded')).toBe('false'))
  await open()
  slider = screen.getByRole('slider', { name: '保留原稿位置' })
  fireEvent.change(slider, { target: { value: '.4' } }); fireEvent.keyUp(slider, { key: 'PageUp' }); fireEvent.blur(slider)
  await waitFor(() => expect(fake.configure).toHaveBeenCalledWith({ fidelity: .4 }))
  expect(fake.configure).toHaveBeenCalledTimes(1)
})
it('保存失败只显示一次，重试保存期间禁止重复应用', async () => {
  fake.apply.mockImplementationOnce(async () => {
    fake.update({ needsSave: true, message: '请腾出磁盘空间后重试', messageTone: 'error' })
    throw new Error('请腾出磁盘空间后重试')
  })
  mount('full'); await open()
  fireEvent.click(screen.getByRole('button', { name: '应用' }))
  await screen.findByRole('button', { name: '重试保存' })
  await waitFor(() => expect(screen.getAllByText('请腾出磁盘空间后重试')).toHaveLength(1))
  let finish: (() => void) | undefined
  fake.apply.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const retry = screen.getByRole('button', { name: '重试保存' })
  fireEvent.click(retry)
  expect(screen.queryByRole('button', { name: '重试保存' })).toBeNull()
  fireEvent.click(retry)
  await waitFor(() => expect(fake.apply).toHaveBeenCalledTimes(2))
  await act(async () => { finish?.() })
})
it('应用和撤销是普通状态，拒绝才是错误', async () => {
  fake.state.message = '已应用，可撤销'; fake.state.messageTone = 'status'
  mount('full'); await open()
  expect(screen.getByRole('status').textContent).toBe('已应用，可撤销')
  expect(screen.queryByRole('alert')).toBeNull()
  act(() => fake.update({ message: '已撤销布局', messageTone: 'status', revision: 1 }))
  expect(screen.getByRole('status').textContent).toBe('已撤销布局')
  act(() => fake.update({ message: '含蒙版图层暂不能整理，请取消选择该图层', messageTone: 'error' }))
  expect(screen.getAllByRole('alert')).toHaveLength(1)
})
