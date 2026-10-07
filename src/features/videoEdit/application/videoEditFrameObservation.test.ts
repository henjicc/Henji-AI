import { askAssistantAtVideoEditFrame, createVideoEditAnnotation } from './videoEditAnnotations'
import { useAssistantUiStore } from '@/features/assistant/store/assistantUiStore'
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
import { editVideoProject } from './videoEditService'
import { compileCodeMaterial } from '@/core/videoEdit/codeMaterial/compiler'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { readVideoEditCodeMetadata, rememberVideoEditCodeMetadata } from './videoEditCodeState'

// The production renderer is the replaced pixel boundary; composition building, scaling,
// library collection and the public capability are real.
const render = vi.hoisted(() => ({ calls: [] as Array<{ document: VideoEditComposition; frame: number }> }))
vi.mock('./videoEditCodeTrial', async importOriginal => ({ ...await importOriginal<Record<string, unknown>>(), trialVideoEditCodeFrames: vi.fn(async (frames: Array<{ document: VideoEditComposition; frame: number }>) => {
  render.calls.push(...frames); const last = frames.at(-1)!
  return { width: last.document.width, height: last.document.height, close: vi.fn() }
}) }))
vi.mock('mediabunny', () => ({ ALL_FORMATS: [], UrlSource: class {}, Input: class { async getPrimaryVideoTrack() { return null } async getPrimaryAudioTrack() { return null } async computeDuration() { return 0 } dispose() {} } }))
const assets = new Map<string, AssetRecord>(); const drawn: number[][] = []; const pixels = { labels: [] as string[], rectangles: [] as number[][] }
beforeEach(() => {
  installHarnessNativeStorage(); assets.clear(); render.calls = []; drawn.length = 0; pixels.labels = []; pixels.rectangles = []
  vi.stubGlobal('OffscreenCanvas', class { constructor(public width: number, public height: number) {}
    getContext() { return { imageSmoothingQuality: 'low', drawImage: (_image: unknown, ...args: number[]) => drawn.push(args), save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), arc: vi.fn(), stroke: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), strokeRect: (...args: number[]) => pixels.rectangles.push(args), fillRect: vi.fn(), measureText: (text: string) => ({ width: text.length * 14 }), fillText: (text: string) => pixels.labels.push(text) } }
    async convertToBlob() { return new NativeBlob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }) } })
  const platform = getPlatform(); let size = { width: 0, height: 0 }
  vi.spyOn(platform.system.dialog, 'save').mockResolvedValue('D:/observe.henji-video')
  vi.spyOn(platform.system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.spyOn(platform.system.paths, 'dirname').mockResolvedValue('D:/managed')
  vi.spyOn(platform.media, 'allowRoot').mockResolvedValue(undefined)
  vi.spyOn(platform.image, 'persistImageBinary').mockImplementation(async () => { size = { width: drawn.at(-1)!.at(-2)!, height: drawn.at(-1)!.at(-1)! }; return `D:/managed/observe-${drawn.length}.png` })
  vi.spyOn(platform.assetLibrary, 'createAsset').mockImplementation(async input => {
    const value: AssetRecord = { id: `asset-${assets.size + 1}`, filePath: input.filePath, mediaType: 'image', displayName: input.displayName ?? '', displayUrl: '', source: input.source, mimeType: 'image/png', sizeBytes: 4, width: size.width, height: size.height, durationSeconds: 0, thumbnailPath: null, thumbnailUrl: null, inspectionStatus: 'ready', inspectionError: null, fileModifiedAt: 1, contentIdentity: 'd'.repeat(64), lastUsedAt: null, createdAt: 1, updatedAt: 1, tags: [], libraryIds: [] }
    assets.set(value.id, value); return value
  })
  vi.spyOn(platform.assetLibrary, 'inspectAsset').mockImplementation(async id => structuredClone(assets.get(id)!))
})
afterEach(async () => { for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id); useAssistantUiStore.getState().setPendingGoal(null); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })

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

it('暂停直接说附完整帧与所选区域局部截图、固定上下文和open标注；右键保留点击位置，播放中拒绝', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 0, target: { kind: 'region', x: .25, y: .25, width: .5, height: .5 }, text: '这里要改' })
  await askAssistantAtVideoEditFrame(id)
  const options = useAssistantUiStore.getState().pendingGoalOptions!; const mark = owner.document.sequences[0].annotations[1]
  expect(options.autoSend).not.toBe(true); expect(options.attachments).toHaveLength(2); expect(options.context).toContain(mark.id); expect(mark).toMatchObject({ status: 'open', target: { kind: 'region' } })
  options.onTextSubmitted!('这块提高亮度'); expect(owner.document.sequences[0].annotations[1].text).toBe('这块提高亮度')
  await askAssistantAtVideoEditFrame(id, { x: .15, y: .35 }); expect(owner.document.sequences[0].annotations.at(-1)).toMatchObject({ target: { kind: 'point', x: .15, y: .35 } })
  setVideoEditView(id, { playing: true }); await expect(askAssistantAtVideoEditFrame(id)).rejects.toThrow('暂停')
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

it('源素材观察保留横竖8K与120帧，超大源等比缩至序列预算', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  const app = createApplicationHarness()
  try {
    for (const [index, width, height, expectedWidth, expectedHeight] of [[0, 7680, 4320, 7680, 4320], [1, 4320, 7680, 4320, 7680], [2, 15360, 8640, 7680, 4320]]) {
      const mediaId = `media-${index}`
      appendVideoEditMedia(id, { id: mediaId, name: '原片', path: `/fixture/${index}.mp4`, kind: 'video', width, height, durationSeconds: 1, frameRate: { numerator: 120, denominator: 1 }, frameRateMode: 'sampled-constant' })
      const item = owner.document.items.find(value => value.mediaId === mediaId)!
      await app.requireResult('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'source', itemRef: { kind: 'video_edit.item', id: `${id}:${item.id}` }, timeUs: 0 } })
      expect(render.calls.at(-1)?.document).toMatchObject({ width: expectedWidth, height: expectedHeight, fps: 120 })
    }
  } finally { app.dispose() }
})


it('公共观察叠加同帧标注与稳定编号，按标注裁切放大；错序列、错帧与无区域目标拒绝且不渲染', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id; const app = createApplicationHarness()
  const regionId = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 5, target: { kind: 'region', x: .25, y: .25, width: .5, height: .5 }, text: '改标题', status: 'open' })
  const rangeId = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 5, endFrame: 10, target: { kind: 'range', startFrame: 5, endFrame: 10 }, text: '剪紧一点', status: 'open' })
  createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 8, target: { kind: 'point', x: .5, y: .5 }, text: '另一帧' })
  try {
    await app.requireResult('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'program', frame: 5 }, overlayAnnotations: true, maxWidth: 960 })
    expect(pixels.labels).toEqual(['1', '2']); expect(pixels.rectangles[0]).toEqual([240, 135, 480, 270])
    const crop = await app.requireResult('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'program', frame: 5 }, annotationIds: [regionId], cropAnnotationId: regionId, maxWidth: 960 })
    expect(drawn.at(-1)).toEqual([480, 270, 960, 540, 0, 0, 960, 540]); expect(crop).toMatchObject({ width: 960, height: 540 }); expect(pixels.rectangles.at(-1)).toEqual([0, 0, 960, 540])
    for (const options of [{ annotationIds: ['missing'] }, { cropAnnotationId: rangeId }, { annotationIds: [regionId], frame: 8 }]) {
      const result = await app.call('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'program', frame: options.frame ?? 5 }, annotationIds: options.annotationIds, cropAnnotationId: options.cropAnnotationId })
      expect(result).toMatchObject({ ok: false })
    }
    expect(render.calls).toHaveLength(2)
  } finally { app.dispose() }
})

it('公共观察高亮指定代码元素，绑定标注按指定动画帧跟随；无效元素及源素材请求拒绝', async () => {
  const owner = await createVideoEditProject(); const id = owner.document.id
  const source = 'export default {apiVersion:1,languageVersion:3,name:"元素",kind:"generator",mode:"dynamic",width:1920,height:1080,durationSeconds:10,seed:1,parameters:{},render(ctx){return [rect({id:"标题底板",x:ctx.time*100+100,y:100,width:200,height:100,fill:[1,1,1,1]})];}}'
  const program = compileCodeMaterial(source)
  rememberVideoEditCodeMetadata(owner, 'definition', { id: 'version', source, apiVersion: 1, languageVersion: 3 }, program)
  let clipId = ''
  editVideoProject(id, document => {
    document.codeMaterials = [{ id: 'definition', name: '元素', defaultVersionId: 'version', versions: [{ id: 'version', source, apiVersion: 1, languageVersion: 3 }] }]
    document.items.push({ id: 'code-item', name: '元素', kind: 'code', code: { definitionId: 'definition', versionId: 'version', parameters: {} } })
    const clip = makeVideoEditItemClip(document, 'code-item', owner.activeSequenceId, { frame: 0 }, readVideoEditCodeMetadata(owner, document)); clipId = clip.id; document.sequences[0].clips.push(clip); return document
  })
  const markId = createVideoEditAnnotation(id, owner.activeSequenceId, { frame: 30, clipId, target: { kind: 'element', elementId: '标题底板', region: { x: 0, y: 0, width: .1, height: .1 } }, text: '改这里', status: 'open' })
  const app = createApplicationHarness()
  try {
    const result = await app.requireResult('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'program', frame: 30 }, maxWidth: 960, annotationIds: [markId], highlightElement: { clipRef: { kind: 'video_edit.clip', id: `${id}:${clipId}` }, elementId: '标题底板' } })
    expect(result).toMatchObject({ width: 960, height: 540 }); expect(pixels.labels).toEqual(['1', '标题底板'])
    const fps = owner.document.sequences[0].frameRate.numerator / owner.document.sequences[0].frameRate.denominator
    expect(pixels.rectangles[0][0]).toBeCloseTo((30 / fps * 100 + 100) / 2)
    expect(pixels.rectangles[1]).toEqual(pixels.rectangles[0]); expect(owner.frame).toBe(0)
    const invalid = await app.call('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'program', frame: 30 }, highlightElement: { clipRef: { kind: 'video_edit.clip', id: `${id}:${clipId}` }, elementId: '不存在' } })
    expect(invalid.ok).toBe(false); expect(render.calls).toHaveLength(1)
    const sourceInvalid = await app.call('observe_video_edit_frame', { documentRef: { kind: 'video_edit.document', id }, target: { kind: 'source', itemRef: { kind: 'video_edit.item', id: `${id}:code-item` }, timeUs: 0 }, highlightElement: { clipRef: { kind: 'video_edit.clip', id: `${id}:${clipId}` }, elementId: '标题底板' } })
    expect(sourceInvalid.ok).toBe(false)
  } finally { app.dispose() }
})
