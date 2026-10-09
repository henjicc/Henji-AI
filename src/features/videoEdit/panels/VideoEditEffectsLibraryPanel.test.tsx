// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { videoEditEffectSchema } from '@/core/videoEdit/compositing'
import { createVideoEditMaskShape } from '@/core/videoEdit/effectMasks'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import type { VideoEditInstance } from '../application/videoEditService'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, undoVideoEdit } from '../application/videoEditService'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { useVideoEditEffectLibraryStore } from '../application/videoEditEffectPresets'
import * as compositing from '../application/videoEditCompositing'
import { VideoEditEffectsLibraryPanel } from './VideoEditEffectsLibraryPanel'
import { VideoEditEffectPresetDialog } from './VideoEditEffectPresetDialog'

const notification = vi.hoisted(() => vi.fn())
vi.mock('@/contexts/NotificationContext', () => ({ useNotification: () => ({ showNotification: notification }) }))
// 只替换像素边界，添加、选区和撤销使用正式应用实现。
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  setTracks() {}
  async updateDocument() {}
  async present() { return { presented: true, bitmap: { close() {} } } }
  async dispose() {}
} }))
let instance: VideoEditInstance
beforeEach(async () => {
  vi.clearAllMocks(); useVideoEditEffectLibraryStore.setState({ favorites: [], presets: [] })
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/effects-library.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(compositing, 'applyVideoEditBuiltinEffect')
  instance = await createVideoEditTestProject()
  appendVideoEditClip(instance.document.id)
  setVideoEditTimelineView(instance.document.id, { selectedClipIds: [getActiveVideoEditSequence(instance).clips[0].id] })
})
afterEach(async () => {
  cleanup()
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage(); localStorage.clear()
})
const effect = () => videoEditEffectSchema.parse({ id: 'effect', name: '高斯模糊', enabled: true, amount: .5, builtin: { id: 'gaussian_blur', params: { sigma_fraction_height: 0.018 } } })

it('双击内置效果添加到当前片段，并把新增效果交给停靠宿主定位', () => {
  const added = vi.fn(); const onError = vi.fn()
  const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={onError} onEffectsAdded={added} />)
  fireEvent.doubleClick(container.querySelector('[data-video-edit-effects-entry="effect:gaussian_blur"]')!)
  const effects = getActiveVideoEditSequence(instance).clips[0].effects!
  expect(effects).toHaveLength(1)
  expect(effects[0].builtin?.id).toBe('gaussian_blur')
  expect(added).toHaveBeenCalledWith([effects[0].id])
  expect(onError).not.toHaveBeenCalled()
})

it('混合媒介多选只添加到全部匹配片段，一步撤销；保留多选并查看已添加效果的主片段', () => {
  const id = instance.document.id
  appendVideoEditClip(id)
  appendVideoEditMedia(id, { id: 'sound', name: '对白', path: 'D:/dialog.wav', kind: 'audio', width: 0, height: 0, durationSeconds: 4, hasAudio: true })
  const track = getActiveVideoEditSequence(instance).tracks.find(value => value.kind === 'audio')!.index
  appendVideoEditClip(id, 'sound', { frame: 0, track })
  const clips = getActiveVideoEditSequence(instance).clips
  const sound = clips.find(value => value.kind === 'audio')!
  const selection = clips.map(value => value.id)
  setVideoEditTimelineView(id, { selectedClipIds: selection }, sound.id)
  const history = instance.past.length
  const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={vi.fn()} />)
  fireEvent.doubleClick(container.querySelector('[data-video-edit-effects-entry="effect:gaussian_blur"]')!)
  expect(getActiveVideoEditSequence(instance).clips.filter(value => value.kind !== 'audio').every(value => value.effects?.[0].builtin?.id === 'gaussian_blur')).toBe(true)
  expect(getActiveVideoEditSequence(instance).clips.find(value => value.id === sound.id)!.effects).toBeUndefined()
  expect(instance.selectedClipIds).toEqual(selection)
  expect(instance.selection).toBe(clips[0].id)
  expect(instance.past).toHaveLength(history + 1)
  undoVideoEdit(id)
  expect(getActiveVideoEditSequence(instance).clips.every(value => !value.effects?.length)).toBe(true)
})

it.each(['none', 'incompatible'] as const)('选区不可用（%s）给短通知，不走报错弹窗、不打开控件', reason => {
  if (reason === 'none') setVideoEditTimelineView(instance.document.id, { selectedClipIds: [] })
  const history = instance.past.length
  const added = vi.fn(); const onError = vi.fn()
  const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={onError} onEffectsAdded={added} />)
  fireEvent.doubleClick(container.querySelector(`[data-video-edit-effects-entry="effect:${reason === 'none' ? 'gaussian_blur' : 'reverb'}"]`)!)
  expect(notification).toHaveBeenCalledOnce()
  expect(notification).toHaveBeenCalledWith(expect.any(String), 'error')
  expect(onError).not.toHaveBeenCalled()
  expect(added).not.toHaveBeenCalled()
  expect(compositing.applyVideoEditBuiltinEffect).not.toHaveBeenCalled()
  expect(instance.past).toHaveLength(history)
})

it('聚焦列表项按 Enter 应用预设，重复按键不重复添加', () => {
  const preset = useVideoEditEffectLibraryStore.getState().savePreset('柔化', [effect()])
  const added = vi.fn()
  const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={vi.fn()} onEffectsAdded={added} />)
  const item = container.querySelector<HTMLElement>(`[data-video-edit-effects-entry="preset:${preset.id}"]`)!
  item.focus()
  expect(document.activeElement).toBe(item)
  fireEvent.keyDown(item, { key: 'Enter' })
  fireEvent.keyDown(item, { key: 'Enter', repeat: true })
  expect(getActiveVideoEditSequence(instance).clips[0].effects).toHaveLength(1)
  expect(added).toHaveBeenCalledOnce()
  expect(compositing.applyVideoEditBuiltinEffect).toHaveBeenCalledOnce()
})

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
  expect(compositing.applyVideoEditBuiltinEffect).not.toHaveBeenCalled()
})

it('预设双击走统一入口，右键重命名与删除更新本机库', async () => {
  const preset = useVideoEditEffectLibraryStore.getState().savePreset('柔化', [effect()])
  const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={vi.fn()} />)
  const item = (): Element => container.querySelector(`[data-video-edit-effects-entry="preset:${preset.id}"]`)!
  fireEvent.doubleClick(item())
  expect(compositing.applyVideoEditBuiltinEffect).toHaveBeenCalledWith(instance.document.id, instance.activeSequenceId, instance.selectedClipIds, `preset:${preset.id}`)
  fireEvent.contextMenu(item())
  fireEvent.click(screen.getByText('重命名…'))
  fireEvent.change(await screen.findByRole('textbox', { name: '预设名称' }), { target: { value: '柔和画面' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(useVideoEditEffectLibraryStore.getState().presets[0].name).toBe('柔和画面')
  fireEvent.contextMenu(item()); fireEvent.click(screen.getByText('删除预设'))
  await waitFor(() => expect(useVideoEditEffectLibraryStore.getState().presets).toEqual([]))
})

it('保存入口允许选择是否保留手绘遮罩；保存副本参数不随原效果改变', () => {
  const source = { ...effect(), mask: { regionId: 'shapes' as const, shapes: [createVideoEditMaskShape('rect', 'shape')] } }
  const close = vi.fn()
  render(<VideoEditEffectPresetDialog effects={[source]} initialName="局部柔化" onClose={close} />)
  fireEvent.click(screen.getByRole('switch', { name: '保存手绘遮罩' }))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  source.builtin!.params.sigma_fraction_height = 10
  expect(screen.queryByRole('alert')?.textContent).toBeUndefined()
  expect(close).toHaveBeenCalledOnce()
  expect(useVideoEditEffectLibraryStore.getState().presets[0].effects[0]).toMatchObject({ builtin: { params: { sigma_fraction_height: 0.018 } }, mask: source.mask })
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
  const masked = { ...effect(), id: 'masked', name: '局部柔化', mask: { regionId: 'shapes' as const, shapes: [createVideoEditMaskShape('rect', 'shape')] } }
  render(<VideoEditEffectPresetDialog effects={[masked, effect()]} initialName="柔化" onClose={vi.fn()} />)
  expect(screen.getByRole('switch', { name: '保存手绘遮罩' })).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: '保存效果：局部柔化' }))
  expect(screen.queryByRole('switch', { name: '保存手绘遮罩' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(useVideoEditEffectLibraryStore.getState().presets[0].effects.map(effect => effect.id)).toEqual(['effect'])
})
