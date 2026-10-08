import { createVideoEditTestProject as createVideoEditProject } from './videoEditDocumentTestKit'
// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { getPlatform } from '@/platform/runtime'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { VideoEditColorGradePanel } from '../panels/VideoEditColorGradePanel'
import { installHarnessNativeStorage, uninstallHarnessNativeStorage } from '@/tests/harnessNativeStorage'
import { createApplicationHarness } from '@/tests/applicationHarness'
import { appendVideoEditClip, beginVideoEditGesture, closeVideoEditProject, editVideoProject, finishVideoEditGesture, getActiveVideoEditSequence, listVideoEditInstances, undoVideoEdit } from './videoEditService'
import { analyzeVideoEditColorGrade, editVideoEditColorGrade } from './videoEditColorGrade'
import { trialVideoEditCodeFrames } from './videoEditCodeTrial'
import { makeVideoEditBuiltinEffect } from './videoEditCompositing'
import { evaluateVideoEditBuiltinParameters } from '@/core/videoEdit/keyframes'

vi.mock('./videoEditCodeTrial', async importOriginal => ({ ...await importOriginal<typeof import('./videoEditCodeTrial')>(), trialVideoEditCodeFrames: vi.fn(), trialVideoEditCodeDocument: vi.fn().mockResolvedValue(undefined) }))
vi.mock('./videoEditColorLutClient', async () => {
  const { suggestColorGradeAutoColor } = await import('@/core/videoEdit/colorGrade'); const { suggestColorGradeMatch } = await import('@/core/videoEdit/colorGradeMatch')
  return { analyzeVideoEditColorGradeOffThread: async (pixels: Uint8ClampedArray, reference?: Uint8ClampedArray, method?: 'moments' | 'histogram') => reference ? suggestColorGradeMatch(pixels, reference, method) : suggestColorGradeAutoColor(pixels) }
})
const closeBitmap = vi.fn()
beforeEach(() => {
  installHarnessNativeStorage()
  vi.spyOn(getPlatform().system.dialog, 'save').mockResolvedValue('D:/color_grade.henji-video')
  vi.spyOn(getPlatform().system.fs, 'writeTextFile').mockResolvedValue(undefined)
  vi.mocked(trialVideoEditCodeFrames).mockResolvedValue({ width: 256, height: 128, close: closeBitmap } as unknown as ImageBitmap)
  const pixels = Uint8ClampedArray.from(Array.from({ length: 256 }, (_, i) => { const x = 70 + i / 255 * 110; return [x, x, x, 255] }).flat())
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return { drawImage() {}, getImageData: () => ({ data: pixels }) } } })
})
afterEach(async () => {
  cleanup()
  for (const owner of listVideoEditInstances()) await closeVideoEditProject(owner.document.id)
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); uninstallHarnessNativeStorage()
})
async function setup() {
  const owner = (await createVideoEditProject())!; const id = owner.document.id
  appendVideoEditClip(id); const sequence = getActiveVideoEditSequence(owner)
  return { owner, target: { projectId: id, sequenceId: sequence.id, clipId: sequence.clips[0].id } }
}
it('已有24项效果时仍可创建ColorGrade，保留整条链且一步撤销', async () => {
  const { owner, target } = await setup()
  editVideoProject(target.projectId, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.map(clip => ({ ...clip, effects: Array.from({ length: 24 }, () => makeVideoEditBuiltinEffect('invert')) })) })) }))
  const before = owner.document; const history = owner.past.length
  editVideoEditColorGrade(target, { params: { exposure: .5 } })
  expect(getActiveVideoEditSequence(owner).clips[0].effects).toHaveLength(25)
  expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(target.projectId); expect(owner.document).toEqual({ ...before, revision: owner.document.revision })
})
it('首次拖动创建效果：连续预览不增历史，松手一步；Esc 连同创建撤销；锁轨拒绝', async () => {
  const { owner, target } = await setup(); const history = owner.past.length
  const clip = () => getActiveVideoEditSequence(owner).clips[0]
  const gesture = beginVideoEditGesture(target.projectId)
  editVideoEditColorGrade(target, { params: { exposure: .5 } }, gesture)
  editVideoEditColorGrade(target, { params: { exposure: 1 } }, gesture)
  expect(clip().effects).toHaveLength(1); expect(clip().effects![0].builtin!.params.exposure).toBe(1); expect(owner.past).toHaveLength(history)
  finishVideoEditGesture(gesture, true); expect(owner.past).toHaveLength(history + 1)
  undoVideoEdit(target.projectId); expect(clip().effects?.length ?? 0).toBe(0)
  const cancelled = beginVideoEditGesture(target.projectId)
  editVideoEditColorGrade(target, { params: { temperature: 25 } }, cancelled)
  finishVideoEditGesture(cancelled, false); expect(clip().effects?.length ?? 0).toBe(0)
  editVideoProject(target.projectId, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, tracks: sequence.tracks.map(track => ({ ...track, locked: true })) })) }))
  expect(() => editVideoEditColorGrade(target, { params: { exposure: 1 } })).toThrow('锁定')
})
it('分析隔离目标与 ColorGrade 前的效果，不改播放头/文档；建议与现有创意参数合并并可撤销', async () => {
  const { owner, target } = await setup(); editVideoEditColorGrade(target, { params: { exposure: 2, faded_film: 30 } })
  const snapshot = owner.document; const history = owner.past.length; const frame = owner.frame
  const result = await analyzeVideoEditColorGrade(target)
  expect(owner.document).toBe(snapshot); expect(owner.frame).toBe(frame); expect(owner.past).toHaveLength(history); expect(closeBitmap).toHaveBeenCalledTimes(5); expect(result.frames).toHaveLength(5)
  const rendered = vi.mocked(trialVideoEditCodeFrames).mock.calls[0][0][0]
  expect(rendered.document.clips).toHaveLength(1); expect(rendered.document.clips[0].effects).toEqual([]); expect(rendered.document.annotations).toEqual([]); expect(rendered.document.captions).toEqual([])
  editVideoEditColorGrade(target, { params: result.parameters }); expect(owner.past).toHaveLength(history + 1)
  expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params).toMatchObject({ ...result.parameters, faded_film: 30 })
  undoVideoEdit(target.projectId); expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.exposure).toBe(2)
})
it('公共算法能力返回建议，经通用实体创建/写入并正式读回；非法帧/跨文档引用拒绝', async () => {
  const { owner, target } = await setup(); const app = createApplicationHarness(); const history = owner.past.length
  const documentRef = { kind: 'video_edit.document', id: target.projectId }; const sequenceRef = { kind: 'video_edit.sequence', id: `${target.projectId}:${target.sequenceId}` }; const clipRef = { kind: 'video_edit.clip', id: `${target.projectId}:${target.clipId}` }
  try {
    const result = await app.requireResult('analyze_video_edit_color', { documentRef, sequenceRef, clipRef })
    expect(result.resultRef).toEqual(clipRef); expect(owner.past).toHaveLength(history)
    const before = await app.read(clipRef)
    const added = await app.call('change_application_entities', { summary: '自动校色', changes: [{ kind: 'create_items', entityType: 'video_edit.effect', parent: clipRef, items: [{ properties: { 'video_edit.effect.definition_id': 'effect:color_grade', 'video_edit.effect.parameters': result.parameters } }] }] }, before.revisions as Record<string, number>)
    expect(added, JSON.stringify(added)).toMatchObject({ ok: true })
    const effect = getActiveVideoEditSequence(owner).clips[0].effects![0]
    expect(effect.builtin).toEqual({ id: 'color_grade', params: result.parameters })
    const ref = { kind: 'video_edit.effect', id: `${target.projectId}:${effect.id}` }
    expect(await app.change(ref, { 'video_edit.effect.parameters': { exposure: .5, midtone_strength: 20, curve_red_2: 65 } })).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.effect.parameters'])).properties).toMatchObject({ 'video_edit.effect.parameters': { exposure: .5, midtone_strength: 20, curve_red_2: 65 } })
    expect((await app.call('analyze_video_edit_color', { documentRef, sequenceRef, clipRef, frame: 99999 })).ok).toBe(false)
    expect((await app.call('analyze_video_edit_color', { documentRef, sequenceRef: { ...sequenceRef, id: 'other:sequence' }, clipRef })).ok).toBe(false)
  } finally { app.dispose() }
})
it('分析中内容变化或取消时拒绝旧建议，位图仍释放', async () => {
  const { owner, target } = await setup()
  vi.mocked(trialVideoEditCodeFrames).mockImplementationOnce(async () => { editVideoEditColorGrade(target, { params: { exposure: .2 } }); return { width: 64, height: 32, close: closeBitmap } as unknown as ImageBitmap })
  await expect(analyzeVideoEditColorGrade(target)).rejects.toThrow('发生修改')
  expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.exposure).toBe(.2); expect(closeBitmap).toHaveBeenCalledOnce()
  const controller = new AbortController()
  vi.mocked(trialVideoEditCodeFrames).mockImplementationOnce(async () => { controller.abort(); return { width: 64, height: 32, close: closeBitmap } as unknown as ImageBitmap })
  await expect(analyzeVideoEditColorGrade(target, undefined, controller.signal)).rejects.toThrow(); expect(closeBitmap).toHaveBeenCalledTimes(2)
})
it('独立面板曲线：首次拖动创建、重渲染不断开手势，松手一步，Esc 后指针移动不再写入', async () => {
  const { owner } = await setup(); const history = owner.past.length; const onError = vi.fn()
  vi.stubGlobal('PointerEvent', MouseEvent)
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn(); Element.prototype.hasPointerCapture = () => true
  const view = render(<VideoEditColorGradePanel instance={owner} onError={onError} />)
  fireEvent.click(view.getByRole('button', { name: '曲线' }))
  const plot = view.getByLabelText('RGB 主控制点'); const point = view.getByRole('slider', { name: 'RGB 主控制点点3' })
  vi.spyOn(plot, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 100, 100))
  fireEvent.pointerDown(point, { button: 0 }); fireEvent.pointerMove(plot, { clientX: 50, clientY: 25 })
  expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.curve_master_points).toContain('75')
  view.rerender(<VideoEditColorGradePanel instance={owner} onError={onError} />)
  expect(owner.past).toHaveLength(history)
  fireEvent.pointerUp(plot); expect(owner.past).toHaveLength(history + 1)
  fireEvent.pointerDown(point, { button: 0 }); fireEvent.pointerMove(plot, { clientX: 50, clientY: 10 }); fireEvent.keyDown(point, { key: 'Escape' }); fireEvent.pointerMove(plot, { clientX: 50, clientY: 5 })
  expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.curve_master_points).toContain('75')
  expect(owner.past).toHaveLength(history + 1); expect(onError).not.toHaveBeenCalled()
})

it('HSL 通用实体写入、读回、关键帧和一步撤销；反向蒙版与非法区间可恢复', async () => {
  const { owner, target } = await setup(); const app = createApplicationHarness()
  editVideoEditColorGrade(target, { params: { exposure: .5 } })
  const effect = getActiveVideoEditSequence(owner).clips[0].effects![0]
  const ref = { kind: 'video_edit.effect', id: `${target.projectId}:${effect.id}` }
  const properties = { hsl_hue_start: 340, hsl_hue_end: 20, hsl_hue_feather: 10, hsl_saturation_start: 20, hsl_saturation_end: 90, hsl_temperature: 20, hsl_invert: true, hsl_show_mask: true, hsl_grade_hue: 240, hsl_grade_strength: 25 }
  try {
    const history = owner.past.length
    const state = await app.read(ref, ['video_edit.effect.parameters'])
    const existing = (state.properties as Record<string, unknown>)['video_edit.effect.parameters'] as Record<string, unknown>
    expect(await app.change(ref, { 'video_edit.effect.parameters': { ...existing, ...properties } })).toMatchObject({ ok: true })
    expect(owner.past).toHaveLength(history + 1)
    expect((await app.read(ref, ['video_edit.effect.parameters'])).properties).toMatchObject({ 'video_edit.effect.parameters': properties })
    const curves = { hsl_temperature: [{ time: 0, value: 20, interpolation: 'linear' }, { time: 10, value: 40, interpolation: 'linear' }] }
    expect(await app.change(ref, { 'video_edit.effect.frame_curves': curves })).toMatchObject({ ok: true })
    expect(evaluateVideoEditBuiltinParameters(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!, 5).hsl_temperature).toBe(30)
    undoVideoEdit(target.projectId)
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.curves?.hsl_temperature).toBeUndefined()
    const snapshot = owner.document
    expect((await app.change(ref, { 'video_edit.effect.parameters': { hsl_saturation_start: 90, hsl_saturation_end: 10 } })).ok).toBe(false)
    expect(owner.document).toEqual(snapshot)
    expect((await app.change(ref, { 'video_edit.effect.frame_curves': { hsl_show_mask: [{ time: 0, value: true, interpolation: 'hold' }] } })).ok).toBe(false)
    expect(await app.change(ref, { 'video_edit.effect.parameters': { ...existing, ...properties, hsl_show_mask: false } })).toMatchObject({ ok: true })
    expect((await app.read(ref, ['video_edit.effect.parameters'])).properties).toMatchObject({ 'video_edit.effect.parameters': { hsl_show_mask: false, exposure: .5 } })
  } finally { app.dispose() }
})

it('三色轮及 HSL 区间消费专业原件，键盘一步提交，切换折叠取消拖动', async () => {
  const { owner } = await setup(); const history = owner.past.length; const onError = vi.fn()
  vi.stubGlobal('PointerEvent', MouseEvent)
  Element.prototype.setPointerCapture = vi.fn(); Element.prototype.releasePointerCapture = vi.fn(); Element.prototype.hasPointerCapture = () => true
  const view = render(<VideoEditColorGradePanel instance={owner} onError={onError} />)
  fireEvent.click(view.getByRole('button', { name: '色轮' }))
  expect(view.getByRole('slider', { name: '阴影色轮亮度' })).toBeTruthy()
  expect(view.getByRole('slider', { name: '中间调色轮亮度' })).toBeTruthy()
  expect(view.getByRole('slider', { name: '高光色轮亮度' })).toBeTruthy()
  fireEvent.keyDown(view.getByRole('slider', { name: '中间调色轮亮度' }), { key: 'ArrowUp' })
  expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.midtone_luminance).toBe(1)
  expect(owner.past).toHaveLength(history + 1)
  fireEvent.click(view.getByRole('button', { name: 'HSL 辅助' }))
  const start = view.getByRole('slider', { name: '色相区间起点' }); const track = start.parentElement!
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 360, 100))
  const before = owner.document
  fireEvent.pointerDown(start, { button: 0, clientX: 340, clientY: 50 }); fireEvent.pointerMove(track, { clientX: 350, clientY: 50 })
  expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.hsl_hue_start).toBe(350)
  fireEvent.click(view.getByRole('button', { name: 'HSL 辅助' }))
  expect(owner.document).toEqual({ ...before, revision: owner.document.revision }); expect(owner.past).toHaveLength(history + 1); expect(onError).not.toHaveBeenCalled()
})

it('公共参考匹配多帧保留参考调色，隔离淡化/不透明度动画；完整建议避免重复套旧Look，一步应用与撤销', async () => {
  const { owner, target } = await setup(); appendVideoEditClip(target.projectId)
  const reference = getActiveVideoEditSequence(owner).clips[1]
  editVideoEditColorGrade(target, { params: { faded_film: 40, curve_red_2: 80 } })
  editVideoEditColorGrade(target, { curves: { faded_film: [{ time: 0, value: 40, interpolation: 'hold' }] } })
  editVideoEditColorGrade({ ...target, clipId: reference.id }, { params: { exposure: 1 } })
  editVideoProject(target.projectId, document => ({ ...document, sequences: document.sequences.map(sequence => ({ ...sequence, clips: sequence.clips.map(clip => ({ ...clip, fadeInFrames: 5, curves: { opacity: [{ time: 0, value: .2, interpolation: 'hold' as const }] } })) })) }))
  const snapshot = owner.document; const app = createApplicationHarness()
  try {
    const ref = (kind: string, child: string): { kind: string; id: string } => ({ kind, id: `${target.projectId}:${child}` })
    const result = await app.requireResult('analyze_video_edit_color', { documentRef: { kind: 'video_edit.document', id: target.projectId }, sequenceRef: ref('video_edit.sequence', target.sequenceId), clipRef: ref('video_edit.clip', target.clipId), sampleCount: 3, referenceClipRef: ref('video_edit.clip', reference.id), matchMethod: 'histogram' })
    expect(result.frames).toHaveLength(3); expect(owner.document).toBe(snapshot)
    const frames = vi.mocked(trialVideoEditCodeFrames).mock.calls.flatMap(call => call[0]); expect(frames).toHaveLength(6)
    expect(frames.slice(0, 3).every(frame => frame.document.clips[0].effects?.length === 0)).toBe(true)
    expect(frames.slice(3).every(frame => frame.document.clips[0].effects?.[0].builtin?.params.exposure === 1)).toBe(true)
    expect(frames.every(frame => frame.document.clips[0].fadeInFrames === 0 && frame.document.clips[0].curves?.opacity === undefined)).toBe(true)
    expect(result.parameters).toMatchObject({ faded_film: 0, curve_red_2: 50, look_lut: '' })
    const effect = getActiveVideoEditSequence(owner).clips[0].effects![0]
    expect(await app.change(ref('video_edit.effect', effect.id), { 'video_edit.effect.frame_curves': {}, 'video_edit.effect.parameters': result.parameters })).toMatchObject({ ok: true })
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params).toEqual(result.parameters)
    expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.curves?.faded_film).toBeUndefined()
    undoVideoEdit(target.projectId); expect(getActiveVideoEditSequence(owner).clips[0].effects![0].builtin!.params.faded_film).toBe(40)
  } finally { app.dispose() }
})
