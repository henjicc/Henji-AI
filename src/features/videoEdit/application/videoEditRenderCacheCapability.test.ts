// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { getPlatform } from '@/platform/runtime'
import type { VideoRenderCacheStoredEntry } from '@/core/videoEdit/renderCacheStore'
import { createVideoEditTestDocument } from '@/core/videoEdit/testFixtures'
import { openSeededVideoEdit } from './videoEditDocumentTestKit'
import { appendVideoEditClip, appendVideoEditSequence, closeVideoEditProject, editVideoProject, getActiveVideoEditSequence, listVideoEditInstances, switchVideoEditSequence } from './videoEditService'
import { clearVideoEditRenderCache, getVideoEditRenderPreference, readVideoEditRenderCache, readyVideoEditRenderWindows, renderVideoEditRenderCache, videoEditRenderCacheWindows, videoEditRenderProfile } from './videoEditRenderCache'

const pixels = vi.hoisted(() => ({ render: vi.fn(async (..._args: unknown[]) => {}) }))
vi.mock('../engine/videoEditRenderSession', () => ({ VideoEditRenderSession: class {
  canvas = {}; render = pixels.render; setTracks() {} setSmartRegions() {} async dispose() {}
} }))
vi.mock('mediabunny', () => ({
  CanvasSource: class { async add() {} }, Mp4OutputFormat: class {}, StreamTarget: class {},
  Output: class { addVideoTrack() {} async start() {} async finalize() {} async cancel() {} },
}))

beforeEach(() => { installHarnessNativeStorage(); localStorage.clear(); pixels.render.mockReset().mockResolvedValue(undefined) })
afterEach(async () => {
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); uninstallHarnessNativeStorage()
})

async function fixture() {
  let files: VideoRenderCacheStoredEntry[] = []
  let release!: () => void
  const prepared = new Promise<void>(resolve => { release = resolve })
  vi.spyOn(getPlatform().mediaCache, 'renderList').mockImplementation(async () => { await prepared; return files })
  const remove = vi.spyOn(getPlatform().mediaCache, 'renderRemove').mockImplementation(async request => {
    const before = files.length
    files = files.filter(entry => request.windowKeys && !request.windowKeys.includes(entry.windowKey))
    return before - files.length
  })
  const owner = await openSeededVideoEdit(createVideoEditTestDocument('预渲染助手覆盖')), id = owner.document.id
  appendVideoEditClip(id); appendVideoEditClip(id)
  editVideoProject(id, document => {
    const next = structuredClone(document)
    next.sequences[0].clips[1].start = 200
    return next
  })
  const composition = getActiveVideoEditSequence(owner)
  const windows = videoEditRenderCacheWindows(owner, composition)
  const profile = videoEditRenderProfile(composition).profile
  files = [...new Map(windows.map(window => [window.key, {
    projectId: id, sequenceId: composition.id, windowKey: window.key, profile, startFrame: window.startFrame, endFrame: window.endFrame,
    width: composition.width, height: composition.height, fps: composition.fps, path: `D:/fixture/${window.key}.mp4`, bytes: 10,
  }])).values()]
  release()
  readyVideoEditRenderWindows(id, composition)
  await vi.waitFor(() => expect(readVideoEditRenderCache(id).readyFrames).toBe(290))
  return { owner, id, composition, windows, remove, files: () => files }
}

it('公共能力清理相交窗口并回读渲染条，记录验证效果；未相交预览和剪辑内容保留', async () => {
  const { owner, id, windows, files, remove } = await fixture()
  const app = createApplicationHarness(), documentRef = { kind: 'video_edit.document', id }
  const before = owner.document, history = owner.past.length
  const gap = windows.find(window => window.startFrame >= 90 && window.endFrame <= 200)!
  expect(gap).toBeDefined()
  const range = { startFrame: gap.startFrame + 1, endFrame: gap.endFrame - 1 }
  try {
    const result = await app.call('clear_video_edit_preview', { documentRef, range })
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, data: { verified: true } })
    expect(remove).toHaveBeenLastCalledWith({ projectId: id, windowKeys: [gap.key] })
    expect(files().some(entry => entry.windowKey === gap.key)).toBe(false)
    expect(files().length).toBeGreaterThan(0)
    const read = await app.read(documentRef, ['video_edit.document.render_cache']) as { properties: Record<string, { windows: Array<{ startFrame: number; state: string }> }> }
    expect(read.properties['video_edit.document.render_cache'].windows.find(window => window.startFrame === gap.startFrame)?.state).not.toBe('ready')
    expect(owner.document).toBe(before); expect(owner.past).toHaveLength(history)
    const all = await app.call('clear_video_edit_preview', { documentRef })
    expect(all, JSON.stringify(all)).toMatchObject({ ok: true, data: { verified: true } })
    expect(readVideoEditRenderCache(id).readyFrames).toBe(0); expect(files()).toEqual([])
  } finally { app.dispose() }
})

it('自动渲染经正式描述、通用写入与回读，错误类型拒绝；渲染工具的范围与 scope 保持可调用', async () => {
  const { id } = await fixture()
  const app = createApplicationHarness(), ref = { kind: 'video_edit.document', id }
  try {
    const description = await app.requireResult('describe_application_entities', { entityTypes: [ref.kind], refs: [ref] })
    expect(JSON.stringify(description)).toContain('video_edit.document.render_preference')
    for (const autoRender of [false, true]) {
      expect((await app.change(ref, { 'video_edit.document.render_preference': { autoRender } })).ok).toBe(true)
      const read = await app.read(ref, ['video_edit.document.render_preference']) as { properties: Record<string, unknown> }
      expect(read.properties['video_edit.document.render_preference']).toEqual({ autoRender })
      expect(getVideoEditRenderPreference(id)).toEqual({ autoRender })
    }
    expect((await app.change(ref, { 'video_edit.document.render_preference': { autoRender: 'false' } })).ok).toBe(false)
    expect(getVideoEditRenderPreference(id).autoRender).toBe(true)
    const render = await app.call('render_video_edit_preview', { documentRef: ref, range: { startFrame: 0, endFrame: 20 }, scope: 'all' })
    expect(render, JSON.stringify(render)).toMatchObject({ ok: true, data: { verified: true, pendingWindows: 0 } })
  } finally { app.dispose() }
})

it('序列清理只按调用时的序列窗口选文件，其他序列独有的文件保留', async () => {
  const { owner, id, composition, files } = await fixture()
  const before = files().map(entry => entry.windowKey)
  const secondId = appendVideoEditSequence(id)
  switchVideoEditSequence(id, secondId)
  const app = createApplicationHarness(), documentRef = { kind: 'video_edit.document', id }
  try {
    const output = await app.call('clear_video_edit_preview', { documentRef })
    expect(output, JSON.stringify(output)).toMatchObject({ ok: true, data: { verified: true } })
    expect(files().map(entry => entry.windowKey)).toEqual(before)
    switchVideoEditSequence(id, composition.id)
    expect(readVideoEditRenderCache(id).readyFrames).toBe(290)
    expect(owner.activeSequenceId).toBe(composition.id)
  } finally { app.dispose() }
})

it('清理期间切换序列仍回读原目标并报告成功，不切回用户界面', async () => {
  const { owner, id, composition, remove } = await fixture()
  const secondId = appendVideoEditSequence(id)
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  remove.mockImplementationOnce(async () => { await gate; return 3 })
  const app = createApplicationHarness()
  try {
    const pending = app.call('clear_video_edit_preview', { documentRef: { kind: 'video_edit.document', id } })
    await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce())
    switchVideoEditSequence(id, secondId); release()
    expect(await pending).toMatchObject({ ok: true, data: { verified: true } })
    expect(owner.activeSequenceId).toBe(secondId)
    expect(readVideoEditRenderCache(id, composition.id).readyFrames).toBe(0)
  } finally { release(); app.dispose() }
})

it('助手取消真实后台任务并保留先前完成的预览，取消后回读没有进行中任务', async () => {
  const { owner, id, windows } = await fixture()
  const gap = windows.find(window => window.startFrame >= 90 && window.endFrame <= 200)!
  const range = { startFrame: gap.startFrame, endFrame: gap.endFrame }
  await clearVideoEditRenderCache(id, range)
  const ready = readVideoEditRenderCache(id).readyFrames
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  pixels.render.mockImplementationOnce(() => gate)
  vi.spyOn(getPlatform().mediaCache, 'renderBegin').mockResolvedValue('D:/fixture/render.tmp')
  vi.spyOn(getPlatform().mediaCache, 'renderDiscard').mockResolvedValue(undefined)
  const render = renderVideoEditRenderCache(id, { range, scope: 'all' })
  const app = createApplicationHarness(), before = owner.document
  try {
    await vi.waitFor(() => expect(pixels.render).toHaveBeenCalled())
    const output = await app.call('cancel_video_edit_preview', { documentRef: { kind: 'video_edit.document', id } })
    expect(output, JSON.stringify(output)).toMatchObject({ ok: true, data: { verified: true } })
    expect(await render).toMatchObject({ cancelled: true })
    expect(readVideoEditRenderCache(id)).toMatchObject({ readyFrames: ready, rendering: null })
    expect(owner.document).toBe(before)
  } finally { release(); app.dispose() }
})
