import { seedVideoEditEffectPreset } from '../application/videoEditDocumentTestKit'
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { videoEditEffectSchema } from '@/core/videoEdit/compositing'
import { createVideoEditMaskShape } from '@/core/videoEdit/effectMasks'
import { getPlatform } from '@/platform/runtime'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { expectButtonDisabled } from '@/tests/buttonAssertions'
import type { VideoEditInstance } from '../application/videoEditService'
import { appendVideoEditClip, appendVideoEditMedia, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, setVideoEditTimelineView, undoVideoEdit } from '../application/videoEditService'
import { createVideoEditTestProject } from '../application/videoEditDocumentTestKit'
import { listVideoEditStylePieces, useVideoEditEffectLibraryStore } from '../application/videoEditEffectPresets'
import { videoEditStyleLibrary } from '../application/videoEditStyleLibrary'
import { createTestStyleLibraryIo } from '../application/videoEditStyleTestKit'
import * as compositing from '../application/videoEditCompositing'
import { selectVideoEditTransition } from '../application/videoEditTransitions'
import { VideoEditTransitionPanel } from './VideoEditTransitionPanel'
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
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/effects-library.hjvid')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(compositing, 'applyVideoEditBuiltinEffect')
  vi.spyOn(compositing, 'applyVideoEditStylePiece')
  instance = await createVideoEditTestProject()
  appendVideoEditClip(instance.document.id)
  setVideoEditTimelineView(instance.document.id, { selectedClipIds: [getActiveVideoEditSequence(instance).clips[0].id] })
})
afterEach(async () => {
  cleanup()
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage(); localStorage.clear()
})
const effect = () => videoEditEffectSchema.parse({ id: 'effect', name: '高斯模糊', enabled: true, amount: .5, builtin: { id: 'blur', params: { amount: 61.19 } } })

it('双击内置效果添加到当前片段，并把新增效果交给停靠宿主定位', () => {
  const added = vi.fn(); const onError = vi.fn()
  const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={onError} onEffectsAdded={added} />)
  fireEvent.doubleClick(container.querySelector('[data-video-edit-effects-entry="effect:blur"]')!)
  const effects = getActiveVideoEditSequence(instance).clips[0].effects!
  expect(effects).toHaveLength(1)
  expect(effects[0].builtin?.id).toBe('blur')
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
  fireEvent.doubleClick(container.querySelector('[data-video-edit-effects-entry="effect:blur"]')!)
  expect(getActiveVideoEditSequence(instance).clips.filter(value => value.kind !== 'audio').every(value => value.effects?.[0].builtin?.id === 'blur')).toBe(true)
  expect(getActiveVideoEditSequence(instance).clips.find(value => value.id === sound.id)!.effects).toBeUndefined()
  expect(instance.selectedClipIds).toEqual(selection)
  expect(instance.selection).toBe(clips[0].id)
  expect(instance.past).toHaveLength(history + 1)
  undoVideoEdit(id)
  expect(getActiveVideoEditSequence(instance).clips.every(value => !value.effects?.length)).toBe(true)
})

it.each(['none', 'incompatible'] as const)('选区不可用（%s）与拖放共用不可用提示，不打开控件', reason => {
  if (reason === 'none') setVideoEditTimelineView(instance.document.id, { selectedClipIds: [] })
  const history = instance.past.length
  const added = vi.fn(); const onError = vi.fn()
  const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={onError} onEffectsAdded={added} />)
  fireEvent.doubleClick(container.querySelector(`[data-video-edit-effects-entry="effect:${reason === 'none' ? 'blur' : 'reverb'}"]`)!)
  expect(notification).not.toHaveBeenCalled()
  expect(onError).toHaveBeenCalledWith(expect.any(Error))
  expect(added).not.toHaveBeenCalled()
  expect(compositing.applyVideoEditBuiltinEffect).not.toHaveBeenCalled()
  expect(instance.past).toHaveLength(history)
})

it('聚焦列表项按 Enter 应用风格件，重复按键与进行中的再次应用不重复添加', async () => {
  const preset = seedVideoEditEffectPreset(useVideoEditEffectLibraryStore.getState(), '柔化', [effect()])
  const added = vi.fn(); const onError = vi.fn()
  const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={onError} onEffectsAdded={added} />)
  const item = container.querySelector<HTMLElement>(`[data-video-edit-effects-entry="preset:${preset.id}"]`)!
  item.focus()
  expect(document.activeElement).toBe(item)
  fireEvent.keyDown(item, { key: 'Enter' })
  fireEvent.keyDown(item, { key: 'Enter', repeat: true })
  fireEvent.doubleClick(item)
  await waitFor(() => expect(added).toHaveBeenCalledOnce())
  expect(getActiveVideoEditSequence(instance).clips[0].effects).toHaveLength(1)
  expect(compositing.applyVideoEditStylePiece).toHaveBeenCalledOnce()
  expect(compositing.applyVideoEditBuiltinEffect).not.toHaveBeenCalled()
  expect(onError).not.toHaveBeenCalled()
})

it('搜索命中自动展开文件夹，清空恢复折叠；收藏置顶且星标不会应用效果', () => {
  const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={vi.fn()} />)
  const folder = (): Element => container.querySelector('[data-video-edit-effects-folder="video_effect"]')!
  fireEvent.click(screen.getByRole('button', { name: '视频效果' }))
  expect(folder().getAttribute('aria-expanded')).toBe('false')
  fireEvent.change(screen.getByRole('textbox', { name: '搜索效果' }), { target: { value: 'GAUSSIAN BLUR' } })
  expect(folder().getAttribute('aria-expanded')).toBe('true')
  expect(container.querySelector('[data-video-edit-effects-entry="effect:blur"]')).not.toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '清除搜索' }))
  expect(folder().getAttribute('aria-expanded')).toBe('false')
  fireEvent.click(screen.getByRole('button', { name: '视频效果' }))
  fireEvent.click(screen.getByRole('button', { name: '收藏模糊' }))
  expect(useVideoEditEffectLibraryStore.getState().favorites).toEqual(['effect:blur'])
  expect(container.querySelector('[role="tree"]')?.firstElementChild?.getAttribute('data-video-edit-effects-folder')).toBe('favorites')
  expect(container.querySelector('[data-video-edit-effects-folder="favorites"] [data-video-edit-effects-entry="effect:blur"]')).not.toBeNull()
  expect(compositing.applyVideoEditBuiltinEffect).not.toHaveBeenCalled()
})

it('风格件双击走异步风格件入口，右键重命名与删除更新本机库', async () => {
  const preset = seedVideoEditEffectPreset(useVideoEditEffectLibraryStore.getState(), '柔化', [effect()])
  const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={vi.fn()} />)
  const item = (): Element => container.querySelector(`[data-video-edit-effects-entry="preset:${preset.id}"]`)!
  fireEvent.doubleClick(item())
  expect(compositing.applyVideoEditStylePiece).toHaveBeenCalledWith(instance.document.id, instance.activeSequenceId, instance.selectedClipIds, `preset:${preset.id}`)
  await waitFor(() => expect(getActiveVideoEditSequence(instance).clips[0].effects).toHaveLength(1))
  fireEvent.contextMenu(item())
  fireEvent.click(screen.getByText('重命名…'))
  fireEvent.change(await screen.findByRole('textbox', { name: '风格件名称' }), { target: { value: '柔和画面' } })
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(useVideoEditEffectLibraryStore.getState().presets[0].name).toBe('柔和画面'))
  // 删除先把副本移入回收区；回收区本身由宿主测试覆盖，这里只替换系统边界。
  vi.spyOn(getPlatform().system.paths, 'appLocalDataDir').mockResolvedValue('D:/effect-library-test')
  vi.spyOn(getPlatform().system.paths, 'join').mockImplementation(async (...parts) => parts.join('/'))
  vi.spyOn(getPlatform().system.fs, 'mkdir').mockResolvedValue(undefined)
  const trash = vi.spyOn(getPlatform().settings, 'trashFile').mockResolvedValue(undefined)
  fireEvent.contextMenu(item()); fireEvent.click(screen.getByText('删除风格件'))
  await waitFor(() => expect(useVideoEditEffectLibraryStore.getState().presets).toEqual([]))
  expect(trash).toHaveBeenCalledWith(expect.any(String), '柔和画面')
})

it('风格件文件夹同时列出全局与绑定风格的同名风格件，按归属分组；风格成员只能应用，失败交给报错通道', async () => {
  const io = createTestStyleLibraryIo(); videoEditStyleLibrary.reset(io, undefined)
  try {
    await videoEditStyleLibrary.ready()
    const id = instance.document.id; const sequenceId = instance.activeSequenceId
    const global = seedVideoEditEffectPreset(useVideoEditEffectLibraryStore.getState(), '柔化', [effect()])
    const style = { ...videoEditStyleLibrary.requireStyle('restrained').style, effectPresets: [{ ...global, id: 'member' }] }
    editVideoProject(id, document => ({ ...document, styles: [style], sequences: document.sequences.map(sequence => sequence.id === sequenceId ? { ...sequence, styleId: style.id } : sequence) }))
    const onError = vi.fn()
    const { container } = render(<VideoEditEffectsLibraryPanel instance={instance} onError={onError} />)
    const folder = within(container.querySelector<HTMLElement>('[data-video-edit-effects-folder="presets"]')!)
    expect(folder.getByText('全局')).toBeTruthy(); expect(folder.getByText(style.name)).toBeTruthy()
    expect(folder.getAllByText('柔化')).toHaveLength(2)
    expect(folder.getAllByRole('button', { name: '收藏柔化' })).toHaveLength(1)
    const member = listVideoEditStylePieces(id, sequenceId).find(entry => entry.styleId === style.id)!
    const item = container.querySelector(`[data-video-edit-effects-entry="${member.ref}"]`)!
    fireEvent.doubleClick(item)
    expect(compositing.applyVideoEditStylePiece).toHaveBeenCalledWith(id, sequenceId, instance.selectedClipIds, member.ref)
    await waitFor(() => expect(getActiveVideoEditSequence(instance).clips[0].effects).toHaveLength(1))
    vi.mocked(compositing.applyVideoEditStylePiece).mockRejectedValueOnce(new Error('试渲染失败'))
    await waitFor(() => expect(item.getAttribute('aria-busy')).toBeNull())
    fireEvent.doubleClick(item)
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: '试渲染失败' })))
  } finally { videoEditStyleLibrary.reset(); io.dispose() }
})

it('保存入口允许选择是否保留手绘遮罩；保存副本参数不随原效果改变', async () => {
  const source = { ...effect(), mask: { regionId: 'shapes' as const, shapes: [createVideoEditMaskShape('rect', 'shape')] } }
  const close = vi.fn()
  render(<VideoEditEffectPresetDialog projectId={instance.document.id} effects={[source]} initialName="局部柔化" onClose={close} />)
  fireEvent.click(screen.getByRole('switch', { name: '保存手绘遮罩' }))
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  source.builtin!.params.amount = 10
  await waitFor(() => expect(close).toHaveBeenCalledOnce())
  expect(screen.queryByRole('alert')?.textContent).toBeUndefined()
  expect(useVideoEditEffectLibraryStore.getState().presets[0].effects[0]).toMatchObject({ builtin: { params: { amount: 61.19 } }, mask: source.mask })
})

it('取消勾选全部效果或清空名称时禁用保存，Enter 也不会写入；取消不保存', () => {
  const close = vi.fn()
  render(<VideoEditEffectPresetDialog projectId={instance.document.id} effects={[effect()]} initialName="柔化" onClose={close} />)
  const checkbox = screen.getByRole('checkbox', { name: '保存效果：高斯模糊' })
  const name = screen.getByRole('textbox', { name: '风格件名称' })
  fireEvent.click(checkbox)
  expectButtonDisabled(screen.getByRole('button', { name: '保存' }))
  fireEvent.keyDown(name, { key: 'Enter' })
  expect(close).not.toHaveBeenCalled()
  expect(useVideoEditEffectLibraryStore.getState().presets).toEqual([])
  fireEvent.click(checkbox)
  fireEvent.change(name, { target: { value: '  ' } })
  fireEvent.keyDown(name, { key: 'Enter' })
  expectButtonDisabled(screen.getByRole('button', { name: '保存' }))
  expect(useVideoEditEffectLibraryStore.getState().presets).toEqual([])
  fireEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(close).toHaveBeenCalledOnce()
  expect(useVideoEditEffectLibraryStore.getState().presets).toEqual([])
})

it('只选择无手绘遮罩的效果时不再显示遮罩选项，并且只保存它', async () => {
  const masked = { ...effect(), id: 'masked', name: '局部柔化', mask: { regionId: 'shapes' as const, shapes: [createVideoEditMaskShape('rect', 'shape')] } }
  render(<VideoEditEffectPresetDialog projectId={instance.document.id} effects={[masked, effect()]} initialName="柔化" onClose={vi.fn()} />)
  expect(screen.getByRole('switch', { name: '保存手绘遮罩' })).toBeTruthy()
  fireEvent.click(screen.getByRole('checkbox', { name: '保存效果：局部柔化' }))
  expect(screen.queryByRole('switch', { name: '保存手绘遮罩' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(useVideoEditEffectLibraryStore.getState().presets[0].effects.map(effect => effect.id)).toEqual(['effect']))
})

it.each(['save', 'rename'])('重名时保存与改名弹窗保留输入并显示冲突名：%s', async mode => {
  const a = seedVideoEditEffectPreset(useVideoEditEffectLibraryStore.getState(), '已存在的柔化', [effect()])
  const b = seedVideoEditEffectPreset(useVideoEditEffectLibraryStore.getState(), '另一项', [effect()])
  const close = vi.fn()
  render(mode === 'rename' ? <VideoEditEffectPresetDialog presetId={b.id} initialName={a.name} onClose={close} /> : <VideoEditEffectPresetDialog projectId={instance.document.id} effects={[effect()]} initialName={a.name} onClose={close} />)
  fireEvent.click(screen.getByRole('button', { name: '保存' }))
  expect((await screen.findByRole('alert')).textContent).toContain(a.name)
  expect(close).not.toHaveBeenCalled()
  expect(useVideoEditEffectLibraryStore.getState().presets.map(value => value.name)).toEqual([a.name, b.name])
})

it('移除项保留时种类下拉显示回退播放标签，仍可打开并选当前目录', () => {
  const sequenceId = getActiveVideoEditSequence(instance).id
  const clipId = getActiveVideoEditSequence(instance).clips[0].id
  editVideoProject(instance.document.id, document => ({ ...document, sequences: document.sequences.map(sequence => sequence.id === sequenceId ? { ...sequence, transitions: [{ id: 'removed', kind: 'gl.Bounce', rightClipId: clipId, durationFrames: 10 }] } : sequence) }))
  selectVideoEditTransition(instance.document.id, 'removed')
  render(<VideoEditTransitionPanel instance={instance} sequence={getActiveVideoEditSequence(instance)} onError={vi.fn()} />)
  const dropdown = screen.getByRole('button', { name: '过渡种类' })
  expect(dropdown.textContent).toContain('已移除的过渡（按交叉溶解播放）')
  fireEvent.click(dropdown)
  expect(screen.getByText('形状擦除')).toBeTruthy()
})
