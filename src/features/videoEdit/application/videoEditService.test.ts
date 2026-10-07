// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import { appendVideoEditSequence, duplicateVideoEditSequence, deleteVideoEditSequence, switchVideoEditSequence, updateVideoEditSequenceSettings, getActiveVideoEditSequence, editVideoSequence, appendVideoEditClip, appendVideoEditMedia, editVideoProject, saveVideoEdit, undoVideoEdit, videoEditDomainRevision, setVideoEditView, subscribeVideoEdit, subscribeVideoEditView } from './videoEditService'
import { splitVideoEditClip, clipSourceSeconds, adjustVideoEditClip } from '@/core/videoEdit/document'
import { closeAllVideoEdits, failVideoEditSaves, reopenVideoEdit, savedVideoEdit, videoEditWrites, createLegacyTrackVideoEditProject } from './videoEditDocumentTestKit'
import { harnessDocumentStore } from '@/tests/harnessNativeStorage'
import { dropVideoEditInput, videoEditDropPaths } from './videoEditDrop'
import { importVideoEditPaths, sameVideoEditMediaPath } from './videoEditMedia'
import { getApplicationControlExecutionEngine } from '@/features/application-control/capabilities/applicationControlRegistry'
import type { ApplicationExecutionContext } from '@/core/application-control'
import { createHostContextSnapshot, retainHostContextTracking } from '@/features/application-control/hostContext/hostContext'
import { useNavigationStore } from '@/stores/navigationStore'
import { freezeApplicationWrites } from '@/core/applicationLifecycle/applicationWriteBarrier'
import { beginVideoEditGesture, finishVideoEditGesture, updateVideoEditPicturePosition } from './videoEditService'
import { createVideoEditGraphic } from '@/core/videoEdit/graphics'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'

it('原生图形和调整范围独立持久，复制序列重映射转场，错误草稿不改变历史', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const sequenceId = owner.activeSequenceId
  editVideoProject(id, document => {
    const sequence = document.sequences[0]
    document.items.push({ id: 'native-graphic', name: '图形', kind: 'graphic', graphic: createVideoEditGraphic('rect', 3840, 2160) }, { id: 'native-adjustment', name: '调整层', kind: 'adjustment' })
    const left = makeVideoEditItemClip(document, 'native-graphic', sequenceId, { frame: 0, duration: 30 })
    const right = makeVideoEditItemClip(document, 'native-graphic', sequenceId, { frame: 30, duration: 30 })
    const adjustment = makeVideoEditItemClip(document, 'native-adjustment', sequenceId, { frame: 0, duration: 60, track: 2 })
    sequence.clips = [left, right, adjustment]
    sequence.transitions = [{ id: 'native-transition', kind: 'cross_dissolve', leftClipId: left.id, rightClipId: right.id, durationFrames: 10 }]
    return document
  })
  const original = owner.document; const past = owner.past.length
  const adjustment = getActiveVideoEditSequence(owner).clips[2]
  const gesture = beginVideoEditGesture(id)
  expect(() => updateVideoEditPicturePosition(gesture, sequenceId, adjustment.id, { x: .1, y: 0 })).toThrow('作用范围')
  expect(owner.document).toBe(original); finishVideoEditGesture(gesture, false)
  expect(owner.past).toHaveLength(past)
  const duplicateId = duplicateVideoEditSequence(id, sequenceId)
  const duplicate = owner.document.sequences.find(sequence => sequence.id === duplicateId)!
  expect(duplicate.transitions![0].id).not.toBe('native-transition')
  expect(duplicate.transitions![0].leftClipId).toBe(duplicate.clips[0].id)
  editVideoSequence(id, duplicateId, sequence => { sequence.clips[0].graphic!.objects[0].parameters.x = 123; return sequence })
  expect(owner.document.items[0].graphic!.objects[0].parameters.x).not.toBe(123)
  expect(owner.document.sequences[0].clips[0].graphic!.objects[0].parameters.x).not.toBe(123)
  const beforeReject = owner.document; const history = owner.past.length
  expect(() => editVideoSequence(id, duplicateId, sequence => { sequence.transitions![0].durationFrames = 1000; return sequence })).toThrow('超出')
  expect(owner.document).toBe(beforeReject); expect(owner.past).toHaveLength(history)
  await saveVideoEdit(id); const saved = structuredClone(owner.document)
  const reopened = await reopenVideoEdit(id)
  expect(reopened.document).toEqual({ ...saved, revision: 0 })
})
it('受限画面位置草稿保留时间及锚定对象，保存等待释放并只记录一笔历史', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const sequenceId = owner.activeSequenceId
  appendVideoEditClip(id); const clipId = owner.selection!; appendVideoEditClip(id)
  editVideoSequence(id, sequenceId, sequence => ({ ...sequence, captions: [{ id: 'position-caption', clipId, start: 1, duration: 3, text: '跟随' }], markers: [{ id: 'position-marker', clipId, frame: 2, name: '时刻' }] }))
  await saveVideoEdit(id)
  const before = owner.document; const sequence = getActiveVideoEditSequence(owner); const history = owner.past.length
  const writes = videoEditWrites()
  const gesture = beginVideoEditGesture(id)
  for (let step = 1; step <= 60; step++) updateVideoEditPicturePosition(gesture, sequenceId, clipId, { x: step / 120, y: -step / 120 })
  const moved = getActiveVideoEditSequence(owner)
  expect(moved.clips[0]).toEqual({ ...sequence.clips[0], x: .5, y: -.5 })
  expect(moved.clips[1]).toBe(sequence.clips[1]); expect(moved.captions).toBe(sequence.captions); expect(moved.markers).toBe(sequence.markers)
  expect(owner.document.media).toBe(before.media); expect(owner.document.items).toBe(before.items); expect(owner.past).toHaveLength(history)
  let resolved = false
  const saving = saveVideoEdit(id).then(() => { resolved = true })
  await new Promise(resolve => setTimeout(resolve, 10)); expect(resolved).toBe(false); expect(videoEditWrites()).toBe(writes)
  const current = owner.document
  updateVideoEditPicturePosition(gesture, sequenceId, clipId, { x: .5, y: -.5 }); expect(owner.document).toBe(current)
  finishVideoEditGesture(gesture); await saving
  expect(videoEditWrites()).toBe(writes + 1); expect(owner.past).toHaveLength(history + 1)
  expect(owner.past.at(-1)).toBe(before); expect(before.sequences[0].clips[0].x).toBe(0)
  expect(savedVideoEdit(owner).sequences[0].clips).toEqual(moved.clips)
  editVideoSequence(id, sequenceId, draft => { draft.captions![0].text = '普通编辑'; return draft })
  expect(moved.captions![0].text).toBe('跟随'); expect(sequence.captions![0].text).toBe('跟随')
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips).toEqual(moved.clips)
  undoVideoEdit(id); expect(getActiveVideoEditSequence(owner).clips).toEqual(sequence.clips)
})
it('受限位置写入拒绝越界、额外属性、锁定和旧手势，应用关闭屏障同样生效', async () => {
  const owner = (await createLegacyTrackVideoEditProject()); const id = owner.document.id; const sequenceId = owner.activeSequenceId
  appendVideoEditClip(id); const clipId = owner.selection!
  editVideoSequence(id, sequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(track => ({ ...track, locked: true })) }))
  let gesture = beginVideoEditGesture(id)
  expect(() => updateVideoEditPicturePosition(gesture, sequenceId, clipId, { x: .1, y: .2 })).toThrow('锁定')
  finishVideoEditGesture(gesture, false)
  editVideoSequence(id, sequenceId, sequence => ({ ...sequence, tracks: sequence.tracks.map(track => ({ ...track, locked: false })) }))
  gesture = beginVideoEditGesture(id); const before = owner.document
  expect(() => updateVideoEditPicturePosition({ ...gesture }, sequenceId, clipId, { x: .1, y: .2 })).toThrow('已结束')
  for (const position of [{ x: 3, y: 0 }, { x: NaN, y: 0 }, { x: 0, y: Infinity }, { x: .1, y: .2, text: '越权' }]) expect(() => updateVideoEditPicturePosition(gesture, sequenceId, clipId, position)).toThrow()
  expect(() => updateVideoEditPicturePosition(gesture, 'foreign-sequence', clipId, { x: .1, y: .2 })).toThrow('不存在')
  expect(owner.document).toBe(before)
  const release = freezeApplicationWrites()
  try { expect(() => updateVideoEditPicturePosition(gesture, sequenceId, clipId, { x: .1, y: .2 })).toThrow('APPLICATION_CLOSING') } finally { release() }
  updateVideoEditPicturePosition(gesture, sequenceId, clipId, { x: .1, y: .2 }); finishVideoEditGesture(gesture, false)
  expect(getActiveVideoEditSequence(owner).clips[0].x).toBe(0)
  expect(() => updateVideoEditPicturePosition(gesture, sequenceId, clipId, { x: .3, y: .2 })).toThrow('已结束')
})
it('序列切换和选区刷新助手上下文，控制改变并发基线而逐帧观察保持稳定', async () => {
  const navigation = useNavigationStore.getState()
  const release = retainHostContextTracking()
  try {
    const instance = (await createLegacyTrackVideoEditProject())
    const projectId = instance.document.id
    const sequenceId = appendVideoEditSequence(projectId)
    useNavigationStore.setState({ activeWorkspace: 'videoEdit' })
    const before = createHostContextSnapshot()
    switchVideoEditSequence(projectId, sequenceId)
    const switched = createHostContextSnapshot()
    expect(switched.surface?.focusedRef).toBe(`video_edit.sequence:${projectId}:${sequenceId}`)
    expect(switched.revision).toBeGreaterThan(before.revision)
    expect(switched.scopeRevisions.video_edit).toBeGreaterThan(before.scopeRevisions.video_edit)
    setVideoEditView(projectId, { frame: 60 })
    expect(createHostContextSnapshot().revision).toBe(switched.revision)
    const controlled = createHostContextSnapshot()
    expect(controlled.scopeRevisions.video_edit).toBeGreaterThan(switched.scopeRevisions.video_edit)
    setVideoEditView(projectId, { frame: 61 }, true)
    expect(createHostContextSnapshot().scopeRevisions.video_edit).toBe(controlled.scopeRevisions.video_edit)
    appendVideoEditClip(projectId)
    const edited = createHostContextSnapshot()
    expect(edited.surface?.selectedRefs).toContain(`video_edit.clip:${projectId}:${instance.selection}`)
    // The edit block carries what an agent needs to aim: owner, sequence, time, range, focus, multi-select, targets.
    expect(edited.videoEdit).toMatchObject({ documentRef: `video_edit.document:${projectId}`, sequenceRef: `video_edit.sequence:${projectId}:${sequenceId}`, frame: 61, playing: false, focusedPanel: instance.activePanel,
      selectedClipRefs: [`video_edit.clip:${projectId}:${instance.selection}`], targetTrackRefs: instance.targetTrackIds.map(track => `video_edit.track:${projectId}:${track}`) })
    for (let index = 0; index < 40; index++) instance.selectedItemIds.push(`bulk-${index}`)
    expect(createHostContextSnapshot().surface?.selectedRefs[0]).toBe(`video_edit.clip:${projectId}:${instance.selection}`)
    expect(edited.scopeRevisions.video_edit).toBeGreaterThan(switched.scopeRevisions.video_edit)
  } finally { release(); useNavigationStore.setState(navigation) }
})
it('编辑与撤销在页面外静默自动保存，播放和定位不写剪辑', async () => {
  const instance = (await createLegacyTrackVideoEditProject())
  appendVideoEditClip(instance.document.id)
  await vi.waitFor(() => expect(savedVideoEdit(instance).sequences[0].clips).toHaveLength(1), { timeout: 3000 })
  undoVideoEdit(instance.document.id)
  await vi.waitFor(() => expect(savedVideoEdit(instance).sequences[0].clips).toHaveLength(0), { timeout: 3000 })
  const writes = videoEditWrites()
  setVideoEditView(instance.document.id, { frame: 15, playing: false })
  await new Promise(resolve => setTimeout(resolve, 900))
  expect(videoEditWrites()).toBe(writes); expect(instance.dirty).toBe(false)
})
it('自动保存失败保留修改并在磁盘恢复后只重试保存，不重放编辑', async () => {
  vi.useFakeTimers()
  try {
    const instance = (await createLegacyTrackVideoEditProject())
    failVideoEditSaves(true); appendVideoEditClip(instance.document.id)
    await vi.advanceTimersByTimeAsync(800)
    expect(instance.dirty).toBe(true); expect(instance.error).toContain('修改仍保留在当前剪辑')
    const history = instance.past.length
    failVideoEditSaves(false); await vi.advanceTimersByTimeAsync(2000)
    expect(savedVideoEdit(instance).sequences[0].clips).toHaveLength(1)
    expect(instance.dirty).toBe(false); expect(instance.past).toHaveLength(history)
  } finally { vi.useRealTimers() }
})
it('素材库规范化的 Windows 路径与原引用是同一素材，拖放不增加导入历史', async () => {
  const instance = (await createLegacyTrackVideoEditProject())
  const media = { id: 'picture', name: 'Card.png', path: 'D:/Media/Card.png', kind: 'image' as const, width: 320, height: 180, durationSeconds: 0 }
  appendVideoEditMedia(instance.document.id, media)
  const before = instance.past.length
  await importVideoEditPaths(instance.document.id, ['d:\\media\\card.png'])
  await dropVideoEditInput(instance.document.id, { kind: 'sources', sources: [{ path: 'd:/media/card.png' }] }, { frame: 12, track: 2 })
  expect(instance.document.media).toEqual([media])
  expect(getActiveVideoEditSequence(instance).clips[0]).toMatchObject({ itemId: instance.document.items[0].id, start: 12, track: 2 })
  expect(instance.past.length).toBe(before + 1)
  undoVideoEdit(instance.document.id); expect(getActiveVideoEditSequence(instance).clips).toHaveLength(0)
  expect(sameVideoEditMediaPath('/media/Card.png', '/media/card.png')).toBe(false)
})
beforeEach(() => {
  installHarnessNativeStorage()
  const platform = getPlatform()
  vi.spyOn(platform.system.paths, 'dirname').mockImplementation(async path => path.replace(/[\\/][^\\/]+$/, ''))
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
})
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); uninstallHarnessNativeStorage() })

it('公共修改与手动编辑共用历史并可保存重开', async () => {
  const instance = (await createLegacyTrackVideoEditProject())
  appendVideoEditClip(instance.document.id)
  const clip = getActiveVideoEditSequence(instance).clips[0]
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'video_edit.clip', id: `${instance.document.id}:${clip.id}` }
    const properties = (await app.read(ref)).properties
    expect(properties).not.toHaveProperty(['video_edit.clip.brightness'])
    expect(properties).not.toHaveProperty(['video_edit.clip.brightness.keyframes'])
    const result = await app.change(ref, { 'video_edit.clip.text': '助手修改', 'video_edit.clip.opacity': 0.7 })
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.clip.text', 'video_edit.clip.opacity'])).properties).toMatchObject({ 'video_edit.clip.text': '助手修改', 'video_edit.clip.opacity': 0.7 })
    expect(instance.past).toHaveLength(2)
    undoVideoEdit(instance.document.id)
    expect(getActiveVideoEditSequence(instance).clips[0].text).toBe('输入文字')
    await saveVideoEdit(instance.document.id)
    const restored = await reopenVideoEdit(instance.document.id)
    expect(getActiveVideoEditSequence(restored).clips).toHaveLength(1)
    expect(getActiveVideoEditSequence(restored).clips[0].text).toBe('输入文字')
  } finally { app.dispose() }
})
it('保存失败保留助手修改且恢复不会重放编辑', async () => {
  const instance = (await createLegacyTrackVideoEditProject())
  const app = createApplicationHarness()
  try {
    // 剪辑名就是文件名，内容能力不改名：改名属性只读并点名通用文档属性
    const renamed = await app.change({ kind: 'video_edit.document', id: instance.document.id }, { 'video_edit.document.name': '改名' })
    expect(renamed.ok).toBe(false); expect(JSON.stringify(renamed)).toContain('documents.document')
    failVideoEditSaves(true)
    const sequenceRef = { kind: 'video_edit.sequence', id: `${instance.document.id}:${instance.activeSequenceId}` }
    const result = await app.change(sequenceRef, { 'video_edit.sequence.name': '保留修改' })
    expect(result.ok).toBe(false)
    expect(instance.document.sequences[0].name).toBe('保留修改'); expect(instance.dirty).toBe(true)
    await expect(saveVideoEdit(instance.document.id)).rejects.toThrow('修改仍保留在当前剪辑')
    expect(instance.error).toContain('请检查项目文件夹是否只读'); expect(instance.error).not.toContain('磁盘已满')
    const historyLength = instance.past.length
    failVideoEditSaves(false); await saveVideoEdit(instance.document.id)
    expect(instance.past).toHaveLength(historyLength)
    expect(savedVideoEdit(instance).sequences[0].name).toBe('保留修改'); expect(instance.error).toBeNull()
  } finally { app.dispose() }
})
it('公共集合新增标注并拒绝跨剪辑引用', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); appendVideoEditClip(instance.document.id)
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'video_edit.sequence', id: `${instance.document.id}:${instance.activeSequenceId}` }
    const baseline = await app.read(ref)
    const result = await app.call('change_application_entities', { summary: '添加时间标注', changes: [{ kind: 'create_items', entityType: 'video_edit.annotation', parent: ref, items: [{ properties: { 'video_edit.annotation.clip_id': getActiveVideoEditSequence(instance).clips[0].id, 'video_edit.annotation.text': '检查此处' } }] }] }, baseline.revisions as Record<string, number>)
    expect(result).toMatchObject({ ok: true }); expect(getActiveVideoEditSequence(instance).annotations[0].text).toBe('检查此处')
    const mark = getActiveVideoEditSequence(instance).annotations[0]
    const rejected = await app.change({ kind: 'video_edit.annotation', id: `${instance.document.id}:${mark.id}` }, { 'video_edit.annotation.clip_id': 'another-project-clip' })
    expect(rejected.ok).toBe(false)
    expect(getActiveVideoEditSequence(instance).annotations[0].clipId).toBe(getActiveVideoEditSequence(instance).clips[0].id)
  } finally { app.dispose() }
})
it('保存中发生新修改时继续写入最新版本而不提前清除脏状态', async () => {
  const instance = (await createLegacyTrackVideoEditProject())
  const rename = (name: string) => editVideoProject(instance.document.id, document => ({ ...document, sequences: document.sequences.map((sequence, index) => index ? sequence : { ...sequence, name }) }))
  rename('第一版')
  let unblock!: () => void
  harnessDocumentStore().saveGate = new Promise<void>(resolve => { unblock = resolve })
  const saving = saveVideoEdit(instance.document.id)
  await new Promise(resolve => setTimeout(resolve, 0))
  rename('保存期间的修改')
  expect(instance.dirty).toBe(true)
  harnessDocumentStore().saveGate = null; unblock(); await saving
  expect(instance.dirty).toBe(false)
  expect(savedVideoEdit(instance).sequences[0].name).toBe('保存期间的修改')
})
it('手动定位推进并发版本，播放观察不推进版本，拆分保持源时间连续', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); appendVideoEditClip(instance.document.id)
  const revision = videoEditDomainRevision()
  setVideoEditView(instance.document.id, { frame: 30 })
  expect(videoEditDomainRevision()).toBe(revision + 1)
  setVideoEditView(instance.document.id, { frame: 31 }, true)
  expect(videoEditDomainRevision()).toBe(revision + 1)
  const original = getActiveVideoEditSequence(instance).clips[0]
  editVideoSequence(instance.document.id, instance.activeSequenceId, sequence => splitVideoEditClip(sequence, original.id, 30))
  const right = getActiveVideoEditSequence(instance).clips[1]
  expect(clipSourceSeconds(right, right.start, 30)).toBe(clipSourceSeconds(original, 30, 30))
  expect(getActiveVideoEditSequence(instance).clips.reduce((sum, clip) => sum + clip.duration, 0)).toBe(original.duration)
})
it('公共拆分从磁盘回读核实片段边界', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); appendVideoEditClip(instance.document.id)
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('split_video_edit', { documentRef: { kind: 'video_edit.document', id: instance.document.id }, clipRef: { kind: 'video_edit.clip', id: `${instance.document.id}:${getActiveVideoEditSequence(instance).clips[0].id}` }, frame: 30 })
    expect(result.verification).toMatchObject({ verified: true })
    const saved = savedVideoEdit(instance)
    expect(saved.sequences[0].clips.map((clip: { start: number; duration: number }) => [clip.start, clip.duration])).toEqual([[0, 30], [30, 60]])
  } finally { app.dispose() }
})

it('通用收集素材能力（4.4）与剪辑页同一入口：外部文件复制进项目并改写引用，从文件回读核实', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const id = instance.document.id
  appendVideoEditMedia(id, { id: 'outside', name: '外部.mp4', path: 'E:/外部/外部.mp4', kind: 'video', durationSeconds: 3, width: 1920, height: 1080 })
  await saveVideoEdit(id)
  const store = harnessDocumentStore()
  const container = store.stored(id)!.meta.container
  if (container.kind !== 'project') throw new Error('剪辑必须在项目里')
  const copied = `${store.projects.get(container.projectId)!.path}/素材/外部.mp4`
  store.collectMapping.set('E:/外部/外部.mp4', copied)
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('collect_document_media', { documentId: id }) as { message: string; verification: { verified: boolean } }
    expect(result.verification.verified).toBe(true)
    expect(result.message).toContain('1 个文件')
    expect(instance.document.media[0].path).toBe(copied)
    expect(savedVideoEdit(instance).media[0].path).toBe(copied)
    const again = await app.requireResult('collect_document_media', { documentId: id }) as { message: string }
    expect(again.message).toContain('没有需要收集的')
  } finally { app.dispose() }
})

it('播放与拖动只通知瞬态叶子，相等写入不通知，也不污染历史或保存', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const id = instance.document.id
  const editor = vi.fn(); const view = vi.fn(); const offEditor = subscribeVideoEdit(editor); const offView = subscribeVideoEditView(view)
  const revision = videoEditDomainRevision()
  try {
    setVideoEditView(id, { frame: 15, scrubbing: true }); setVideoEditView(id, { frame: 15, scrubbing: true }); setVideoEditView(id, { scrubbing: false })
    expect(editor).not.toHaveBeenCalled(); expect(view).toHaveBeenCalledTimes(2)
    expect(videoEditDomainRevision()).toBe(revision + 1); expect(instance.dirty).toBe(false); expect(instance.past).toHaveLength(0)
    setVideoEditView(id, { frame: 16 }, true)
    expect(videoEditDomainRevision()).toBe(revision + 1); expect(editor).not.toHaveBeenCalled()
    await saveVideoEdit(id); expect(savedVideoEdit(instance)).not.toHaveProperty('scrubbing')
    appendVideoEditClip(id); setVideoEditView(id, { selection: null })
    editor.mockClear(); setVideoEditView(id, { selection: getActiveVideoEditSequence(instance).clips[0].id }); expect(editor).toHaveBeenCalledOnce()
  } finally { offEditor(); offView() }
})
it('拖放固定到原剪辑与轨道，直接引用源路径，并复用撤销和磁盘保存', async () => {
  const a = (await createLegacyTrackVideoEditProject())
  const media = { id: 'original', name: 'image.png', kind: 'image' as const, path: 'E:/outside/image.png', durationSeconds: 0, width: 800, height: 600 }
  appendVideoEditMedia(a.document.id, media)
  const b = (await createLegacyTrackVideoEditProject())
  await dropVideoEditInput(a.document.id, { kind: 'sources', sources: [{ path: media.path }] }, { frame: 90, track: 4 })
  expect(getActiveVideoEditSequence(a).clips[0]).toMatchObject({ itemId: a.document.items[0].id, start: 90, track: 4 })
  expect(getActiveVideoEditSequence(b).clips).toHaveLength(0); expect(a.document.media).toHaveLength(1)
  await saveVideoEdit(a.document.id); expect(savedVideoEdit(a).media[0].path).toBe(media.path)
  undoVideoEdit(a.document.id); expect(getActiveVideoEditSequence(a).clips).toHaveLength(0); expect(a.document.media[0]).toEqual(media)
})
it('磁盘文件拖入只取 PAL 原始路径，禁止没有本地路径的内存文件', () => {
  const file = new File(['test'], 'video.mp4', { type: 'video/mp4' })
  const path = vi.spyOn(getPlatform().media, 'getPathForFile').mockReturnValue('E:/outside/video.mp4')
  const transfer = { files: [file], getData: () => '' } as unknown as DataTransfer
  expect(videoEditDropPaths(transfer)).toEqual(['E:/outside/video.mp4']); expect(path).toHaveBeenCalledWith(file)
  path.mockReturnValue(''); expect(() => videoEditDropPaths(transfer)).toThrow('本地文件')
})
it('裁剪即时预览和提交限制在源范围内，保持源时间与剪辑时间换算', async () => {
  const instance = (await createLegacyTrackVideoEditProject())
  appendVideoEditMedia(instance.document.id, { id: 'v', kind: 'video', path: 'E:/v.mp4', name: 'video', durationSeconds: 4, width: 3840, height: 2160 })
  appendVideoEditClip(instance.document.id, 'v', { frame: 30, track: 2 })
  const clip = { ...getActiveVideoEditSequence(instance).clips[0], duration: 60, sourceInUs: 1000000 }
  const trimmed = adjustVideoEditClip(getActiveVideoEditSequence(instance), clip, { mode: 'in', delta: -100, track: 2 })
  expect(trimmed).toMatchObject({ start: 0, duration: 90, sourceInUs: 0 })
  const extended = adjustVideoEditClip(getActiveVideoEditSequence(instance), clip, { mode: 'out', delta: 1000, track: 2 })
  expect(extended.duration).toBe(90)
  expect(clipSourceSeconds(clip, 40, 30)).toBeCloseTo(clipSourceSeconds(trimmed, 40, 30))
})

it('两个不同设置的序列保存冷重开，切换只保留会话，不写剪辑或历史', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const id = instance.document.id
  const first = instance.activeSequenceId
  appendVideoEditMedia(id, { id: 'shared', kind: 'image', path: 'E:/original/image.png', name: '原素材', durationSeconds: 0, width: 1920, height: 1080 })
  appendVideoEditClip(id, 'shared'); const firstClip = getActiveVideoEditSequence(instance).clips[0].id
  setVideoEditView(id, { frame: 23, selection: firstClip })
  const second = appendVideoEditSequence(id, { name: '竖屏', width: 2160, height: 3840, frameRate: { numerator: 30000, denominator: 1001 }, sampleRate: 44100, channels: 1 })
  switchVideoEditSequence(id, second); appendVideoEditClip(id, 'shared'); setVideoEditView(id, { frame: 47 })
  await saveVideoEdit(id)
  const before = instance.document; const history = instance.past.length; const revision = videoEditDomainRevision()
  switchVideoEditSequence(id, first); expect(instance.frame).toBe(23); expect(instance.selection).toBe(firstClip)
  switchVideoEditSequence(id, second); expect(instance.frame).toBe(47)
  expect(instance.document).toBe(before); expect(instance.past).toHaveLength(history); expect(videoEditDomainRevision()).toBe(revision + 2); expect(instance.dirty).toBe(false)
  const reopened = await reopenVideoEdit(id)
  expect(reopened.document.sequences).toHaveLength(2)
  expect(reopened.document.sequences[1]).toMatchObject({ name: '竖屏', width: 2160, height: 3840, sampleRate: 44100, channels: 1, frameRate: { numerator: 30000, denominator: 1001 } })
  expect(reopened.document.media[0].path).toBe('E:/original/image.png')
  expect(reopened.document.sequences.flatMap(sequence => sequence.clips.map(clip => clip.itemId))).toEqual([reopened.document.items[0].id, reopened.document.items[0].id])
})
it('复制序列重建实例标识但复用素材项，删除和设置变更共用历史', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const id = instance.document.id; const first = instance.activeSequenceId
  appendVideoEditClip(id); setVideoEditView(id, { frame: 30 })
  const duplicate = duplicateVideoEditSequence(id, first)
  const [source, copy] = instance.document.sequences
  expect(copy.clips[0].id).not.toBe(source.clips[0].id); expect(copy.clips[0].itemId).toBe(source.clips[0].itemId)
  expect(copy.tracks[0].id).not.toBe(source.tracks[0].id)
  updateVideoEditSequenceSettings(id, first, { frameRate: { numerator: 60, denominator: 1 }, pixelAspectRatio: { numerator: 2, denominator: 1 } })
  expect(instance.frame).toBe(60); expect(getActiveVideoEditSequence(instance).width).toBe(3840)
  undoVideoEdit(id); expect(instance.frame).toBe(30); expect(getActiveVideoEditSequence(instance).width).toBe(1920)
  switchVideoEditSequence(id, duplicate); expect(() => deleteVideoEditSequence(id, duplicate)).toThrow('请先移除')
  editVideoSequence(id, duplicate, sequence => ({ ...sequence, clips: [], annotations: [] })); deleteVideoEditSequence(id, duplicate)
  expect(instance.activeSequenceId).toBe(first); undoVideoEdit(id); expect(instance.document.sequences).toHaveLength(2)
})
it('公共事务修改后台序列设置与片段为一步撤销，前台选区和原目标不变', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const id = instance.document.id; const first = instance.activeSequenceId
  appendVideoEditClip(id)
  const second = duplicateVideoEditSequence(id, first)
  setVideoEditView(id, { frame: 17 })
  const seqRef = { kind: 'video_edit.sequence', id: `${id}:${second}` }
  const clipRef = { kind: 'video_edit.clip', id: `${id}:${instance.document.sequences[1].clips[0].id}` }
  const app = createApplicationHarness()
  try {
    const baseline = await app.read(seqRef); const history = instance.past.length
    const result = await app.call('change_application_entities', { summary: '修改后台竖屏序列', changes: [
      { kind: 'set_properties', entityType: 'video_edit.sequence', target: seqRef, properties: { 'video_edit.sequence.width': 2160, 'video_edit.sequence.height': 3840, 'video_edit.sequence.frame_rate': { numerator: 30000, denominator: 1001 }, 'video_edit.sequence.sample_rate': 44100, 'video_edit.sequence.channels': 1 } },
      { kind: 'set_properties', entityType: 'video_edit.clip', target: clipRef, properties: { 'video_edit.clip.text': '后台修改' } },
    ] }, baseline.revisions as Record<string, number>)
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true })
    expect(instance.activeSequenceId).toBe(first); expect(instance.frame).toBe(17); expect(instance.past).toHaveLength(history + 1)
    expect(instance.document.sequences[1]).toMatchObject({ width: 2160, height: 3840, channels: 1, sampleRate: 44100 })
    expect(instance.document.sequences[1].clips[0].text).toBe('后台修改')
    undoVideoEdit(id); expect(instance.document.sequences[1].width).toBe(1920); expect(instance.document.sequences[1].clips[0].text).toBe('输入文字')
  } finally { app.dispose() }
})

it('正式事务撤销保留实体引用，帧率写入回执包含实际片段级联', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const id = instance.document.id
  appendVideoEditClip(id); const clipId = getActiveVideoEditSequence(instance).clips[0].id
  editVideoSequence(id, instance.activeSequenceId, sequence => { sequence.clips[0].curves = { opacity: [{ time: 0, value: 0, interpolation: 'linear' }, { time: 30, value: 1, interpolation: 'linear' }] }; return sequence })
  const originalCurves = structuredClone(getActiveVideoEditSequence(instance).clips[0].curves)
  const directCurves = [{ time: 0, value: 1, interpolation: 'hold' }]
  const engine = getApplicationControlExecutionEngine()
  const context: ApplicationExecutionContext = { requestId: crypto.randomUUID(), exposure: 'assistant', permissions: new Set(['video_edit:read', 'video_edit:write']), acceptedDataClasses: new Set(['C1']) }
  for (const [target, propertyId, value] of [
    [{ kind: 'video_edit.clip', id: `${id}:${clipId}` }, 'video_edit.clip.text', '正式撤销'],
    [{ kind: 'video_edit.sequence', id: `${id}:${instance.activeSequenceId}` }, 'video_edit.sequence.frame_rate', { numerator: 60, denominator: 1 }],
    [{ kind: 'video_edit.clip', id: `${id}:${clipId}` }, 'video_edit.clip.duration', 20],
    [{ kind: 'video_edit.clip', id: `${id}:${clipId}` }, 'video_edit.clip.opacity.keyframes', directCurves],
  ] as const) {
    const revisions = { video_edit: videoEditDomainRevision() }
    const plan = await engine.plan({ summary: '实体修改与撤销', transactionMode: 'atomic', steps: [{ kind: 'mutation', entityType: target.kind, target, expectedRevisions: revisions, mutations: [{ propertyId, operation: 'set', value }] }] }, context)
    const result = await engine.commit({ planRef: plan.planRef, expectedRevisions: revisions, idempotencyKey: crypto.randomUUID() }, context)
    expect(result.status, JSON.stringify(result)).toBe('completed')
    if (result.status !== 'completed' || !result.undoRef) throw new Error('没有可撤销回执')
    const declarationId = propertyId === 'video_edit.sequence.frame_rate' ? 'video_edit.sequence_clip_time' : propertyId === 'video_edit.clip.duration' ? 'video_edit.clip_keyframe_time' : undefined
    const expectedCascade = declarationId ? expect.objectContaining({ entityType: 'video_edit.clip', propertyIds: expect.arrayContaining(['video_edit.clip.opacity.keyframes']), refs: [{ kind: 'video_edit.clip', id: `${id}:${clipId}` }], origin: { kind: 'cascade', declarationId } }) : undefined
    if (expectedCascade) {
      expect(result.effects).toEqual(expect.arrayContaining([expectedCascade]))
      expect(getActiveVideoEditSequence(instance).clips[0].curves!.opacity!.at(-1)?.time).toBe(propertyId === 'video_edit.sequence.frame_rate' ? 60 : 19)
    } else expect(result.effects.filter(effect => effect.origin.kind === 'cascade')).toEqual([])
    const undone = await engine.undo({ undoRef: result.undoRef, expectedRevisions: result.resultingRevisions, idempotencyKey: crypto.randomUUID() }, context)
    expect(undone.status, JSON.stringify(undone)).toBe('completed')
    if (undone.status !== 'completed') throw new Error('撤销没有完成')
    if (expectedCascade) expect(undone.effects).toEqual(expect.arrayContaining([expectedCascade]))
    expect(getActiveVideoEditSequence(instance).clips[0]).toMatchObject({ duration: 90, text: '输入文字' })
    expect(getActiveVideoEditSequence(instance).clips[0].curves).toEqual(originalCurves)
  }
})
it('移除未使用的素材项后再次添加原媒体，在一次编辑内恢复引用', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const id = instance.document.id
  appendVideoEditMedia(id, { id: 'unused', kind: 'image', path: 'E:/unused.png', name: '未使用', durationSeconds: 0, width: 320, height: 180 })
  editVideoProject(id, document => ({ ...document, items: [] }))
  const history = instance.past.length
  appendVideoEditClip(id, 'unused')
  expect(instance.document.items).toHaveLength(1); expect(getActiveVideoEditSequence(instance).clips[0].itemId).toBe(instance.document.items[0].id)
  expect(instance.past).toHaveLength(history + 1)
})
it('异步拖放开始后切换序列，片段仍落在开始时序列', async () => {
  const instance = (await createLegacyTrackVideoEditProject()); const id = instance.document.id; const first = instance.activeSequenceId
  appendVideoEditMedia(id, { id: 'drop', kind: 'image', path: 'E:/drop.png', name: '拖放', durationSeconds: 0, width: 320, height: 180 })
  const second = appendVideoEditSequence(id)
  const dropping = dropVideoEditInput(id, { kind: 'sources', sources: [{ path: 'E:/drop.png' }] }, { frame: 30, track: 1 })
  switchVideoEditSequence(id, second); await dropping
  expect(instance.document.sequences.find(sequence => sequence.id === first)!.clips).toHaveLength(1)
  expect(getActiveVideoEditSequence(instance).clips).toHaveLength(0)
})
