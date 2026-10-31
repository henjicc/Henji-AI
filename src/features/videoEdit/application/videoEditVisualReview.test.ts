// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { queryVideoEditReviewCapability } from '@/core/application-control/domains/videoEdit/videoEditReviewCapability'
import { detectVideoEditBanding } from '@/core/videoEdit/bandingReview'
import { selectVideoEditReviewFrames, type VideoEditReviewRecord } from '@/core/videoEdit/review'
import { collectVideoEditVisualReview } from './videoEditVisualReview'
import { compareVideoEditEffectPixels } from '@/core/videoEdit/effectPixelReview'
import { makeVideoEditItemClip } from '@/core/videoEdit/projectItems'
import { createVideoEditSequence, videoEditComposition, videoEditNestedComposition } from '@/core/videoEdit/document'
import type { VideoEditMotionReviewInput, VideoEditMotionReviewResponse } from '../engine/videoEditMotionReviewWorker'
import { closeAllVideoEdits, createVideoEditTestProject } from './videoEditDocumentTestKit'
import { editVideoProject } from './videoEditService'
import * as trial from './videoEditCodeTrial'
import { makeVideoEditBuiltinEffect } from './videoEditCompositing'
import { rememberVideoEditCodeMetadata } from './videoEditCodeState'
import { testCodeManifest } from '@/core/videoEdit/codeMaterial/sourceTestFixtures'
import * as pixelMotion from './videoEditPixelMotion'
import { testAuthorBundle, testAuthorProgram } from '../engine/videoEditAuthorTestFixtures'

type Image = ImageBitmap & { pixels: Uint8ClampedArray }
class PixelWorker {
  static instances: PixelWorker[] = []
  constructor() { PixelWorker.instances.push(this) }
  onmessage: ((event: MessageEvent<VideoEditMotionReviewResponse>) => void) | null = null
  onerror = null; onmessageerror = null
  terminate = vi.fn()
  postMessage(request: VideoEditMotionReviewInput): void {
    expect(request).not.toHaveProperty('composition')
    if ('banding' in request) {
      const image = request.banding as Image
      queueMicrotask(() => this.onmessage?.(new MessageEvent<VideoEditMotionReviewResponse>('message', { data: { result: { records: [], sampledFrames: 0, sampledInstances: 0, banding: detectVideoEditBanding(image.pixels, image.width, image.height) } } })))
      return
    }
    if (!('comparison' in request) || !request.comparison) throw new Error('测试需要像素请求。')
    const [on, off, repeat] = request.comparison as unknown as [Image, Image, Image?]
    queueMicrotask(() => this.onmessage?.(new MessageEvent<VideoEditMotionReviewResponse>('message', { data: { result: { records: [], sampledFrames: 0, sampledInstances: 0, comparison: compareVideoEditEffectPixels(on.pixels, off.pixels, (repeat ?? on).pixels, on.width, on.height) } } })))
  }
}
beforeEach(() => { PixelWorker.instances = []; vi.stubGlobal('createImageBitmap', vi.fn(async (image: Image) => ({ ...image, pixels: image.pixels.slice(), close: vi.fn() }))); vi.spyOn(pixelMotion, 'pinVideoEditMotionSources').mockResolvedValue([]); vi.spyOn(pixelMotion, 'verifyVideoEditMotionSources').mockResolvedValue(); installHarnessNativeStorage(); vi.stubGlobal('Worker', PixelWorker) })
afterEach(async () => { await closeAllVideoEdits(); vi.restoreAllMocks(); vi.unstubAllGlobals(); uninstallHarnessNativeStorage() })
async function fixture() {
  const owner = await createVideoEditTestProject(), sequenceId = owner.document.sequences[0].id
  editVideoProject(owner.document.id, original => {
    const document = structuredClone(original)
    document.media = [{ id: 'media', kind: 'image', name: '画面', path: '/review.png', width: 100, height: 100, durationSeconds: 1 }]
    document.items = [{ id: 'item', kind: 'image', name: '卡片', mediaId: 'media' }]
    const sequence = document.sequences[0], clip = makeVideoEditItemClip(document, 'item', sequenceId, { frame: 0, duration: 60 })
    sequence.clips = [{ ...clip, id: 'picture', effects: [makeVideoEditBuiltinEffect('color_grade', { exposure: .2 })] }]
    sequence.captions = [{ id: 'first', start: 0, duration: 20, text: '第一句话' }, { id: 'second', start: 30, duration: 20, text: '第二句话' }]
    return document
  })
  const render = vi.spyOn(trial, 'trialVideoEditCodeFrames').mockImplementation(async (frames, signal, _keep, _collect, _measure, observe) => {
    signal.throwIfAborted()
    for (const { document, frame } of frames) observe?.({ sequenceId: document.id, revision: document.revision, frame, clips: [] })
    const { document, frame } = frames[0]
    observe?.({ sequenceId: document.id, revision: document.revision, frame, clips: [] })
    const clip = document.clips.find(clip => clip.id === 'picture')!, changed = clip.code ? !clip.code.curves?.glow && clip.code.parameters.glow === 0 : clip.effects?.some(effect => effect.enabled === false)
    return { width: 2, height: 1, pixels: new Uint8ClampedArray([changed ? 10 : 20, 0, 0, 255, 0, 0, 0, 255]), close: vi.fn() } as unknown as Image
  })
  const input = { documentRef: { kind: 'video_edit.document', id: owner.document.id }, sequenceRef: { kind: 'video_edit.sequence', id: `${owner.document.id}:${sequenceId}` }, from: 0, to: 60, visual: {} }
  return { owner, input, render }
}
it('正式入口逐段列句首并按实体单独关闭效果，分页复用像素证据且编辑使游标失效', async () => {
  const { owner, input, render } = await fixture(), app = createApplicationHarness(), parse = queryVideoEditReviewCapability.outputSchema.parse
  const before = JSON.stringify(owner.document), revision = owner.document.revision
  let page = parse(await app.requireResult('query_video_edit_review', { ...input, limit: 1 }))
  const cursor = page.nextCursor, records = [...page.records], calls = render.mock.calls.length
  while (page.nextCursor) { page = parse(await app.requireResult('query_video_edit_review', { ...input, limit: 1, cursor: page.nextCursor })); records.push(...page.records) }
  expect(render).toHaveBeenCalledTimes(calls)
  expect(records.filter(record => record.kind === 'narration_alignment').map(record => [record.timeline.fromFrame, record.motionEvidence?.visual?.captionText])).toEqual([[0, '第一句话'], [30, '第二句话']])
  const effects = records.filter(record => record.kind === 'effect_visible')
  expect(effects.map(record => record.timeline.fromFrame)).toEqual([0, 29, 59])
  expect(effects.every(record => record.subjectRef.kind === 'video_edit.effect' && record.motionEvidence?.visual?.changedPixels === 1)).toBe(true)
  expect(owner.document.revision).toBe(revision); expect(JSON.stringify(owner.document)).toBe(before)
  const narrow = parse(await app.requireResult('query_video_edit_review', { ...input, from: 1, limit: 50, visual: { narration: true, effects: false } }))
  expect(narrow.records.filter(record => record.kind === 'narration_alignment').map(record => record.timeline.fromFrame)).toEqual([30])
  editVideoProject(owner.document.id, document => ({ ...document, name: '编辑后' }))
  expect((await app.call('query_video_edit_review', { ...input, limit: 1, cursor })).ok).toBe(false)
})
it.each([false, true])('作者参数探针读取曲线与静态转场余量（%s），关闭值只影响副本', async transition => {
  const { owner, input, render } = await fixture(), app = createApplicationHarness()
  const source = `export default {mode:"${transition ? 'static' : 'dynamic'}",name:"生成器",params:[{key:"glow",type:"number",title:"辉光",default:0,min:0,max:1,step:.1,animatable:true}],draw(){}}`
  const version = { id: 'version', apiVersion: 4 as const, languageVersion: 4 as const, ...testCodeManifest(source, owner.document) }
  rememberVideoEditCodeMetadata(owner, 'definition', version, testAuthorProgram(testAuthorBundle(source)))
  editVideoProject(owner.document.id, original => {
    const document = structuredClone(original)
    document.codeMaterials = [{ id: 'definition', name: '生成器', defaultVersionId: 'version', versions: [version] }]
    const code = { definitionId: 'definition', versionId: 'version', parameters: { glow: 0 }, curves: { glow: [{ id: 'key', sourceInUs: transition ? 0 : 1000000, sourceRemainder: { numerator: 0, denominator: 1 }, value: 1, interpolation: 'hold' as const }] } }
    document.items = [{ id: 'item', kind: 'code', name: '生成器', code }]
    document.sequences[0].clips[0] = { ...document.sequences[0].clips[0], kind: 'code', sourceInUs: transition ? 0 : 1000000, start: transition ? 30 : 0, duration: transition ? 30 : 60, code, effects: [] }
    if (transition) {
      const sequence = document.sequences[0]
      sequence.clips.push({ ...sequence.clips[0], id: 'prior', start: 0, duration: 30 })
      sequence.transitions = [{ id: 'transition', kind: 'cross_dissolve', leftClipId: 'prior', rightClipId: 'picture', durationFrames: 10 }]
    }
    return document
  })
  const result = queryVideoEditReviewCapability.outputSchema.parse(await app.requireResult('query_video_edit_review', { ...input, limit: 50, visual: { narration: false, effects: false, probes: [{ clipRef: { kind: 'video_edit.clip', id: `${owner.document.id}:picture` }, frame: transition ? 25 : 20, parameter: 'glow', offValue: 0 }] } }))
  expect(result.records.find(record => record.kind === 'effect_visible')?.motionEvidence?.visual).toMatchObject({ parameter: 'glow', offValue: 0, changedPixels: 1 })
  expect(render.mock.calls.at(-2)?.[0][0].document.clips[0].code?.parameters.glow).toBe(0)
  expect(owner.document.sequences[0].clips[0].code?.parameters.glow).toBe(0)
  expect(owner.document.sequences[0].clips[0].code?.curves?.glow).toHaveLength(1)
})

it.each([false, true])('嵌套字幕仅投影原句首：入点裁掉句首不补造，倒放定位原句首（%s）', async reverse => {
  const { owner, input, render } = await fixture(), app = createApplicationHarness()
  editVideoProject(owner.document.id, original => {
    const document = structuredClone(original), root = document.sequences[0], child = createVideoEditSequence('子序列')
    child.captions = [{ id: 'trimmed', start: 0, duration: 45, text: '开头被剪掉' }, { id: 'kept', start: 40, duration: 20, text: '原句首' }]
    document.sequences.push(child); document.items.push({ id: 'nested', kind: 'sequence', name: '子序列', sequenceId: child.id })
    const wrapper = makeVideoEditItemClip(document, 'nested', root.id, { frame: 0, duration: reverse ? 60 : 30 })
    root.clips = [{ ...wrapper, sourceInUs: reverse ? 2000000 : 1000000, ...(reverse ? { reverse: true as const } : {}) }]; root.captions = []
    return document
  })
  const result = queryVideoEditReviewCapability.outputSchema.parse(await app.requireResult('query_video_edit_review', { ...input, limit: 50, visual: { narration: true, effects: false } }))
  expect(result.records.filter(record => record.kind === 'narration_alignment').map(record => [record.timeline.fromFrame, record.motionEvidence?.visual?.captionText])).toEqual(reverse ? [[19, '原句首'], [59, '开头被剪掉']] : [[10, '原句首']])
  expect(render).not.toHaveBeenCalled()
})

it.each([false, true])('contentAnchor 嵌套裁切只重投影片段，保留原句首且不采用裁切后的字幕起点（倒放=%s）', async reverse => {
  const { owner, input, render } = await fixture(), app = createApplicationHarness()
  editVideoProject(owner.document.id, original => {
    const document = structuredClone(original), root = document.sequences[0], child = createVideoEditSequence('关联口述')
    document.sequences.push(child)
    document.media.push({ id: 'voice-media', kind: 'audio', name: '声音', path: '/voice.wav', width: 0, height: 0, durationSeconds: 3, hasAudio: true })
    document.items.push({ id: 'voice-item', kind: 'audio', name: '声音', mediaId: 'voice-media' }, { id: 'nested', kind: 'sequence', name: '关联子序列', sequenceId: child.id })
    const source = { ...root.clips[0], duration: 90, effects: [] }
    const voice = { ...makeVideoEditItemClip(document, 'voice-item', child.id, { frame: 0, duration: 90 }), id: 'voice', contentAnchor: { ranges: [{ clipId: source.id, itemId: source.itemId, fromUs: 0, toUs: 3000000 }], startOffsetSeconds: 0, endOffsetSeconds: 0 } }
    child.clips = [source, voice]
    child.captions = [
      { id: 'trimmed', start: 0, duration: 60, text: '前半句后半句', speech: { text: '前半句后半句', aligned: true, words: [{ clipId: 'voice', text: '前半句', startUs: 0, endUs: 1000000, precision: 'word' }, { clipId: 'voice', text: '后半句', startUs: 1000000, endUs: 2000000, precision: 'word' }] } },
      { id: 'kept', start: 40, duration: 10, text: '完整句', speech: { text: '完整句', aligned: true, words: [{ clipId: 'voice', text: '完整句', startUs: 1400000, endUs: 1600000, precision: 'word' }] } },
    ]
    root.clips = [{ ...makeVideoEditItemClip(document, 'nested', root.id, { frame: 0, duration: 30 }), sourceInUs: reverse ? 2000000 : 1000000, ...(reverse ? { reverse: true as const } : {}) }]; root.captions = []
    return document
  })
  const root = videoEditComposition(owner.document, owner.document.sequences[0].id)
  const child = videoEditNestedComposition(root, root.clips[0])!
  expect(child.clips.find(clip => clip.id === 'voice')).toMatchObject({ start: 30, duration: 30, contentAnchor: expect.any(Object) })
  expect(child.captions?.map(caption => [caption.id, caption.start])).toEqual([['trimmed', 30], ['kept', 40]])
  const before = JSON.stringify(owner.document)
  const result = queryVideoEditReviewCapability.outputSchema.parse(await app.requireResult('query_video_edit_review', { ...input, visual: { narration: true, effects: false } }))
  expect(result.records.filter(record => record.kind === 'narration_alignment').map(record => [record.timeline.fromFrame, record.motionEvidence?.visual?.captionText])).toEqual([[reverse ? 19 : 10, '完整句']])
  expect(JSON.stringify(owner.document)).toBe(before)
  expect(render).not.toHaveBeenCalled()
})

it('带口述来源的字幕被嵌套入点投影裁切时，渲染用的新起点不成为原句首', async () => {
  const { owner, input, render } = await fixture(), app = createApplicationHarness()
  editVideoProject(owner.document.id, original => {
    const document = structuredClone(original), root = document.sequences[0], child = createVideoEditSequence('口述子序列')
    document.sequences.push(child)
    document.media.push({ id: 'voice-media', kind: 'audio', name: '声音', path: '/voice.wav', width: 0, height: 0, durationSeconds: 2, hasAudio: true })
    document.items.push({ id: 'voice-item', kind: 'audio', name: '声音', mediaId: 'voice-media' }, { id: 'nested', kind: 'sequence', name: '口述子序列', sequenceId: child.id })
    child.clips = [{ ...makeVideoEditItemClip(document, 'voice-item', child.id, { frame: 0, duration: 60 }), id: 'voice' }]
    child.captions = [{ id: 'sentence', start: 0, duration: 60, text: '前半句后半句', speech: { text: '前半句后半句', aligned: true, words: [{ clipId: 'voice', text: '前半句', startUs: 0, endUs: 1000000, precision: 'word' }, { clipId: 'voice', text: '后半句', startUs: 1000000, endUs: 2000000, precision: 'word' }] } }]
    root.clips = [{ ...makeVideoEditItemClip(document, 'nested', root.id, { frame: 0, duration: 30 }), sourceInUs: 1000000 }]; root.captions = []
    return document
  })
  const result = queryVideoEditReviewCapability.outputSchema.parse(await app.requireResult('query_video_edit_review', { ...input, visual: { narration: true, effects: false } }))
  expect(result.records.filter(record => record.kind === 'narration_alignment')).toEqual([])
  expect(render).not.toHaveBeenCalled()
})

it.each([false, true])('变速跳过整段字幕时不在字幕范围外伪造句首（倒放=%s）', async reverse => {
  const { owner, input } = await fixture(), app = createApplicationHarness()
  editVideoProject(owner.document.id, original => {
    const document = structuredClone(original), root = document.sequences[0], child = createVideoEditSequence('跳帧')
    child.clips = [{ ...root.clips[0], effects: [] }]
    child.captions = [{ id: 'skipped', start: reverse ? 39 : 1, duration: 1, text: '未采到的字幕' }]
    document.sequences.push(child); document.items.push({ id: 'nested', kind: 'sequence', name: '跳帧', sequenceId: child.id })
    root.clips = [{ ...makeVideoEditItemClip(document, 'nested', root.id, { frame: 0, duration: 30 }), speed: { numerator: 2, denominator: 1 }, sourceInUs: reverse ? 2000000 : 0, ...(reverse ? { reverse: true as const } : {}) }]; root.captions = []
    return document
  })
  const result = queryVideoEditReviewCapability.outputSchema.parse(await app.requireResult('query_video_edit_review', { ...input, visual: { narration: true, effects: false } }))
  expect(result.records.filter(record => record.kind === 'narration_alignment')).toEqual([])
})

it('同帧多效果共用两次开启基线，复用一个比较 Worker，纯字幕清单不渲染', async () => {
  const { owner, input, render } = await fixture(), app = createApplicationHarness()
  editVideoProject(owner.document.id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.map(clip => ({ ...clip, effects: [...clip.effects!, makeVideoEditBuiltinEffect('color_grade', { exposure: .4 })] })) })) }))
  const result = queryVideoEditReviewCapability.outputSchema.parse(await app.requireResult('query_video_edit_review', { ...input, limit: 50 }))
  expect(result.records.filter(record => record.kind === 'effect_visible')).toHaveLength(6)
  expect(render).toHaveBeenCalledTimes(3 * (2 + 2))
  expect(PixelWorker.instances).toHaveLength(1)
  expect(PixelWorker.instances[0].terminate).toHaveBeenCalledOnce()
})

it('共用基线在各自关闭效果后重复开启，不稳定时整组不能声称效果生效', async () => {
  const { input, render } = await fixture(), app = createApplicationHarness(), implementation = render.getMockImplementation()!
  const seen = new Set<number>()
  render.mockImplementation(async (...args) => {
    const image = await implementation(...args) as Image
    const { document, frame } = args[0][0]
    if (document.clips[0].effects?.[0].enabled !== false) {
      if (seen.has(frame)) image.pixels[0]++
      seen.add(frame)
    }
    return image
  })
  const result = queryVideoEditReviewCapability.outputSchema.parse(await app.requireResult('query_video_edit_review', { ...input, limit: 50, visual: { narration: false, effects: true } }))
  expect(result.records.filter(record => record.kind === 'effect_unstable')).toHaveLength(3)
  expect(result.records.some(record => record.kind === 'effect_visible')).toBe(false)
})

it('效果计算超过预算时在第一次取帧前拒绝，并给出可缩小的参数', async () => {
  const { owner, input, render } = await fixture(), app = createApplicationHarness()
  editVideoProject(owner.document.id, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.map(clip => ({ ...clip, effects: Array.from({ length: 40 }, () => makeVideoEditBuiltinEffect('color_grade', { exposure: .2 })) })) })) }))
  const result = await app.call('query_video_edit_review', input)
  expect(result.ok).toBe(false)
  expect(JSON.stringify(result)).toContain('缩小 from/to')
  expect(render).not.toHaveBeenCalled(); expect(PixelWorker.instances).toHaveLength(0)
})

it('色带经公共入口返回时间、比例位置和片段；分页不重渲染且不改作品，效果基线复用', async () => {
  const { owner, input, render } = await fixture(), app = createApplicationHarness(), parse = queryVideoEditReviewCapability.outputSchema.parse
  const before = JSON.stringify(owner.document), images: Image[] = []
  render.mockImplementation(async () => {
    const width = 960, height = 540, pixels = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const t = Math.min(1, Math.hypot((x - 480) / 624, (y - 270) / 459))
      pixels.set([Math.round(21 - t * 8), Math.round(22 - t * 8), Math.round(26 - t * 10), 255], (y * width + x) * 4)
    }
    const image = { width, height, pixels, close: vi.fn() } as unknown as Image
    images.push(image); return image
  })
  const options = { ...input, limit: 1, maxFrames: 2, visual: { banding: true, effects: true, narration: false } }
  let page = parse(await app.requireResult('query_video_edit_review', options))
  const records = [...page.records]
  const calls = render.mock.calls.length
  while (page.nextCursor) { page = parse(await app.requireResult('query_video_edit_review', { ...options, cursor: page.nextCursor })); records.push(...page.records) }
  const banding = records.filter(record => record.kind === 'banding')
  expect(banding.length).toBeGreaterThan(0)
  expect(banding.every(record => record.subjectRef.kind === 'video_edit.sequence' && record.timeline.toFrame === record.timeline.fromFrame + 1 && record.motionEvidence?.banding?.clipRefs.some(ref => ref.id === `${owner.document.id}:picture`))).toBe(true)
  expect(banding[0].motionEvidence?.banding?.region).toMatchObject({ x: expect.any(Number), width: expect.any(Number) })
  expect(banding[0].motionEvidence?.suggestion).toContain('半级亮度')
  expect(banding[0].motionEvidence?.suggestion).toContain('素材自带')
  const candidates: VideoEditReviewRecord[] = records.map(record => ({ kind: record.kind as VideoEditReviewRecord['kind'], timeline: {from:record.timeline.fromFrame,to:record.timeline.toFrame},subjectId:record.subjectRef.id,sequenceId:input.sequenceRef.id,path:[] }))
  expect(page.checkpoints.frames).toEqual(selectVideoEditReviewFrames(candidates, {from:0,to:60}, 2, 60))
  expect(render).toHaveBeenCalledTimes(calls)
  const frames = new Set(render.mock.calls.map(call => call[0][0].frame))
  expect(calls).toBe(9 + [...frames].filter(frame => ![0, 29, 59].includes(frame)).length)
  expect(images.every(image => vi.mocked(image.close).mock.calls.length === 1)).toBe(true)
  expect(JSON.stringify(owner.document)).toBe(before)
})

it('显式色带无候选时说明如何指定', async () => {
  const { owner, render } = await fixture()
  const composition = videoEditComposition(owner.document, owner.document.sequences[0].id)
  const warnings: string[] = []
  const options = queryVideoEditReviewCapability.inputSchema.parse({documentRef:{kind:'video_edit.document',id:owner.document.id},sequenceRef:{kind:'video_edit.sequence',id:'sequence'},from:0,to:60,visual:{banding:true,narration:false,effects:false}}).visual!
  const args = [owner, composition, {from:0,to:60}, options, new AbortController().signal, () => {}] as const
  await collectVideoEditVisualReview(...args, 0, warnings)
  expect(warnings.join()).toContain('没有可检查的候选帧')
  expect(warnings.join()).toContain('visual.probes')
  expect(render).not.toHaveBeenCalled()
})
