import { describe, expect, it } from 'vitest'
import { addLegacyVideoEditTracks, createVideoEditTestDocument } from './testFixtures'
import { videoEditClipSchema, videoEditComposition } from './document'
import { evaluateSpatialFrame } from './spatialEvaluation'
import { applySpatialPatch } from './spatialPropagation'
import { inspectSpatialFrame, planSpatialLayout, SpatialLayoutError } from './spatialLayout'
import { SPATIAL_KEYS } from './spatialSchema'
import { videoEditClipValue, type VideoEditKeyframes } from './keyframes'
import type { SpatialCamera, SpatialOutput, SpatialSnapshot } from './spatialTypes'

function fixture(par = 1): { snapshot: SpatialSnapshot; output: SpatialOutput } {
  const document = createVideoEditTestDocument('空间算法')
  const sequence = addLegacyVideoEditTracks(document.sequences[0]); sequence.pixelAspectRatio = { numerator: par * 100, denominator: 100 }; sequence.motionBlur = false
  sequence.clips = ['far', 'focus', 'near'].map((id, index) => videoEditClipSchema.parse({ id, itemId: id, name: id, kind: 'graphic', spatial: { enabled: true }, track: index + 1, start: 0, duration: 100, sourceInUs: 0, sourceRemainder: { numerator: 0, denominator: 1 }, x: (index - 1) * .27, y: 0, scale: .2, rotation: 0, opacity: 1, volume: 0, text: '', graphic: { width: 1920, height: 1080, objects: [{ id: `${id}-rect`, name: id, kind: 'rect', parameters: { x: 0, y: 0, width: 1920, height: 1080, radius: 0, fill: [1, 1, 1, 1] } }] } }))
  const base = videoEditComposition(document, sequence.id)
  return { snapshot: { composition: base, sequenceId: sequence.id, revision: base.revision }, output: { width: sequence.width, height: sequence.height, displayWidth: sequence.width * par, displayHeight: sequence.height } }
}
const signal = (): AbortSignal => new AbortController().signal
const ids = ['far', 'focus', 'near']
const cameraOf = (snapshot: SpatialSnapshot): SpatialCamera | undefined => snapshot.composition.spatialCamera

describe('空间布局与结构读回', () => {
  it('尚未开启空间的平面片段可直接展开，探测不会提前写入原片段', async () => {
    const { snapshot, output } = fixture()
    snapshot.composition = { ...snapshot.composition, clips: snapshot.composition.clips.map(clip => ({ ...clip, spatial: undefined })) }
    const patch = await planSpatialLayout(snapshot, { kind: 'expand', clipIds: ids, focusClipId: 'focus', range: [10, 30], parallaxRatio: 1.4, perspective: .5 }, output, signal())
    expect(patch.clips.every(edit => edit.values.spatial?.enabled)).toBe(true)
    expect(snapshot.composition.clips.every(clip => !clip.spatial)).toBe(true)
  })
  it('局部开启不能激活区间外休眠空间值，全片重排只使用有效平面姿态', async () => {
    const { snapshot, output } = fixture()
    snapshot.composition = { ...snapshot.composition, clips: snapshot.composition.clips.map(clip => ({ ...clip, spatial: { enabled: false }, depth: .7, rotationX: 20, curves: { rotationY: [{ time: 0, value: 15, interpolation: 'hold' as const }] } })) }
    const original = structuredClone(snapshot)
    await expect(planSpatialLayout(snapshot, { kind: 'expand', clipIds: ids, focusClipId: 'focus', range: [10, 30], parallaxRatio: 1.4, perspective: .5 }, output, signal())).rejects.toThrow('休眠')
    const patch = await planSpatialLayout(snapshot, { kind: 'arrange', clipIds: ids, focusClipId: 'focus', referenceFrame: 20, parallaxRatio: 1.4 }, output, signal())
    expect(patch.clips.every(edit => edit.values.rotationX === 0 && !edit.curves?.rotationY)).toBe(true)
    expect(snapshot).toEqual(original)
  })
  it('展开按范围替换取景高度，区间外静态高度与休眠绑定同时恢复', async () => {
    const { snapshot, output } = fixture()
    snapshot.composition = { ...snapshot.composition, spatialCamera: { framing: { target: { kind: 'clip', clipId: 'far' }, heightFraction: .4 }, bindings: { framing: [{ time: 0, value: null, interpolation: 'hold' }, { time: 50, value: { kind: 'clip', clipId: 'far' }, interpolation: 'hold' }] } } }
    const patch = await planSpatialLayout(snapshot, { kind: 'expand', clipIds: ids, focusClipId: 'focus', range: [10, 30], parallaxRatio: 1.4, perspective: .5 }, output, signal())
    const result = applySpatialPatch(snapshot, patch)
    for (const at of [0, 5, 31, 49, 50, 70]) expect(evaluateSpatialFrame(result, at, output, 'final').camera).toEqual(evaluateSpatialFrame(snapshot.composition, at, output, 'final').camera)
    expect(evaluateSpatialFrame(result, 10, output, 'final').cards.find(card => card.clipId === 'focus')!.screenBounds.height).toBeCloseTo(.2, 7)
  })
  it.each([1, 4 / 3])('视差比保持参考投影和焦点层距离，PAR=%s，输入不可变', async par => {
    const { snapshot, output } = fixture(par), original = structuredClone(snapshot), before = evaluateSpatialFrame(snapshot.composition, 20, output, 'final')
    const patch = await planSpatialLayout(snapshot, { kind: 'arrange', clipIds: ids, focusClipId: 'focus', referenceFrame: 20, parallaxRatio: 2 }, output, signal())
    const after = evaluateSpatialFrame(applySpatialPatch(snapshot, patch), 20, output, 'final')
    const depth = (id: string) => after.cards.find(card => card.clipId === id)!.centerViewDepth
    expect(depth('far') / depth('near')).toBeCloseTo(2, 9)
    expect(depth('focus')).toBeCloseTo(before.cards.find(card => card.clipId === 'focus')!.centerViewDepth, 9)
    for (const card of before.cards) expect(after.cards.find(value => value.clipId === card.clipId)!.screenBounds).toEqual(expect.objectContaining(Object.fromEntries(Object.entries(card.screenBounds).map(([key, value]) => [key, expect.closeTo(value, 9)]))))
    expect(patch.maxProjectionErrorPx).toBeLessThanOrEqual(.25); expect(snapshot).toEqual(original)
  })
  it('斜卡与非中心深度轴心按相机同心缩放补偿，不把锚点当中心', async () => {
    const { snapshot, output } = fixture()
    const clips = snapshot.composition.clips.map(clip => ({ ...clip, spatial: { enabled: true }, depth: .15, rotationX: 16, rotationY: -12, anchorDepth: .07, anchorX: .2, anchorY: .3 }))
    snapshot.composition = { ...snapshot.composition, clips }
    const patch = await planSpatialLayout(snapshot, { kind: 'arrange', clipIds: ids, focusClipId: 'focus', referenceFrame: 20, parallaxRatio: 1.4 }, output, signal())
    expect(patch.maxProjectionErrorPx).toBeLessThanOrEqual(.25)
    expect(patch.achievedParallaxRatio).toBeCloseTo(1.4, 8)
  })
  it('展开持久保存取景和透视曲线，输出帧与曝光子时刻连续；压平尾点严格恒等', async () => {
    const { snapshot, output } = fixture()
    const expanded = await planSpatialLayout(snapshot, { kind: 'expand', clipIds: ids, focusClipId: 'focus', range: [10, 30], parallaxRatio: 1.8, perspective: 1 }, output, signal())
    const composition = applySpatialPatch(snapshot, expanded)
    expect(cameraOf({ ...snapshot, composition })?.framing?.target).toEqual({ kind: 'clip', clipId: 'focus' })
    expect(cameraOf({ ...snapshot, composition })?.curves?.perspective?.at(-2)?.value).toBe(1)
    const start = evaluateSpatialFrame(composition, 10, output, 'final'), baseline = evaluateSpatialFrame(snapshot.composition, 10, output, 'final')
    expect(start.cards.map(card => card.screenBounds)).toEqual(baseline.cards.map(card => card.screenBounds))
    for (const at of [10, 10.25, 19.75, 20, 29.75, 30]) {
      const frame = evaluateSpatialFrame(composition, at, output, 'final')
      expect(frame.camera.position.every(Number.isFinite)).toBe(true)
      expect(frame.cards.find(card => card.clipId === 'focus')!.screenBounds.height).toBeCloseTo(baseline.cards.find(card => card.clipId === 'focus')!.screenBounds.height, 4)
    }
    const flat = await planSpatialLayout({ ...snapshot, composition }, { kind: 'flatten', clipIds: ids, focusClipId: 'focus', range: [10, 30] }, output, signal())
    const flattened = applySpatialPatch({ ...snapshot, composition }, flat)
    expect(evaluateSpatialFrame(flattened, 30, output, 'final').flatIdentity).toBe(true)
    for (const clip of flattened.clips) for (const key of SPATIAL_KEYS) expect(videoEditClipValue(clip, key, 30)).toBe(0)
    expect(flat.camera?.value?.bindings?.framing?.find(point => point.time === 30)?.value).toBeNull()
  })
  it('范围外 Bezier 子帧与手工点保持原样，候选误差超标或取消不会返回半套修改', async () => {
    const { snapshot, output } = fixture()
    const points: VideoEditKeyframes = [{ time: 0, value: -.27, interpolation: 'bezier', bezier: [.2, -.2, .7, 1.2] }, { time: 99, value: -.22, interpolation: 'linear' }]
    snapshot.composition = { ...snapshot.composition, clips: snapshot.composition.clips.map(clip => clip.id === 'far' ? { ...clip, curves: { x: points } } : clip) }
    const original = structuredClone(snapshot)
    const patch = await planSpatialLayout(snapshot, { kind: 'arrange', clipIds: ids, focusClipId: 'focus', referenceFrame: 20, range: [10, 30], parallaxRatio: 1.4 }, output, signal())
    const result = applySpatialPatch(snapshot, patch).clips.find(clip => clip.id === 'far')!
    for (const at of [0, 1.25, 9, 31, 50.75, 99]) expect(videoEditClipValue(result, 'x', at)).toBeCloseTo(videoEditClipValue(snapshot.composition.clips[0], 'x', at), 9)
    const controller = new AbortController(); controller.abort()
    await expect(planSpatialLayout(snapshot, { kind: 'arrange', clipIds: ids, focusClipId: 'focus', referenceFrame: 20, parallaxRatio: 2 }, output, controller.signal)).rejects.toThrow()
    await expect(planSpatialLayout(snapshot, { kind: 'arrange', clipIds: ids, focusClipId: 'focus', referenceFrame: 20, parallaxRatio: 1e10 }, output, signal())).rejects.toBeInstanceOf(SpatialLayoutError)
    expect(snapshot).toEqual(original)
  })
  it('单卡与同深度不会制造视差；非法选择、锁轨与过期快照明确拒绝', async () => {
    const { snapshot, output } = fixture(), intent = { kind: 'arrange' as const, clipIds: ['focus'], focusClipId: 'focus', referenceFrame: 20, parallaxRatio: 4 }
    expect((await planSpatialLayout(snapshot, intent, output, signal())).achievedParallaxRatio).toBe(1)
    await expect(planSpatialLayout(snapshot, { ...intent, clipIds: ['focus', 'focus'] }, output, signal())).rejects.toThrow('重复')
    await expect(planSpatialLayout({ ...snapshot, revision: snapshot.revision + 1 }, intent, output, signal())).rejects.toThrow('版本')
    snapshot.composition = { ...snapshot.composition, tracks: snapshot.composition.tracks.map(track => ({ ...track, locked: true })) }
    await expect(planSpatialLayout(snapshot, intent, output, signal())).rejects.toThrow('锁定')
  })
  it('多边形覆盖证明与透明媒体、文字、作者输出的未知边界分开', () => {
    const { snapshot, output } = fixture()
    snapshot.composition = { ...snapshot.composition, clips: snapshot.composition.clips.map(clip => ({ ...clip, x: 0, y: 0, scale: .3 })) }
    const read = () => inspectSpatialFrame(snapshot, evaluateSpatialFrame(snapshot.composition, 10, output, 'final'))
    expect(read().cards.find(card => card.clipId === 'far')).toMatchObject({ visibility: 'proven-occluded', visibleFraction: 0, occludedBy: ['focus', 'near'] })
    snapshot.composition = { ...snapshot.composition, clips: snapshot.composition.clips.map(clip => clip.id === 'near' ? { ...clip, opacity: .5 } : clip.id === 'focus' ? { ...clip, kind: 'text' as const, graphic: undefined, text: '有空白的字' } : clip) }
    expect(read().cards.find(card => card.clipId === 'far')).toMatchObject({ visibility: 'unknown', visibleFraction: null })
  })
  it('稀疏矩形参数使用正式图形默认值，二维覆盖项仍参与遮挡', () => {
    const { snapshot, output } = fixture()
    snapshot.composition = { ...snapshot.composition, clips: snapshot.composition.clips.map(clip => ({ ...clip, x: 0, y: 0, scale: .3 })) }
    snapshot.composition = { ...snapshot.composition, clips: snapshot.composition.clips.map(clip => clip.id === 'near' ? { ...clip, spatial: undefined } : clip) }
    const read = () => inspectSpatialFrame(snapshot, evaluateSpatialFrame(snapshot.composition, 10, output, 'final'))
    expect(read().cards.find(card => card.clipId === 'focus')).toMatchObject({ visibility: 'proven-occluded', occludedBy: ['near'] })
    snapshot.composition = { ...snapshot.composition, clips: snapshot.composition.clips.map(clip => clip.id === 'near' ? { ...clip, graphic: { ...clip.graphic!, objects: [{ ...clip.graphic!.objects[0], parameters: { width: 1920, height: 1080, fill: [1, 1, 1, 1] } }] } } : clip) }
    expect(read().cards.find(card => card.clipId === 'focus')).toMatchObject({ visibility: 'unknown', visibleFraction: null })
  })
  it('转场端点缺少分组标记时仍按正式窗口作为原子项，不证明透明过渡完全遮挡', () => {
    const { snapshot, output } = fixture()
    snapshot.composition = { ...snapshot.composition, clips: snapshot.composition.clips.filter(clip => clip.id !== 'focus').map(clip => ({ ...clip, x: 0, scale: .3 })), transitions: [{ id: 'fade-near', kind: 'cross_dissolve', leftClipId: 'near', durationFrames: 20, alignment: 'end' }] }
    const frame = evaluateSpatialFrame(snapshot.composition, 90, output, 'final')
    const result = inspectSpatialFrame(snapshot, { ...frame, cards: frame.cards.map(card => ({ ...card, compoundGroup: undefined })) })
    expect(result.frame.cards.find(card => card.clipId === 'near')?.compoundGroup).toBe('fade-near')
    expect(result.cards.find(card => card.clipId === 'far')).toMatchObject({ visibility: 'unknown', visibleFraction: null })
  })
  it('景深虚化的矩形边缘不再是完整不透明覆盖证据', () => {
    const { snapshot, output } = fixture()
    snapshot.composition = { ...snapshot.composition, spatialCamera: { defocus: 1, fStop: 1, focus: { kind: 'distance', distance: 1 } }, clips: snapshot.composition.clips.map(clip => ({ ...clip, x: 0, scale: .3 })) }
    const frame = evaluateSpatialFrame(snapshot.composition, 10, output, 'final')
    expect(frame.cards.every(card => card.cocRadiusPx > 0)).toBe(true)
    expect(inspectSpatialFrame(snapshot, frame).cards.find(card => card.clipId === 'far')).toMatchObject({ visibility: 'unknown', visibleFraction: null })
  })
})
