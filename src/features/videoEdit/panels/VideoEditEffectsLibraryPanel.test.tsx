// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { videoEditEffectSchema } from '@/core/videoEdit/compositing'
import type { VideoEditInstance } from '../application/videoEditService'
import { useVideoEditEffectLibraryStore } from '../application/videoEditEffectPresets'
import { applyVideoEditBuiltinEffect } from '../application/videoEditCompositing'
import { VideoEditEffectsLibraryPanel } from './VideoEditEffectsLibraryPanel'
import { VideoEditEffectPresetDialog } from './VideoEditEffectPresetDialog'

vi.mock('../application/videoEditCompositing', () => ({ applyVideoEditBuiltinEffect: vi.fn() }))
const instance = { document: { id: 'project' }, activeSequenceId: 'sequence', selectedClipIds: ['clip'] } as unknown as VideoEditInstance
beforeEach(() => { useVideoEditEffectLibraryStore.setState({ favorites: [], presets: [] }); vi.clearAllMocks() })
afterEach(() => { cleanup(); localStorage.clear() })
const effect = () => videoEditEffectSchema.parse({ id: 'effect', name: '高斯模糊', enabled: true, amount: .5, builtin: { id: 'gaussian_blur', params: { strength: 60 } } })

it('搜索命中自动展开文件夹，清空恢复折叠；收藏置顶且星标不会应用效果', () => {
  const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={vi.fn()} />)
  const folder = (): Element => container.querySelector('[data-video-edit-effects-folder="video_effect"]')!
  fireEvent.click(screen.getByRole('button', { name: '视频效果' }))
  expect(folder().getAttribute('aria-expanded')).toBe('false')
  fireEvent.change(screen.getByRole('textbox', { name: '搜索效果' }), { target: { value: 'GAUSSIAN BLUR' } })
  expect(folder().getAttribute('aria-expanded')).toBe('true')
  expect(container.querySelector('[data-video-edit-effects-entry="effect:gaussian_blur"]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
  expect(folder().getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: '视频效果' }))
  fireEvent.click(screen.getByRole('button', { name: '收藏高斯模糊' }))
  expect(useVideoEditEffectLibraryStore.getState().favorites).toEqual(['effect:gaussian_blur'])
  expect(container.querySelector('[role="tree"]')?.firstElementChild?.getAttribute('data-video-edit-effects-folder')).toBe('favorites')
  expect(container.querySelector('[data-video-edit-effects-folder="favorites"] [data-video-edit-effects-entry="effect:gaussian_blur"]')).not.toBeNull()
  expect(applyVideoEditBuiltinEffect).not.toHaveBeenCalled()
})

it('预设双击走统一入口，右键重命名与删除更新本机库', async () => {
  const preset = useVideoEditEffectLibraryStore.getState().savePreset('柔化', [effect()])
  const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={vi.fn()} />)
  const item = (): Element => container.querySelector(`[data-video-edit-effects-entry="preset:${preset.id}"]`)!
  fireEvent.doubleClick(item())
  expect(applyVideoEditBuiltinEffect).toHaveBeenCalledWith('project', 'sequence', ['clip'], `preset:${preset.id}`)
  fireEvent.contextMenu(item())
  fireEvent.click(screen.getByText('重命名…'))
  fireEvent.change(await screen.findByRole('textbox', { name: '预设名称' }), { target: { value: '柔和画面' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(useVideoEditEffectLibraryStore.getState().presets[0].name).toBe('柔和画面')
  fireEvent.contextMenu(item()); fireEvent.click(screen.getByText('删除预设'))
  await waitFor(() => expect(useVideoEditEffectLibraryStore.getState().presets).toEqual([]))
})

it('保存入口允许选择是否保留手绘遮罩；保存副本参数不随原效果改变', () => {
  const source = { ...effect(), mask: { regionId: 'shapes' as const, shapes: [{ id: 'shape', kind: 'rect' as const, box: [0, 0, .5, .5] as [number, number, number, number] }] } }
  const close = vi.fn()
  render(<VideoEditEffectPresetDialog effects={[source]} initialName="局部柔化" onClose={close} />)
  fireEvent.click(screen.getByRole('switch', { name: '保存手绘遮罩' }))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  source.builtin!.params.strength = 10
  expect(close).toHaveBeenCalledOnce()
  expect(useVideoEditEffectLibraryStore.getState().presets[0].effects[0]).toMatchObject({ builtin: { params: { strength: 60 } }, mask: source.mask })
})

it('取消勾选全部效果或清空名称时禁用保存，Enter 也不会写入；取消不保存', () => {
  const close = vi.fn()
  render(<VideoEditEffectPresetDialog effects={[effect()]} initialName="柔化" onClose={close} />)
  const checkbox = screen.getByRole('checkbox', { name: '保存效果：高斯模糊' })
  const name = screen.getByRole('textbox', { name: '预设名称' })
  fireEvent.click(checkbox)
  expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
  fireEvent.keyDown(name, { key: 'Enter' })
  expect(close).not.toHaveBeenCalled()
  expect(useVideoEditEffectLibraryStore.getState().presets).toEqual([])
  fireEvent.click(checkbox)
  fireEvent.change(name, { target: { value: '  ' } })
  fireEvent.keyDown(name, { key: 'Enter' })
  expect(screen.getByRole('button', { name: '保存' }).hasAttribute('disabled')).toBe(true)
  expect(useVideoEditEffectLibraryStore.getState().presets).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(close).toHaveBeenCalledOnce()
  expect(useVideoEditEffectLibraryStore.getState().presets).toEqual([])
})

it('只选择无手绘遮罩的效果时不再显示遮罩选项，并且只保存它', () => {
  const masked = { ...effect(), id: 'masked', name: '局部柔化', mask: { regionId: 'shapes' as const, shapes: [{ id: 'shape', kind: 'rect' as const, box: [0, 0, .5, .5] as [number, number, number, number] }] } }
  render(<VideoEditEffectPresetDialog effects={[masked, effect()]} initialName="柔化" onClose={vi.fn()} />)
  expect(screen.getByRole('switch', { name: '保存手绘遮罩' })).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: '保存效果：局部柔化' }))
  expect(screen.queryByRole('switch', { name: '保存手绘遮罩' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(useVideoEditEffectLibraryStore.getState().presets[0].effects.map(effect => effect.id)).toEqual(['effect'])
})
