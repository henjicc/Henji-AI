import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { Blob as NativeBlob } from 'node:buffer'
import { getPlatform } from '@/platform/runtime'
import type { AssetRecord } from '@/platform/contracts/assetLibrary'
import type { VideoEditComposition } from '@/core/videoEdit/document'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { appendVideoEditMedia, appendVideoEditClip, closeVideoEditProject, listVideoEditInstances, setVideoEditView } from './videoEditService'

// The production renderer is the replaced pixel boundary; composition building, scaling,
// library collection and the public capability are real.
const render = vi.hoisted(() => ({ calls: [] as Array<{ document: VideoEditComposition; frame: number }> }))
vi.mock('./videoEditCodeTrial', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), trialVideoEditCodeFrames: vi.fn(async (frames: Array<{ document: VideoEditComposition; frame: number }>) => {
  render.calls.push(...frames); const last = frames.at(-1)!
  return { width: last.document.width, height: last.document.height, close: vi.fn() }
}) }))
vi.mock('mediabunny', () => ({ ALL_FORMATS: [], UrlSource: class {}, Input: class { async getPrimaryVideoTrack() { return null } async getPrimaryAudioTrack() { return null } async computeDuration() { return 0 } dispose() {} } }))
const assets = new Map<string, AssetRecord>(); const drawn: number[][] = []
beforeEach(() => {
  installHarnessNativeStorage(); assets.clear(); render.calls = []; drawn.length = 0
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {}
    getContext() { return { imageSmoothingQuality: 'low', drawImage: (_image: unknown, _x: number, _y: number, w: number, h: number) => drawn.push([w, h]) } }
    async convertToBlob() { return new NativeBlob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) } })
  const platform = getPlatform(); let size = { width: 0, height: 0 }
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue('D:/observe.henji-video')
  vi.spyOn(platform.system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue('D:/managed')
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(platform.image, 'persistImageBinary').mockImplementation(async () => { size = { width: drawn.at(-1)![0], height: drawn.at(-1)![1] }; return `D:/managed/observe-${drawn.length}.png` })
  vi.spyOn(platform.assetLibrary, 'createAsset').mockImplementation(async input => {
    const value: AssetRecord = { id: `asset-${assets.size + 1}`, filePath: input.filePath, mediaType: 'image', displayName: input.displayName ?? '', displayUrl: '', source: input.source, mimeType: 'image/png', sizeBytes: 4, width: size.width, height: size.height, durationSeconds: 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1, contentIdentity: 'd'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
    assets.set(value.id, value); return value
  })
  vi.spyOn(platform.assetLibrary, 'inspectAsset').mockImplementation(async id => structuredClone(assets.get(id)!))
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

it('公共观察按固定剪辑版本取指定合成帧与源时间画面，不改播放头，结果为可读资产', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditMedia(id, { id: 'clip-media', name: '4K原片', path: 'D:/media/original.mp4', kind: 'video', width: 3840, height: 2160, durationSeconds: 7, frameRate: { numerator: 60, denominator: 1 }, frameRateMode: 'sampled-constant' })
  appendVideoEditClip(id, 'clip-media'); setVideoEditView(id, { frame: 3 })
  const item = owner.document.items.find(item => item.mediaId === 'clip-media')!
  const app = createApplicationHarness()
  try {
    const program = await app.requireResult('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'program', frame: 42 }, maxWidth: 960 })
    expect(render.calls[0]).toMatchObject({ frame: 42, document: { id: owner.activeSequenceId, revision: owner.document.revision } })
    expect(program).toMatchObject({ width: 960, height: 540, sourceWidth: 1920, sourceHeight: 1080, documentRevision: owner.document.revision, resultRef: { kind: 'asset', id: 'asset-1' } })
    expect(owner.frame).toBe(3)
    const source = await app.requireResult('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'source', itemRef: { kind: 'video_edit.item', id: `${id}:${item.id}` }, timeUs: 2_500_000 } })
    expect(render.calls[1]).toMatchObject({ frame: 0, document: { width: 3840, height: 2160, fps: 60, clips: [{ sourceInUs: 2_500_000, start: 0, duration: 1 }] } })
    expect(source).toMatchObject({ width: 1920, height: 1080, sourceWidth: 3840, sourceHeight: 2160, target: { kind: 'source', timeUs: 2_500_000 } })
    expect(assets.get('asset-2')).toMatchObject({ source: 'video-edit', mediaType: 'image' })
    const outOfRange = await app.call('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'source', itemRef: { kind: 'video_edit.item', id: `${id}:${item.id}` }, timeUs: 7_000_000 } })
    expect(JSON.stringify(outOfRange)).toContain('素材时长内')
    expect(render.calls).toHaveLength(2)
  } finally { app.dispose() }
})

it('轨道公开只读轨道号与类型，供按整数轨道号落片段；公共写入拒绝修改', async () => {
  const owner = (await createVideoEditProject())!; const id = owner.document.id; const track = owner.document.sequences[0].tracks.find(value => value.kind === 'video')!
  const app = createApplicationHarness()
  try {
    const ref = { kind: 'video_edit.track', id: `${id}:${track.id}` }
    expect((await app.read(ref, ['video_edit.track.index', 'video_edit.track.kind'])).properties).toEqual({ 'video_edit.track.index': track.index, 'video_edit.track.kind': 'video' })
    expect((await app.change(ref, { 'video_edit.track.index': 5 })).ok).toBe(false)
    expect(owner.document.sequences[0].tracks.find(value => value.id === track.id)!.index).toBe(track.index)
  } finally { app.dispose() }
})
